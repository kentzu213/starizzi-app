/**
 * DockerAgentService — Real Docker install/run for Top Agents (Agent Hub)
 *
 * Drives the `docker` CLI via child_process to pull images, run/start/stop
 * single-container agents, and report real container status. Used ONLY for
 * external agents whose setupMethod === 'docker'.
 *
 * Safety: every operation targets containers prefixed with `izzi-agent-`.
 * It never touches other containers and never runs prune/bulk-remove commands.
 *
 * No external dependency (no dockerode) — plain `docker` CLI.
 *
 * Hermes Agent (id 'hermes') is special: it needs its API server enabled to be
 * reachable from the host, mounts a per-app data dir at /opt/data, and exposes
 * an OpenAI-compatible chat endpoint that requires an Authorization key. That key
 * is generated/persisted in the data dir and kept in main (never sent to renderer).
 */
import { execFile, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import axios from 'axios';

/** Minimal agent metadata passed from the renderer (no registry import in main). */
export interface DockerAgentPayload {
  id: string;
  dockerImage?: string;
  defaultPort: number;
  dockerComposeUrl?: string;
  /** Optional model provider id (e.g. 'izzi', 'openai') used to seed Hermes. */
  provider?: string;
  /** Optional provider API key used to seed Hermes (NOT the API server key). */
  apiKey?: string;
}

export interface DockerResult {
  ok: boolean;
  error?: string;
}

export interface DockerStartResult extends DockerResult {
  containerId?: string;
}

export interface DockerStatusResult {
  running: boolean;
  error?: string;
}

export interface DockerChatResult {
  ok: boolean;
  reply?: string;
  error?: string;
}

export interface DockerHealthResult {
  ok: boolean;
  status?: number;
  error?: string;
}

/** Minimal payload for a health probe (port + path from the agent registry). */
export interface HealthCheckPayload {
  defaultPort: number;
  healthEndpoint?: string;
}

/** Provider seed for Hermes (OpenAI-compatible env-var seeding). */
export interface HermesProviderSeed {
  apiKey: string;
  baseUrl: string;
  model: string;
}

/** Options for building the Hermes `docker run` command. */
export interface HermesRunOptions {
  hostPort: number;
  dataDir: string;
  apiServerKey: string;
  provider?: HermesProviderSeed;
}

const CONTAINER_PREFIX = 'izzi-agent-';
const DEFAULT_EXEC_TIMEOUT = 30_000;
const PULL_TIMEOUT = 600_000; // 10 min — large images can take a while

/** Hermes always serves its API server on this container port. */
const HERMES_CONTAINER_PORT = 8642;
/** File (inside the agent data dir) that persists the generated API server key. */
const API_KEY_FILE = '.izzi-api-key';
/** Chat timeout — agent runs can take a while on first response. */
const CHAT_TIMEOUT = 120_000;

/** Agents that need the Hermes-style API server (env + key + mounted data dir). */
export function agentNeedsApiServer(agentId: string): boolean {
  return agentId === 'hermes';
}

/**
 * Map a model provider id + key to OpenAI-compatible seed values for Hermes.
 * Returns null when there is no key (caller should then skip seeding).
 *
 * Verified empirically: setting OPENAI_API_KEY + OPENAI_BASE_URL makes Hermes
 * recognize the provider (no "No inference provider configured" error).
 */
export function resolveHermesProviderSeed(
  provider: string | undefined,
  apiKey: string | undefined,
): HermesProviderSeed | null {
  if (!apiKey || !apiKey.trim()) return null;

  // base_url + a sensible default model per provider (no trailing slash).
  const map: Record<string, { baseUrl: string; model: string }> = {
    izzi: { baseUrl: 'https://api.izziapi.com/v1', model: 'izzi/auto' },
    openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o' },
    gemini: {
      baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
      model: 'gemini-2.5-flash',
    },
    ollama: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.3' },
  };

  const entry = map[provider ?? ''] ?? map.izzi;
  return { apiKey: apiKey.trim(), baseUrl: entry.baseUrl, model: entry.model };
}

/**
 * Build the normalized container name for an agent. Sanitizes the id to the
 * characters Docker allows in a container name ([a-zA-Z0-9_.-]).
 */
export function dockerContainerName(agentId: string): string {
  const safe = (agentId || '').replace(/[^a-zA-Z0-9_.-]/g, '-').replace(/^[^a-zA-Z0-9]+/, '');
  return `${CONTAINER_PREFIX}${safe || 'unknown'}`;
}

/**
 * Build `docker run` args for a single-container agent. Pure function so it can
 * be unit-tested without invoking Docker.
 */
export function buildDockerRunArgs(payload: DockerAgentPayload): string[] {
  const name = dockerContainerName(payload.id);
  const port = String(payload.defaultPort);
  return [
    'run',
    '-d',
    '--name',
    name,
    '-p',
    `${port}:${port}`,
    payload.dockerImage as string,
  ];
}

/**
 * Build `docker run` args for the Hermes agent: mounts a per-app data dir at
 * /opt/data, maps the host port to the fixed container API port (8642), enables
 * the API server bound to 0.0.0.0 with the generated key, optionally seeds an
 * OpenAI-compatible provider via env vars, and runs `gateway run`.
 *
 * Pure function — unit-testable without invoking Docker. The CMD `gateway run`
 * is appended after the image (the image's entrypoint routes it correctly).
 */
export function buildHermesRunArgs(
  payload: DockerAgentPayload,
  options: HermesRunOptions,
): string[] {
  const name = dockerContainerName(payload.id);
  const args = [
    'run',
    '-d',
    '--name',
    name,
    '-v',
    `${options.dataDir}:/opt/data`,
    '-p',
    `${options.hostPort}:${HERMES_CONTAINER_PORT}`,
    '-e',
    'API_SERVER_ENABLED=true',
    '-e',
    'API_SERVER_HOST=0.0.0.0',
    '-e',
    `API_SERVER_KEY=${options.apiServerKey}`,
  ];

  if (options.provider) {
    args.push(
      '-e',
      `OPENAI_API_KEY=${options.provider.apiKey}`,
      '-e',
      `OPENAI_BASE_URL=${options.provider.baseUrl}`,
      '-e',
      `LLM_MODEL=${options.provider.model}`,
    );
  }

  args.push(payload.dockerImage as string, 'gateway', 'run');
  return args;
}

/** Extract a short, human-readable message from raw docker stderr. */
export function summarizeDockerError(stderr: string): string {
  const lines = (stderr || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return 'Lệnh docker thất bại (không có chi tiết).';
  // Prefer the most descriptive "Error response from daemon" / "Error" line.
  const errLine =
    lines.find((l) => /error response from daemon/i.test(l)) ??
    lines.find((l) => /^error/i.test(l)) ??
    lines[lines.length - 1];
  return errLine.length > 200 ? `${errLine.slice(0, 197)}...` : errLine;
}

/** Remove a secret value from a string so it never leaks into logs/messages. */
export function redactSecret(text: string, secret?: string): string {
  if (!text) return text;
  if (!secret || secret.length < 4) return text;
  return text.split(secret).join('***');
}

export class DockerAgentService {
  /** In-memory map of agentId → API server key (Hermes). Never sent to renderer. */
  private apiKeys = new Map<string, string>();

  /** True when the Docker daemon is reachable (`docker info` exits 0). */
  async isDockerAvailable(): Promise<boolean> {
    const { code } = await this.exec(['info'], 10_000);
    return code === 0;
  }

  /**
   * Pull the agent image, streaming each output line to `onProgress`.
   * Returns ok:false with a concise real message on failure (e.g. image not found).
   */
  async install(
    payload: DockerAgentPayload,
    onProgress: (line: string) => void,
  ): Promise<DockerResult> {
    if (!payload.dockerImage) {
      return { ok: false, error: 'Agent không có docker image để pull.' };
    }

    return new Promise<DockerResult>((resolve) => {
      let stderrTail = '';
      let settled = false;
      const finish = (result: DockerResult) => {
        if (!settled) {
          settled = true;
          resolve(result);
        }
      };

      let child;
      try {
        child = spawn('docker', ['pull', payload.dockerImage as string], {
          windowsHide: true,
        });
      } catch (err: any) {
        finish({ ok: false, error: `Không gọi được docker: ${err?.message ?? 'unknown'}` });
        return;
      }

      const emit = (buf: Buffer) => {
        const text = buf.toString();
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed) onProgress(trimmed);
        }
      };

      child.stdout?.on('data', emit);
      child.stderr?.on('data', (buf: Buffer) => {
        stderrTail += buf.toString();
        emit(buf);
      });

      const killTimer = setTimeout(() => {
        child.kill();
        finish({ ok: false, error: 'docker pull quá thời gian (timeout).' });
      }, PULL_TIMEOUT);

      child.on('error', (err) => {
        clearTimeout(killTimer);
        finish({ ok: false, error: `Không gọi được docker: ${err.message}` });
      });

      child.on('close', (code) => {
        clearTimeout(killTimer);
        if (code === 0) {
          finish({ ok: true });
        } else {
          finish({ ok: false, error: summarizeDockerError(stderrTail) });
        }
      });
    });
  }

  /**
   * Start the agent container. If a container with the normalized name already
   * exists, `docker start` it; otherwise `docker run -d` a fresh one.
   *
   * For agents that need an API server (Hermes), uses the dedicated run command
   * that mounts a per-app data dir, enables the API server with a persisted key,
   * and optionally seeds an OpenAI-compatible provider.
   */
  async start(payload: DockerAgentPayload): Promise<DockerStartResult> {
    if (!payload.dockerImage) {
      return { ok: false, error: 'Agent không có docker image để chạy.' };
    }

    const name = dockerContainerName(payload.id);
    const exists = await this.containerExists(name);

    let args: string[];
    if (exists) {
      args = ['start', name];
    } else if (agentNeedsApiServer(payload.id)) {
      args = this.buildApiServerRunArgs(payload);
    } else {
      args = buildDockerRunArgs(payload);
    }

    const { code, stdout, stderr } = await this.exec(args, DEFAULT_EXEC_TIMEOUT);

    if (code !== 0) {
      // Redact the API server key in case it appears in docker's echoed error.
      const key = this.apiKeys.get(payload.id);
      return { ok: false, error: redactSecret(summarizeDockerError(stderr), key) };
    }
    return { ok: true, containerId: stdout.trim() || name };
  }

  /**
   * Build the Hermes-style run args, ensuring the data dir exists and the API
   * server key is generated/persisted. Keeps the key in-memory for chat().
   */
  private buildApiServerRunArgs(payload: DockerAgentPayload): string[] {
    const dataDir = this.ensureAgentDataDir(payload.id);
    const apiServerKey = this.loadOrCreateApiKey(payload.id, dataDir);
    const provider = resolveHermesProviderSeed(payload.provider, payload.apiKey) ?? undefined;
    return buildHermesRunArgs(payload, {
      hostPort: payload.defaultPort,
      dataDir,
      apiServerKey,
      provider,
    });
  }

  /** Stop the agent container (no remove — keep it for fast restart). */
  async stop(payload: DockerAgentPayload): Promise<DockerResult> {
    const name = dockerContainerName(payload.id);
    const exists = await this.containerExists(name);
    if (!exists) return { ok: true };

    const { code, stderr } = await this.exec(['stop', name], DEFAULT_EXEC_TIMEOUT);
    if (code !== 0) {
      return { ok: false, error: summarizeDockerError(stderr) };
    }
    return { ok: true };
  }

  /** Report whether the agent container is currently running. */
  async status(payload: DockerAgentPayload): Promise<DockerStatusResult> {
    const name = dockerContainerName(payload.id);
    const { code, stdout, stderr } = await this.exec(
      ['ps', '--filter', `name=${name}`, '--format', '{{.Names}}'],
      DEFAULT_EXEC_TIMEOUT,
    );
    if (code !== 0) {
      return { running: false, error: summarizeDockerError(stderr) };
    }
    const running = stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .includes(name);
    return { running };
  }

  /** Whether a container with the exact name exists in any state. */
  private async containerExists(name: string): Promise<boolean> {
    const { code, stdout } = await this.exec(
      ['ps', '-a', '--filter', `name=${name}`, '--format', '{{.Names}}'],
      DEFAULT_EXEC_TIMEOUT,
    );
    if (code !== 0) return false;
    return stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .includes(name);
  }

  /**
   * Send a chat message to a Hermes-style agent via its OpenAI-compatible API.
   * Uses the in-memory/persisted API server key (kept in main, never exposed).
   * Returns the assistant reply, or a concise (key-redacted) error.
   */
  async chat(payload: DockerAgentPayload, message: string): Promise<DockerChatResult> {
    const key = this.getApiKey(payload.id);
    if (!key) {
      return {
        ok: false,
        error: 'Chưa có API key cho agent (hãy cài/khởi động lại agent trước khi chat).',
      };
    }

    const url = `http://127.0.0.1:${payload.defaultPort}/v1/chat/completions`;
    try {
      const res = await axios.post(
        url,
        {
          model: 'hermes-agent',
          messages: [{ role: 'user', content: message }],
          stream: false,
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
          },
          timeout: CHAT_TIMEOUT,
        },
      );

      const reply: string | undefined = res.data?.choices?.[0]?.message?.content;
      if (typeof reply === 'string' && reply.length > 0) {
        return { ok: true, reply };
      }
      return { ok: false, error: 'Agent trả về phản hồi rỗng (có thể chưa cấu hình model provider).' };
    } catch (err: any) {
      // Prefer the provider/server error body when present; redact the key.
      const body = err?.response?.data;
      const serverMsg =
        (typeof body === 'object' && (body?.error?.message || body?.error)) ||
        (typeof body === 'string' ? body : '') ||
        err?.message ||
        'Không gọi được Hermes API.';
      const text = typeof serverMsg === 'string' ? serverMsg : JSON.stringify(serverMsg);
      return { ok: false, error: redactSecret(text, key).slice(0, 400) };
    }
  }

  /**
   * Probe an agent's HTTP health endpoint from the MAIN process (Node/axios).
   *
   * Deliberately runs in main, not the renderer: a renderer `fetch` always sends
   * an `Origin` header and is CORS-enforced, and some agent health servers (e.g.
   * Hermes' aiohttp server) reject browser-origin requests with 403 and send no
   * CORS headers — so a healthy endpoint looks "down" to the renderer. Node sends
   * no Origin and isn't CORS-bound, so it sees the true 200.
   */
  async healthCheck(
    payload: HealthCheckPayload,
    timeoutMs = 5000,
  ): Promise<DockerHealthResult> {
    const path = payload.healthEndpoint || '/health';
    const url = `http://127.0.0.1:${payload.defaultPort}${path}`;
    try {
      const res = await axios.get(url, {
        timeout: timeoutMs,
        // Decide ok ourselves; don't throw on non-2xx responses.
        validateStatus: () => true,
      });
      return { ok: res.status >= 200 && res.status < 300, status: res.status };
    } catch (err: any) {
      const msg = (err?.code || err?.message || 'health check failed').toString();
      return { ok: false, error: msg.slice(0, 120) };
    }
  }

  /** Get the API server key for an agent (memory first, then persisted file). */
  private getApiKey(agentId: string): string | null {
    const cached = this.apiKeys.get(agentId);
    if (cached) return cached;
    try {
      const dataDir = this.agentDataDir(agentId);
      const file = path.join(dataDir, API_KEY_FILE);
      if (fs.existsSync(file)) {
        const key = fs.readFileSync(file, 'utf8').trim();
        if (key) {
          this.apiKeys.set(agentId, key);
          return key;
        }
      }
    } catch {
      // best-effort — fall through to null
    }
    return null;
  }

  /** Compute the per-app data dir for an agent (no side effects). */
  private agentDataDir(agentId: string): string {
    // Lazy require so unit tests (node env) don't need electron.
    const { app } = require('electron');
    const safe = (agentId || 'unknown').replace(/[^a-zA-Z0-9_.-]/g, '-');
    return path.join(app.getPath('userData'), 'hermes-data', safe);
  }

  /** Ensure the per-app data dir exists and return its path. */
  private ensureAgentDataDir(agentId: string): string {
    const dir = this.agentDataDir(agentId);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  /**
   * Load the persisted API server key, or generate + persist a new one.
   * The key value is never logged. Cached in memory for chat().
   */
  private loadOrCreateApiKey(agentId: string, dataDir: string): string {
    const file = path.join(dataDir, API_KEY_FILE);
    try {
      if (fs.existsSync(file)) {
        const existing = fs.readFileSync(file, 'utf8').trim();
        if (existing.length >= 8) {
          this.apiKeys.set(agentId, existing);
          return existing;
        }
      }
    } catch {
      // ignore — regenerate below
    }

    const key = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(file, key, { encoding: 'utf8', mode: 0o600 });
    } catch {
      // If persistence fails we still keep it in-memory for this session.
    }
    this.apiKeys.set(agentId, key);
    return key;
  }

  /** Run a docker command (non-streaming) and capture its result. */
  private exec(
    args: string[],
    timeout: number,
  ): Promise<{ code: number; stdout: string; stderr: string }> {
    return new Promise((resolve) => {
      execFile('docker', args, { timeout, windowsHide: true }, (error, stdout, stderr) => {
        if (error) {
          // execFile sets error.code to the process exit code (number) or a string
          // like 'ENOENT' when docker is missing. Normalize to a non-zero number.
          const code = typeof (error as any).code === 'number' ? (error as any).code : 1;
          resolve({ code, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? error.message });
          return;
        }
        resolve({ code: 0, stdout: stdout?.toString() ?? '', stderr: stderr?.toString() ?? '' });
      });
    });
  }
}
