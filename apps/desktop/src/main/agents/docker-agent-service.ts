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
 *
 * LLM routing: Hermes' own upstream provider is pointed at the local IzziLlmProxy
 * (main process) via a `config.yaml` written into the mounted data dir — so every
 * agent chats through the user's Izzi smart router and the Izzi credential never
 * enters the container. Config is (re)written on each start because the proxy
 * port/token can change; that's why API-server agents are recreated, not reused.
 */
import { execFile, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import axios from 'axios';
import type { IzziLlmProxy } from './izzi-llm-proxy';
import {
  extractSseEvents,
  parseOpenAiSseEvent,
  type AgentTurnEvent,
} from '../../shared/agent-turn-events';

/** Optional live-streaming hooks for a chat turn (Stage 1: show the process). */
export interface ChatStreamOptions {
  /** Called for each streamed content/reasoning delta while the reply is produced. */
  onEvent?: (evt: AgentTurnEvent) => void;
  /** Correlates emitted events to the renderer's assistant message. */
  turnId?: string;
}

/** Minimal agent metadata passed from the renderer (no registry import in main). */
export interface DockerAgentPayload {
  id: string;
  dockerImage?: string;
  defaultPort: number;
  dockerComposeUrl?: string;
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

/** Izzi smart-router config written into a Hermes agent's config.yaml. */
export interface HermesModelConfig {
  /** OpenAI-compatible base_url — the local proxy via host.docker.internal. */
  baseUrl: string;
  /** Localhost proxy token the container presents (NOT the Izzi credential). */
  apiKey: string;
  /** Model id Hermes requests (the proxy forces it to izzi-smart regardless). */
  model: string;
}

/** Options for building the Hermes `docker run` command. */
export interface HermesRunOptions {
  hostPort: number;
  dataDir: string;
  apiServerKey: string;
}

const CONTAINER_PREFIX = 'izzi-agent-';
const DEFAULT_EXEC_TIMEOUT = 30_000;
const PULL_TIMEOUT = 600_000; // 10 min — large images can take a while

/** Hermes always serves its API server on this container port. */
const HERMES_CONTAINER_PORT = 8642;
/** File (inside the agent data dir) that persists the generated API server key. */
const API_KEY_FILE = '.izzi-api-key';
/**
 * Chat timeout — agentic turns are slow: Hermes loads a large system/skills prompt
 * (~100k tokens) every turn, so even a simple reply can take 60-90s, and multi-step
 * tool runs take several minutes. 120s cut off almost everything; 10 min covers a
 * normal turn. (Truly long tasks want streaming — tracked separately.)
 */
const CHAT_TIMEOUT = 600_000;

/** Agents that need the Hermes-style API server (env + key + mounted data dir). */
export function agentNeedsApiServer(agentId: string): boolean {
  return agentId === 'hermes';
}

/**
 * Build the `config.yaml` content that points a Hermes agent's upstream LLM at
 * the local Izzi proxy. Pure so it can be unit-tested without touching disk.
 *
 * Verified empirically against `nousresearch/hermes-agent`: Hermes reads
 * `model.{provider,base_url,default,api_key}` from `$HERMES_HOME/config.yaml`
 * (it ignores the legacy OPENAI_* and LLM_MODEL env vars). `provider: custom` selects
 * any OpenAI-compatible endpoint. Values are emitted as double-quoted YAML scalars
 * (a JSON string is valid YAML), so URLs/tokens can't break the document.
 */
export function buildHermesConfigYaml(config: HermesModelConfig): string {
  const q = (s: string) => JSON.stringify(String(s));
  return [
    '# Managed by Izzi OpenClaw — routes this agent through your Izzi smart router.',
    '# Regenerated on each start (the local proxy port/token may change).',
    'model:',
    '  provider: custom',
    `  base_url: ${q(config.baseUrl)}`,
    `  default: ${q(config.model)}`,
    `  api_key: ${q(config.apiKey)}`,
    '',
  ].join('\n');
}

/** Reasoning-effort levels Hermes accepts (mirrors hermes_constants.VALID_REASONING_EFFORTS). */
export const VALID_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningEffort = (typeof VALID_REASONING_EFFORTS)[number];

/**
 * Return `yaml` with `agent.reasoning_effort` set to `level`. Surgical string edit:
 *   - replaces an existing `reasoning_effort:` line (any indent), else
 *   - inserts under an existing top-level `agent:` block, else
 *   - appends a new `agent:` block.
 * Everything else (provider/base_url/api_key, display, plugins, comments) is
 * preserved byte-for-byte, so this is safe to run on either the codex-lb config
 * or the model-only config the proxy path writes. Pure — unit-testable.
 */
export function upsertReasoningEffort(yaml: string, level: string): string {
  if (/^[ \t]*reasoning_effort:.*$/m.test(yaml)) {
    return yaml.replace(/^([ \t]*)reasoning_effort:.*$/m, `$1reasoning_effort: ${level}`);
  }
  if (/^agent:[ \t]*$/m.test(yaml)) {
    return yaml.replace(/^(agent:[ \t]*\r?\n)/m, `$1  reasoning_effort: ${level}\n`);
  }
  const sep = yaml.length === 0 || yaml.endsWith('\n') ? '' : '\n';
  return `${yaml}${sep}agent:\n  reasoning_effort: ${level}\n`;
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
 * the API server bound to 0.0.0.0 with the generated key, and runs `gateway run`.
 *
 * The upstream LLM provider is NOT seeded via env here — it comes from the
 * `config.yaml` written into the mounted data dir (see buildHermesConfigYaml),
 * which points Hermes at the local Izzi proxy.
 *
 * Pure function — unit-testable without invoking Docker. The CMD `gateway run`
 * is appended after the image (the image's entrypoint routes it correctly).
 */
export function buildHermesRunArgs(
  payload: DockerAgentPayload,
  options: HermesRunOptions,
): string[] {
  const name = dockerContainerName(payload.id);
  return [
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
    payload.dockerImage as string,
    'gateway',
    'run',
  ];
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

  /**
   * @param proxy Local Izzi LLM proxy that API-server agents (Hermes) route their
   *   upstream LLM calls through. Optional so unit tests can construct the service
   *   without a proxy (they exercise pure helpers and non-Hermes paths).
   */
  constructor(private readonly proxy?: IzziLlmProxy) {}

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
   * Start the agent container.
   *
   * API-server agents (Hermes) are RECREATED (`docker rm -f` + `docker run`) so a
   * freshly written config.yaml — pointing the agent at the local Izzi proxy on
   * the current port with the current token — always takes effect. User data
   * lives in the mounted /opt/data volume, so removing the container is
   * non-destructive. Other agents reuse an existing container (`docker start`).
   */
  async start(payload: DockerAgentPayload): Promise<DockerStartResult> {
    if (!payload.dockerImage) {
      return { ok: false, error: 'Agent không có docker image để chạy.' };
    }

    const name = dockerContainerName(payload.id);

    if (agentNeedsApiServer(payload.id)) {
      // Recreate so config changes apply. Data persists in the /opt/data volume.
      await this.exec(['rm', '-f', name], DEFAULT_EXEC_TIMEOUT); // ignore result — may not exist
      const args = await this.buildApiServerRunArgs(payload);
      const { code, stdout, stderr } = await this.exec(args, DEFAULT_EXEC_TIMEOUT);
      if (code !== 0) {
        // Redact the API server key in case it appears in docker's echoed error.
        const key = this.apiKeys.get(payload.id);
        return { ok: false, error: redactSecret(summarizeDockerError(stderr), key) };
      }
      return { ok: true, containerId: stdout.trim() || name };
    }

    const exists = await this.containerExists(name);
    const args = exists ? ['start', name] : buildDockerRunArgs(payload);
    const { code, stdout, stderr } = await this.exec(args, DEFAULT_EXEC_TIMEOUT);
    if (code !== 0) {
      return { ok: false, error: summarizeDockerError(stderr) };
    }
    return { ok: true, containerId: stdout.trim() || name };
  }

  /**
   * Build the Hermes-style run args: ensure the data dir exists, generate/persist
   * the API server key, and write a config.yaml that routes the agent's upstream
   * LLM through the local Izzi proxy (the proxy holds the Izzi credential — only
   * its localhost token is written into the container's config).
   */
  private async buildApiServerRunArgs(payload: DockerAgentPayload): Promise<string[]> {
    const dataDir = this.ensureAgentDataDir(payload.id);
    const apiServerKey = this.loadOrCreateApiKey(payload.id, dataDir);
    if (this.proxy) {
      const runtime = await this.proxy.ensureStarted();
      this.writeHermesConfig(dataDir, {
        baseUrl: runtime.baseUrl,
        apiKey: runtime.token,
        model: runtime.model,
      });
    }
    return buildHermesRunArgs(payload, {
      hostPort: payload.defaultPort,
      dataDir,
      apiServerKey,
    });
  }

  /**
   * Write config.yaml (Izzi smart-router routing) into the mounted data dir.
   * 0o600: it carries the localhost proxy token (a capability, not the Izzi key).
   */
  private writeHermesConfig(dataDir: string, config: HermesModelConfig): void {
    const file = path.join(dataDir, 'config.yaml');
    fs.writeFileSync(file, buildHermesConfigYaml(config), { encoding: 'utf8', mode: 0o600 });
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
   * Change the agent's reasoning effort: surgically update `agent.reasoning_effort`
   * in the mounted config.yaml, then `docker restart` so the agent re-reads it.
   *
   * Restart (not recreate) is deliberate: it re-reads the on-disk config.yaml while
   * preserving the provider/base_url/api_key already there. This does NOT go through
   * start() → writeHermesConfig, so it won't overwrite the upstream config. The
   * caller should wait for /health after this returns (the container needs a beat).
   */
  async setReasoningEffort(payload: DockerAgentPayload, effort: string): Promise<DockerResult> {
    const level = String(effort || '').toLowerCase();
    if (!(VALID_REASONING_EFFORTS as readonly string[]).includes(level)) {
      return { ok: false, error: `Mức reasoning không hợp lệ: ${effort}` };
    }

    const name = dockerContainerName(payload.id);
    if (!(await this.containerExists(name))) {
      return { ok: false, error: 'Agent chưa chạy — hãy khởi động agent trước khi đổi mức reasoning.' };
    }

    const cfgPath = path.join(this.agentDataDir(payload.id), 'config.yaml');
    let content: string;
    try {
      content = fs.readFileSync(cfgPath, 'utf8');
    } catch {
      return { ok: false, error: 'Không đọc được config.yaml của agent.' };
    }
    try {
      fs.writeFileSync(cfgPath, upsertReasoningEffort(content, level), { encoding: 'utf8', mode: 0o600 });
    } catch {
      return { ok: false, error: 'Không ghi được config.yaml của agent.' };
    }

    const { code, stderr } = await this.exec(['restart', name], DEFAULT_EXEC_TIMEOUT);
    if (code !== 0) {
      return { ok: false, error: summarizeDockerError(stderr) };
    }
    return { ok: true };
  }

  /**
   * Send a chat message to a Hermes-style agent via its OpenAI-compatible API.
   * Uses the in-memory/persisted API server key (kept in main, never exposed).
   * Returns the assistant reply, or a concise (key-redacted) error.
   *
   * When `stream.onEvent` + `stream.turnId` are provided, the reply is streamed
   * (SSE) and each content/reasoning delta is emitted live (Stage 1). Hermes runs
   * with `display.tool_progress: all`, so its tool progress rides in as content —
   * i.e. the stream itself surfaces the agent's process. The full reply is still
   * returned (back-compat).
   */
  async chat(
    payload: DockerAgentPayload,
    message: string,
    stream?: ChatStreamOptions,
  ): Promise<DockerChatResult> {
    const key = this.getApiKey(payload.id);
    if (!key) {
      return {
        ok: false,
        error: 'Chưa có API key cho agent (hãy cài/khởi động lại agent trước khi chat).',
      };
    }

    const url = `http://127.0.0.1:${payload.defaultPort}/v1/chat/completions`;

    if (stream?.onEvent && stream.turnId) {
      return this.chatStreaming(url, key, message, stream.onEvent, stream.turnId);
    }

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
      return { ok: false, error: await this.chatErrorMessage(err, key) };
    }
  }

  /**
   * Streaming variant: POST with `stream: true`, parse the SSE body, and emit
   * each content/reasoning delta via `onEvent`. Accumulates the full reply to
   * return. Never throws — maps failures to a concise, key-redacted error.
   */
  private async chatStreaming(
    url: string,
    key: string,
    message: string,
    onEvent: (evt: AgentTurnEvent) => void,
    turnId: string,
  ): Promise<DockerChatResult> {
    try {
      const res = await axios.post(
        url,
        {
          model: 'hermes-agent',
          messages: [{ role: 'user', content: message }],
          stream: true,
        },
        {
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          timeout: CHAT_TIMEOUT,
          responseType: 'stream',
        },
      );

      const body = res.data as NodeJS.ReadableStream;
      let buffer = '';
      let content = '';
      const consume = (block: string) => {
        const delta = parseOpenAiSseEvent(block);
        if (!delta || delta.done) return;
        if (delta.content) {
          content += delta.content;
          onEvent({ turnId, kind: 'delta', text: delta.content });
        }
        if (delta.reasoning) {
          onEvent({ turnId, kind: 'reasoning', text: delta.reasoning });
        }
      };

      await new Promise<void>((resolve, reject) => {
        body.on('data', (chunk: Buffer) => {
          buffer += chunk.toString('utf8');
          const { events, rest } = extractSseEvents(buffer);
          buffer = rest;
          for (const ev of events) consume(ev);
        });
        body.on('end', () => resolve());
        body.on('error', (e) => reject(e));
      });
      if (buffer.trim().length > 0) consume(buffer);

      if (content.length > 0) return { ok: true, reply: content };
      return { ok: false, error: 'Agent trả về phản hồi rỗng (có thể chưa cấu hình model provider).' };
    } catch (err: any) {
      return { ok: false, error: await this.chatErrorMessage(err, key, true) };
    }
  }

  /**
   * Build a concise, key-redacted error message from an axios failure. When the
   * request used a stream response, the error body is itself a stream, so drain
   * it (bounded) to recover the provider's message; otherwise read it directly.
   */
  private async chatErrorMessage(err: any, key: string, streamed = false): Promise<string> {
    let body = err?.response?.data;
    if (streamed && body && typeof body.on === 'function') {
      body = await this.drainStream(body as NodeJS.ReadableStream);
      try {
        body = JSON.parse(body as string);
      } catch {
        // leave as raw string
      }
    }
    const serverMsg =
      (body && typeof body === 'object' && ((body as any)?.error?.message || (body as any)?.error)) ||
      (typeof body === 'string' ? body : '') ||
      err?.message ||
      'Không gọi được Hermes API.';
    const text = typeof serverMsg === 'string' ? serverMsg : JSON.stringify(serverMsg);
    return redactSecret(text, key).slice(0, 400);
  }

  /** Drain a readable stream to a bounded string (best-effort; never throws). */
  private drainStream(stream: NodeJS.ReadableStream, maxBytes = 8192): Promise<string> {
    return new Promise((resolve) => {
      let out = '';
      let done = false;
      const finish = () => {
        if (!done) {
          done = true;
          resolve(out);
        }
      };
      const timer = setTimeout(finish, 3000);
      stream.on('data', (c: Buffer) => {
        if (out.length < maxBytes) out += c.toString('utf8');
      });
      stream.on('end', () => {
        clearTimeout(timer);
        finish();
      });
      stream.on('error', () => {
        clearTimeout(timer);
        finish();
      });
    });
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
