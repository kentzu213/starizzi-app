/**
 * IzziLlmProxy — localhost OpenAI-compatible gateway for Docker agents.
 *
 * Docker agents (e.g. Hermes) that speak the OpenAI wire protocol are pointed at
 * this proxy instead of a real provider. The proxy runs in the Electron MAIN
 * process, binds to 127.0.0.1 ONLY, and for every forwarded request it:
 *   1. authenticates the caller with a per-install localhost token (fail-closed);
 *   2. injects the signed-in user's Izzi credential as `Authorization: Bearer …`;
 *   3. forces the model to the Izzi smart router (`izzi-smart`);
 *   4. forwards to https://api.izziapi.com and streams the response (SSE) back.
 *
 * Security posture (security-baseline A/B/D):
 * - The Izzi credential (izzi key or Supabase JWT — billing/money) NEVER enters
 *   the container and is NEVER logged. It lives only in main and is added to the
 *   upstream request header here.
 * - 127.0.0.1 bind → not exposed on the LAN. A container still reaches it via
 *   `host.docker.internal` (Docker Desktop forwards that to host loopback).
 * - A localhost bearer token gates the surface so other local processes can't use
 *   it as a free authenticated Izzi gateway. Token + port persist in userData so a
 *   long-lived container keeps working across app restarts.
 *
 * No new dependency — Node's built-in `http`/`https`.
 *
 * @module main/agents/izzi-llm-proxy
 */
import * as http from 'http';
import * as https from 'https';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { URL } from 'url';

/** Canonical Izzi smart-router model id — triggers server-side model selection. */
export const IZZI_SMART_MODEL = 'izzi-smart';

/** Upstream Izzi origin (OpenAI-compatible). Paths are forwarded verbatim. */
const DEFAULT_UPSTREAM_ORIGIN = 'https://api.izziapi.com';

/** Preferred loopback port; falls back to an ephemeral port when taken. */
const PREFERRED_PORT = 8765;

/** Async resolver for the user's Izzi credential (never returned to the renderer). */
export type CredentialResolver = () => Promise<string | null>;

export interface ProxyRuntime {
  /** Loopback port the proxy is listening on. */
  port: number;
  /** Localhost bearer token the container must present. */
  token: string;
  /** base_url to configure into a container (via host.docker.internal). */
  baseUrl: string;
  /** Model id the proxy forces on every chat request. */
  model: string;
}

/**
 * Force the Izzi smart-router model on an OpenAI chat-completions body.
 *
 * Pure + defensive: returns a Buffer with `model` overwritten to `izzi-smart`.
 * If the body is not valid JSON (or not an object), it is returned unchanged so
 * the proxy stays a transparent forwarder for anything it doesn't understand.
 */
export function forceSmartModel(body: Buffer): Buffer {
  if (!body || body.length === 0) return body;
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      (parsed as Record<string, unknown>).model = IZZI_SMART_MODEL;
      return Buffer.from(JSON.stringify(parsed), 'utf8');
    }
  } catch {
    // Not JSON — forward as-is.
  }
  return body;
}

/** Whether a request path is an OpenAI-compatible route the proxy forwards. */
export function isForwardablePath(pathname: string): boolean {
  return pathname.startsWith('/v1/');
}

/** Constant-time comparison of two short secrets (avoids timing leaks). */
export function safeTokenEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a || '', 'utf8');
  const bb = Buffer.from(b || '', 'utf8');
  if (ba.length !== bb.length || ba.length === 0) return false;
  return crypto.timingSafeEqual(ba, bb);
}

/** Extract a bearer token from an `Authorization` header value. */
export function parseBearer(headerValue: string | undefined): string | null {
  if (!headerValue) return null;
  const m = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return m ? m[1].trim() : null;
}

export class IzziLlmProxy {
  private server: http.Server | null = null;
  private port = 0;
  private token = '';
  private readonly resolveCredential: CredentialResolver;
  private readonly statePath: string;
  private readonly upstreamOrigin: string;
  private startPromise: Promise<ProxyRuntime> | null = null;

  constructor(opts: {
    resolveCredential: CredentialResolver;
    /** File used to persist { port, token } across app restarts. */
    statePath: string;
    /** Override the upstream origin (tests / self-host). */
    upstreamOrigin?: string;
  }) {
    this.resolveCredential = opts.resolveCredential;
    this.statePath = opts.statePath;
    this.upstreamOrigin = (opts.upstreamOrigin || DEFAULT_UPSTREAM_ORIGIN).replace(/\/$/, '');
  }

  /** Start (idempotent) and return the runtime coordinates a container needs. */
  async ensureStarted(): Promise<ProxyRuntime> {
    if (this.server && this.port > 0) return this.runtime();
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.startInternal();
    try {
      return await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private runtime(): ProxyRuntime {
    return {
      port: this.port,
      token: this.token,
      baseUrl: `http://host.docker.internal:${this.port}/v1`,
      model: IZZI_SMART_MODEL,
    };
  }

  private async startInternal(): Promise<ProxyRuntime> {
    const persisted = this.loadState();
    this.token = persisted?.token || crypto.randomBytes(32).toString('hex');

    const server = http.createServer((req, res) => {
      // Never let a handler error crash the main process.
      this.handleRequest(req, res).catch(() => this.sendJson(res, 502, { error: { message: 'proxy error' } }));
    });
    server.on('clientError', (_err, socket) => {
      try { socket.destroy(); } catch { /* noop */ }
    });

    const preferred = persisted?.port && persisted.port > 0 ? persisted.port : PREFERRED_PORT;
    this.port = await this.listenWithFallback(server, preferred);
    this.server = server;
    this.saveState({ port: this.port, token: this.token });
    return this.runtime();
  }

  /** Try the preferred port on 127.0.0.1; on conflict fall back to an ephemeral port. */
  private listenWithFallback(server: http.Server, preferred: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const onError = (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          server.removeListener('error', onError);
          server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
          server.once('error', reject);
        } else {
          reject(err);
        }
      };
      server.once('error', onError);
      server.listen(preferred, '127.0.0.1', () => {
        server.removeListener('error', onError);
        resolve((server.address() as { port: number }).port);
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const pathname = (() => {
      try {
        return new URL(req.url || '/', 'http://127.0.0.1').pathname;
      } catch {
        return '/';
      }
    })();

    if (!isForwardablePath(pathname)) {
      return this.sendJson(res, 404, { error: { message: 'not found' } });
    }

    // Fail-closed localhost auth: the caller must present the proxy token.
    const presented = parseBearer(req.headers['authorization']) ?? (req.headers['x-api-key'] as string | undefined);
    if (!presented || !safeTokenEqual(presented, this.token)) {
      return this.sendJson(res, 401, { error: { message: 'unauthorized (invalid proxy token)' } });
    }

    // Resolve the real Izzi credential in main — never logged, never sent to renderer.
    const credential = await this.resolveCredential();
    if (!credential) {
      return this.sendJson(res, 401, {
        error: {
          message: 'Chưa đăng nhập Izzi. Đăng nhập izziapi.com trong app để dùng smart router.',
          type: 'no_izzi_credential',
        },
      });
    }

    const body = await this.readBody(req);
    const outBody =
      pathname === '/v1/chat/completions' && (req.method || 'GET').toUpperCase() === 'POST'
        ? forceSmartModel(body)
        : body;

    this.forwardUpstream(req, res, pathname, outBody, credential);
  }

  /** Forward the (model-forced, re-authed) request to Izzi and stream the reply back. */
  private forwardUpstream(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    body: Buffer,
    credential: string,
  ): void {
    const upstream = new URL(this.upstreamOrigin + pathname + this.search(req.url));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential}`,
      Accept: (req.headers['accept'] as string) || 'application/json',
    };
    const contentType = req.headers['content-type'];
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = typeof contentType === 'string' ? contentType : 'application/json';
      headers['Content-Length'] = String(body.length);
    }

    const upReq = https.request(
      {
        protocol: upstream.protocol,
        hostname: upstream.hostname,
        port: upstream.port || 443,
        path: upstream.pathname + upstream.search,
        method,
        headers,
      },
      (upRes) => {
        // Copy upstream status + headers verbatim (preserves SSE content-type).
        const outHeaders: http.OutgoingHttpHeaders = { ...upRes.headers };
        delete outHeaders['transfer-encoding']; // let Node re-chunk
        res.writeHead(upRes.statusCode || 502, outHeaders);
        upRes.pipe(res);
      },
    );
    upReq.on('error', () => this.sendJson(res, 502, { error: { message: 'upstream unreachable' } }));
    if (method !== 'GET' && method !== 'HEAD' && body.length > 0) upReq.write(body);
    upReq.end();
  }

  private search(rawUrl: string | undefined): string {
    if (!rawUrl) return '';
    const q = rawUrl.indexOf('?');
    return q >= 0 ? rawUrl.slice(q) : '';
  }

  private readBody(req: http.IncomingMessage): Promise<Buffer> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const MAX = 8 * 1024 * 1024; // 8 MB cap — chat payloads are small
      req.on('data', (c: Buffer) => {
        total += c.length;
        if (total <= MAX) chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks)));
      req.on('error', () => resolve(Buffer.concat(chunks)));
    });
  }

  private sendJson(res: http.ServerResponse, status: number, payload: unknown): void {
    if (res.headersSent) {
      try { res.end(); } catch { /* noop */ }
      return;
    }
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': String(data.length) });
    res.end(data);
  }

  private loadState(): { port: number; token: string } | null {
    try {
      const raw = fs.readFileSync(this.statePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.token === 'string' && typeof parsed.port === 'number') {
        return { port: parsed.port, token: parsed.token };
      }
    } catch {
      // no persisted state — first run
    }
    return null;
  }

  private saveState(state: { port: number; token: string }): void {
    try {
      fs.writeFileSync(this.statePath, JSON.stringify(state), { encoding: 'utf8', mode: 0o600 });
    } catch {
      // best-effort; token still held in-memory this session
    }
  }

  isRunning(): boolean {
    return this.server !== null && this.port > 0;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
      this.server = null;
      this.port = 0;
    });
  }
}
