/**
 * LocalServiceManager — boots an extension's declared backend on the user's
 * machine via `docker compose`, then health-gates it so the extension's thin
 * client (e.g. autopost-client → 127.0.0.1:3001) just works.
 *
 * Generalizes the single-container DockerAgentService to multi-service compose
 * projects. It reuses that module's `summarizeDockerError` / `redactSecret`
 * helpers and the same safety posture:
 *
 *   • Only ever drives compose projects named `izzi-svc-*` (validated again here,
 *     defense-in-depth on top of the manifest validator) — never other projects.
 *   • `down` NEVER passes `-v`, so user data volumes survive a stop/restart.
 *   • Never runs prune / bulk-remove.
 *   • All published ports bind to loopback (the compose file uses ${IZZI_BIND}).
 *   • Secrets are generated locally into a 0600 .env under userData, never shipped
 *     in the .ocx and never logged.
 *   • Health is probed from MAIN (Node/axios), not the renderer, to avoid CORS
 *     (same rationale as DockerAgentService.healthCheck).
 *
 * @module main/extensions/local-service-manager
 */
import { execFile, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';
import * as crypto from 'crypto';
import axios from 'axios';
import { summarizeDockerError, redactSecret } from '../agents/docker-agent-service';
import type { OcxServiceSpec } from './ocx-manifest';

const DEFAULT_EXEC_TIMEOUT = 60_000;
const UP_TIMEOUT = 900_000; // 15 min — first run may pull postgres/redis/minio/api
const DEFAULT_READY_TIMEOUT = 120_000;
const HEALTH_POLL_INTERVAL = 2_000;
/** Re-checked here so a bad manifest can never drive docker at other projects. */
const SERVICE_PROJECT_REGEX = /^izzi-svc-[a-z0-9][a-z0-9-]*$/;

// ── Public result shapes ──

export interface ServiceRunContext {
  extensionId: string;
  extensionPath: string; // absolute path to the installed extension directory
  service: OcxServiceSpec;
  onLog?: (line: string) => void;
}

export type ServiceUpReason = 'no-docker' | 'invalid' | 'compose-failed' | 'unhealthy' | 'error';

export interface ServiceUpResult {
  ok: boolean;
  reason?: ServiceUpReason;
  error?: string;
  baseUrl?: string; // primary port's loopback URL, e.g. http://127.0.0.1:3001
  ports?: Record<string, number>; // logical name → allocated host port
  injected?: Record<string, string>; // resolved `inject` settings for the extension
}

export interface ServiceStatus {
  running: boolean;
  healthy?: boolean;
  ports?: Record<string, number>;
}

// ── Pure helpers (unit-testable without Docker/Electron) ──

/** Parse a secret generator spec like "hex:64" or "base64:32". */
export function parseGenSpec(gen: string): { kind: 'hex' | 'base64'; len: number } | null {
  const m = /^(hex|base64):(\d{1,4})$/.exec(gen || '');
  if (!m) return null;
  const len = parseInt(m[2], 10);
  if (len <= 0) return null;
  return { kind: m[1] as 'hex' | 'base64', len };
}

/** Generate a crypto-random secret value from a gen spec. Throws on a bad spec. */
export function generateSecretValue(gen: string): string {
  const spec = parseGenSpec(gen);
  if (!spec) throw new Error(`Invalid secret gen spec: ${gen}`);
  if (spec.kind === 'hex') {
    return crypto.randomBytes(Math.ceil(spec.len / 2)).toString('hex').slice(0, spec.len);
  }
  return crypto.randomBytes(spec.len).toString('base64');
}

/** Resolve `${port.<name>}` templates in an inject value against allocated ports. */
export function resolveInject(template: string, ports: Record<string, number>): string {
  return String(template).replace(/\$\{port\.([a-zA-Z0-9_-]+)\}/g, (_m, name) => {
    const p = ports[name];
    return p !== undefined ? String(p) : '';
  });
}

/** Build `docker compose ... up -d` args (array-form — no shell interpolation). */
export function buildComposeUpArgs(projectName: string, composePath: string, envFile: string): string[] {
  return ['compose', '-p', projectName, '-f', composePath, '--env-file', envFile, 'up', '-d'];
}

/** Build `docker compose ... down` args. Intentionally NO `-v` (keep volumes). */
export function buildComposeDownArgs(projectName: string, composePath: string, envFile: string): string[] {
  return ['compose', '-p', projectName, '-f', composePath, '--env-file', envFile, 'down'];
}

/** Render the whole `inject` map against allocated ports. */
export function resolveInjectAll(
  inject: Record<string, string> | undefined,
  ports: Record<string, number>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(inject || {})) out[k] = resolveInject(v, ports);
  return out;
}

/** True when a port can be bound on the given loopback host (i.e. it is free). */
export function checkPortFree(port: number, host = '127.0.0.1'): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.once('listening', () => srv.close(() => resolve(true)));
    try {
      srv.listen(port, host);
    } catch {
      resolve(false);
    }
  });
}

/** Prefer the canonical port; fall back to an ephemeral free port if it's taken. */
export async function findFreePort(preferred: number, host = '127.0.0.1'): Promise<number> {
  if (preferred > 0 && (await checkPortFree(preferred, host))) return preferred;
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, host, () => {
      const addr = srv.address();
      const port = addr && typeof addr === 'object' ? addr.port : 0;
      srv.close(() => (port ? resolve(port) : reject(new Error('no free port'))));
    });
  });
}

const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Manager ──

export class LocalServiceManager {
  /** projectName → live info, so we can stop/status without re-reading manifests. */
  private running = new Map<string, { ports: Record<string, number>; composePath: string; envFile: string }>();

  /** True when `docker compose` is usable. */
  async isDockerAvailable(): Promise<boolean> {
    const { code } = await this.exec(['compose', 'version'], 10_000);
    return code === 0;
  }

  /**
   * Boot the extension's backend and wait for health. Returns ok:false with a
   * `reason` (never throws) so the caller can fall back to a hosted backend.
   */
  async up(ctx: ServiceRunContext): Promise<ServiceUpResult> {
    const { service, extensionPath, onLog } = ctx;

    if (!SERVICE_PROJECT_REGEX.test(service.projectName)) {
      return { ok: false, reason: 'invalid', error: 'projectName must match izzi-svc-*' };
    }
    if (service.type !== 'docker-compose') {
      return { ok: false, reason: 'invalid', error: 'Only docker-compose services are supported (Phase 1)' };
    }
    if (!Array.isArray(service.ports) || service.ports.length === 0) {
      return { ok: false, reason: 'invalid', error: 'service.ports is empty' };
    }
    if (!(await this.isDockerAvailable())) {
      return { ok: false, reason: 'no-docker' };
    }

    const composePath = this.resolveComposePath(extensionPath, service.compose || '');
    if (!composePath) {
      return { ok: false, reason: 'invalid', error: 'compose path is invalid or missing' };
    }

    // Allocate a loopback host port per declared port (prefer the canonical one).
    const ports: Record<string, number> = {};
    try {
      for (const p of service.ports) ports[p.name] = await findFreePort(p.container);
    } catch (err) {
      return { ok: false, reason: 'error', error: `port allocation failed: ${(err as Error).message}` };
    }

    let envFile: string;
    try {
      envFile = this.writeEnvFile(service, ports);
    } catch (err) {
      return { ok: false, reason: 'error', error: `env write failed: ${(err as Error).message}` };
    }

    onLog?.(`▶ docker compose up (${service.projectName})…`);
    const up = await this.composeStream(
      buildComposeUpArgs(service.projectName, composePath, envFile),
      onLog,
    );
    if (!up.ok) return { ok: false, reason: 'compose-failed', error: up.error };

    const primary = service.ports[0];
    const healthPath = primary.healthPath || '/health';
    const healthUrl = `http://127.0.0.1:${ports[primary.name]}${healthPath}`;
    onLog?.(`… chờ ${healthUrl}`);
    const healthy = await this.waitHealthy(healthUrl, service.readyTimeoutMs || DEFAULT_READY_TIMEOUT);
    if (!healthy) {
      return { ok: false, reason: 'unhealthy', error: `service không healthy trong thời gian chờ (${healthUrl})` };
    }

    this.running.set(service.projectName, { ports, composePath, envFile });
    const baseUrl = `http://127.0.0.1:${ports[primary.name]}`;
    onLog?.(`✅ ${service.projectName} sẵn sàng: ${baseUrl}`);
    return { ok: true, baseUrl, ports, injected: resolveInjectAll(service.inject, ports) };
  }

  /** Stop the backend. Keeps volumes (no `-v`) — user data survives. */
  async down(ctx: ServiceRunContext): Promise<{ ok: boolean; error?: string }> {
    const { service, extensionPath } = ctx;
    if (!SERVICE_PROJECT_REGEX.test(service.projectName)) {
      return { ok: false, error: 'projectName must match izzi-svc-*' };
    }
    const composePath = this.resolveComposePath(extensionPath, service.compose || '');
    if (!composePath) return { ok: true }; // nothing we can (or should) act on
    const envFile = this.running.get(service.projectName)?.envFile || this.ensureEnvFile(service);
    const { code, stderr } = await this.exec(
      buildComposeDownArgs(service.projectName, composePath, envFile),
      DEFAULT_EXEC_TIMEOUT,
    );
    this.running.delete(service.projectName);
    if (code !== 0) return { ok: false, error: summarizeDockerError(stderr) };
    return { ok: true };
  }

  /** Report whether the backend's containers are running (+ health if known). */
  async status(ctx: ServiceRunContext): Promise<ServiceStatus> {
    const { service, extensionPath } = ctx;
    if (!SERVICE_PROJECT_REGEX.test(service.projectName)) return { running: false };
    const composePath = this.resolveComposePath(extensionPath, service.compose || '');
    if (!composePath) return { running: false };
    const envFile = this.running.get(service.projectName)?.envFile || this.ensureEnvFile(service);
    const { code, stdout } = await this.exec(
      ['compose', '-p', service.projectName, '-f', composePath, '--env-file', envFile, 'ps', '--format', 'json'],
      DEFAULT_EXEC_TIMEOUT,
    );
    if (code !== 0) return { running: false };
    const running = parseComposePsRunning(stdout);
    const ports = this.running.get(service.projectName)?.ports;
    let healthy: boolean | undefined;
    if (running && ports) {
      const primary = service.ports[0];
      const url = `http://127.0.0.1:${ports[primary.name]}${primary.healthPath || '/health'}`;
      healthy = await this.probeOnce(url);
    }
    return { running, healthy, ports };
  }

  /** Tail the backend's compose logs (best-effort). */
  async logs(ctx: ServiceRunContext, tail = 200): Promise<string> {
    const composePath = this.resolveComposePath(ctx.extensionPath, ctx.service.compose || '');
    if (!composePath) return '';
    const envFile = this.running.get(ctx.service.projectName)?.envFile || this.ensureEnvFile(ctx.service);
    const { stdout } = await this.exec(
      ['compose', '-p', ctx.service.projectName, '-f', composePath, '--env-file', envFile, 'logs', '--no-color', '--tail', String(tail)],
      DEFAULT_EXEC_TIMEOUT,
    );
    return stdout;
  }

  /** Stop every managed service (call on app quit). Best-effort, never throws. */
  async stopAll(): Promise<void> {
    const entries = [...this.running.entries()];
    for (const [projectName, info] of entries) {
      try {
        await this.exec(['compose', '-p', projectName, '-f', info.composePath, '--env-file', info.envFile, 'down'], DEFAULT_EXEC_TIMEOUT);
      } catch {
        // best-effort on quit
      }
      this.running.delete(projectName);
    }
  }

  /**
   * Fire `docker compose down` for every managed service DETACHED, so teardown
   * finishes even though Electron's `before-quit` is not awaited. Synchronous +
   * best-effort — safe to call from before-quit alongside ExtensionLoader.killAll().
   */
  stopAllDetached(): void {
    for (const [projectName, info] of this.running) {
      try {
        const child = spawn('docker', buildComposeDownArgs(projectName, info.composePath, info.envFile), {
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        });
        child.unref();
      } catch {
        // best-effort on quit
      }
    }
    this.running.clear();
  }

  // ── internals ──

  /** Resolve the compose path and confirm it stays INSIDE the extension dir. */
  private resolveComposePath(extensionPath: string, compose: string): string | null {
    if (!compose || compose.includes('..')) return null;
    const root = path.resolve(extensionPath);
    const resolved = path.resolve(root, compose);
    if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
    if (!fs.existsSync(resolved)) return null;
    return resolved;
  }

  /** Per-service data dir under userData (holds the generated .env). */
  private serviceDataDir(projectName: string): string {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'izzi-svc', projectName);
  }

  /** Read an existing .env into a map (so stable secrets are preserved). */
  private readEnv(envPath: string): Record<string, string> {
    const out: Record<string, string> = {};
    try {
      const text = fs.readFileSync(envPath, 'utf8');
      for (const line of text.split(/\r?\n/)) {
        const m = /^([A-Z][A-Z0-9_]*)=(.*)$/.exec(line.trim());
        if (m) out[m[1]] = m[2];
      }
    } catch {
      // no existing env — fine
    }
    return out;
  }

  /**
   * Write the compose .env: loopback bind, allocated host ports, and secrets.
   * Existing secret values are preserved (ENCRYPTION_KEY must stay stable so
   * previously-encrypted data still decrypts). Mode 0600; never logged.
   */
  private writeEnvFile(service: OcxServiceSpec, ports: Record<string, number>): string {
    const dir = this.serviceDataDir(service.projectName);
    fs.mkdirSync(dir, { recursive: true });
    const envPath = path.join(dir, '.env');
    const existing = this.readEnv(envPath);

    const lines = ['# Managed by Izzi OpenClaw — generated locally. Do not commit.', 'IZZI_BIND=127.0.0.1'];
    for (const [name, hostPort] of Object.entries(ports)) {
      lines.push(`IZZI_PORT_${name.toUpperCase()}=${hostPort}`);
    }
    for (const s of service.secrets || []) {
      const value = existing[s.key] ?? generateSecretValue(s.gen);
      lines.push(`${s.key}=${value}`);
    }
    fs.writeFileSync(envPath, lines.join('\n') + '\n', { encoding: 'utf8', mode: 0o600 });
    return envPath;
  }

  /** Ensure an .env exists for down/status/logs (regenerate ports if missing). */
  private ensureEnvFile(service: OcxServiceSpec): string {
    const envPath = path.join(this.serviceDataDir(service.projectName), '.env');
    if (fs.existsSync(envPath)) return envPath;
    const ports: Record<string, number> = {};
    for (const p of service.ports) ports[p.name] = p.container;
    return this.writeEnvFile(service, ports);
  }

  /** Poll a health URL from MAIN (no CORS) until 200 or timeout. */
  private async waitHealthy(url: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (await this.probeOnce(url)) return true;
      await delay(HEALTH_POLL_INTERVAL);
    }
    return false;
  }

  private async probeOnce(url: string): Promise<boolean> {
    try {
      const res = await axios.get(url, { timeout: 4000, validateStatus: () => true });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  /** Stream a `docker compose` command, forwarding each line to onLog. */
  private composeStream(args: string[], onLog?: (line: string) => void): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      let stderrTail = '';
      let settled = false;
      const finish = (r: { ok: boolean; error?: string }) => {
        if (!settled) {
          settled = true;
          resolve(r);
        }
      };

      let child;
      try {
        child = spawn('docker', args, { windowsHide: true });
      } catch (err: any) {
        finish({ ok: false, error: `Không gọi được docker: ${err?.message ?? 'unknown'}` });
        return;
      }

      const emit = (buf: Buffer) => {
        for (const line of buf.toString().split(/\r?\n/)) {
          const t = line.trim();
          if (t) onLog?.(t);
        }
      };
      child.stdout?.on('data', emit);
      child.stderr?.on('data', (buf: Buffer) => {
        stderrTail += buf.toString();
        emit(buf);
      });

      const killTimer = setTimeout(() => {
        child.kill();
        finish({ ok: false, error: 'docker compose up quá thời gian (timeout).' });
      }, UP_TIMEOUT);

      child.on('error', (err) => {
        clearTimeout(killTimer);
        finish({ ok: false, error: `Không gọi được docker: ${err.message}` });
      });
      child.on('close', (code) => {
        clearTimeout(killTimer);
        finish(code === 0 ? { ok: true } : { ok: false, error: summarizeDockerError(stderrTail) });
      });
    });
  }

  /** Run a `docker` command (non-streaming) and capture the result. */
  private exec(args: string[], timeout: number): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile('docker', args, { timeout, windowsHide: true, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error) {
          const code = typeof (error as any).code === 'number' ? (error as any).code : 1;
          resolve({ code, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? error.message });
          return;
        }
        resolve({ code: 0, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
      });
    });
  }
}

/**
 * Parse `docker compose ps --format json` output — which is either a JSON array
 * or newline-delimited JSON objects depending on the Compose version — and
 * report whether any service is running. Pure + exported for tests.
 */
export function parseComposePsRunning(stdout: string): boolean {
  const text = (stdout || '').trim();
  if (!text) return false;
  const rows: any[] = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rows.push(...parsed);
    else rows.push(parsed);
  } catch {
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      try {
        rows.push(JSON.parse(t));
      } catch {
        // ignore non-JSON noise
      }
    }
  }
  return rows.some((r) => {
    const state = String(r?.State ?? r?.state ?? '').toLowerCase();
    return state === 'running' || state.startsWith('up') || state === 'healthy';
  });
}
