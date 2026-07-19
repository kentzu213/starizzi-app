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

/** Exact production marker that permits the one safe stream=false retry. */
export const FIXED_PRICE_STREAMING_ERROR =
  'Streaming is temporarily unavailable for fixed-price models; retry with stream=false.';

/** Caps buffered error/JSON fallback responses before failing closed. */
const MAX_FALLBACK_RESPONSE_BYTES = 2 * 1024 * 1024;

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

function parseJsonObject(body: Buffer): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(body.toString('utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

/** Build the sole permitted fallback request while retaining every other JSON field. */
export function createNonStreamingRetryBody(body: Buffer): Buffer | null {
  const parsed = parseJsonObject(body);
  if (!parsed || parsed.stream !== true) return null;
  return Buffer.from(JSON.stringify({ ...parsed, stream: false }), 'utf8');
}

/** Match only the exact production HTTP 400 marker; unrelated 400s are not retried. */
export function isFixedPriceStreamingLimitation(statusCode: number | undefined, body: Buffer): boolean {
  if (statusCode !== 400) return false;
  const parsed = parseJsonObject(body);
  const error = parsed?.error;
  return Boolean(
    error &&
    typeof error === 'object' &&
    !Array.isArray(error) &&
    (error as Record<string, unknown>).message === FIXED_PRICE_STREAMING_ERROR,
  );
}

/** Convert one non-streaming OpenAI completion into standard SSE completion chunks. */
export function chatCompletionJsonToSse(body: Buffer): Buffer | null {
  const parsed = parseJsonObject(body);
  if (!parsed || !Array.isArray(parsed.choices)) return null;

  const base: Record<string, unknown> = {
    id: typeof parsed.id === 'string' ? parsed.id : 'chatcmpl-izzi-proxy',
    object: 'chat.completion.chunk',
    created: typeof parsed.created === 'number' ? parsed.created : 0,
    model: typeof parsed.model === 'string' ? parsed.model : IZZI_SMART_MODEL,
  };
  if (parsed.system_fingerprint !== undefined) base.system_fingerprint = parsed.system_fingerprint;
  if (parsed.service_tier !== undefined) base.service_tier = parsed.service_tier;

  const normalized = parsed.choices.map((rawChoice, position) => {
    const choice = rawChoice && typeof rawChoice === 'object' && !Array.isArray(rawChoice)
      ? rawChoice as Record<string, unknown>
      : {};
    const rawMessage = choice.message;
    const message = rawMessage && typeof rawMessage === 'object' && !Array.isArray(rawMessage)
      ? { ...(rawMessage as Record<string, unknown>) }
      : {};
    const rawToolCalls = message.tool_calls;
    if (Array.isArray(rawToolCalls)) {
      message.tool_calls = rawToolCalls.map((rawToolCall, toolIndex) => {
        if (!rawToolCall || typeof rawToolCall !== 'object' || Array.isArray(rawToolCall)) {
          return rawToolCall;
        }
        const toolCall = rawToolCall as Record<string, unknown>;
        return {
          ...toolCall,
          index: typeof toolCall.index === 'number' ? toolCall.index : toolIndex,
        };
      });
    }
    const index = typeof choice.index === 'number' ? choice.index : position;
    const inferredFinish = Array.isArray(message.tool_calls) && message.tool_calls.length > 0
      ? 'tool_calls'
      : 'stop';
    return {
      index,
      message,
      finishReason: typeof choice.finish_reason === 'string' ? choice.finish_reason : inferredFinish,
      logprobs: choice.logprobs ?? null,
    };
  });

  const deltaChunk = {
    ...base,
    choices: normalized.map((choice) => ({
      index: choice.index,
      delta: choice.message,
      logprobs: choice.logprobs,
      finish_reason: null,
    })),
  };
  const terminalChunk: Record<string, unknown> = {
    ...base,
    choices: normalized.map((choice) => ({
      index: choice.index,
      delta: {},
      logprobs: choice.logprobs,
      finish_reason: choice.finishReason,
    })),
  };
  if (parsed.usage !== undefined) terminalChunk.usage = parsed.usage;

  return Buffer.from(
    `data: ${JSON.stringify(deltaChunk)}\n\ndata: ${JSON.stringify(terminalChunk)}\n\ndata: [DONE]\n\n`,
    'utf8',
  );
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

  /** Forward once, retrying only the exact fixed-price streaming limitation. */
  private forwardUpstream(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    body: Buffer,
    credential: string,
  ): void {
    const method = (req.method || 'GET').toUpperCase();
    const retryBody = pathname === '/v1/chat/completions' && method === 'POST'
      ? createNonStreamingRetryBody(body)
      : null;
    const idempotencyKey = retryBody ? crypto.randomUUID() : undefined;

    this.openUpstreamRequest(
      req,
      res,
      pathname,
      body,
      credential,
      idempotencyKey,
      (req.headers['accept'] as string) || 'application/json',
      (upRes) => {
        if (!retryBody || upRes.statusCode !== 400) {
          this.pipeUpstreamResponse(upRes, res);
          return;
        }

        this.readBoundedResponse(upRes).then((errorBody) => {
          if (!errorBody) {
            this.sendJson(res, 502, { error: { message: 'upstream response too large' } });
            return;
          }
          if (!isFixedPriceStreamingLimitation(upRes.statusCode, errorBody)) {
            this.sendBufferedUpstreamResponse(upRes, res, errorBody);
            return;
          }
          this.retryWithoutStreaming(
            req,
            res,
            pathname,
            retryBody,
            credential,
            idempotencyKey!,
          );
        });
      },
    );
  }

  private retryWithoutStreaming(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    body: Buffer,
    credential: string,
    idempotencyKey: string,
  ): void {
    this.openUpstreamRequest(
      req,
      res,
      pathname,
      body,
      credential,
      idempotencyKey,
      'application/json',
      (upRes) => {
        const status = upRes.statusCode || 502;
        if (status < 200 || status >= 300) {
          this.pipeUpstreamResponse(upRes, res);
          return;
        }

        this.readBoundedResponse(upRes).then((jsonBody) => {
          if (!jsonBody) {
            this.sendJson(res, 502, { error: { message: 'upstream response too large' } });
            return;
          }
          const sseBody = chatCompletionJsonToSse(jsonBody);
          if (!sseBody) {
            this.sendJson(res, 502, { error: { message: 'invalid upstream completion' } });
            return;
          }
          const headers: http.OutgoingHttpHeaders = { ...upRes.headers };
          delete headers['content-encoding'];
          delete headers['content-length'];
          delete headers['transfer-encoding'];
          delete headers.connection;
          headers['content-type'] = 'text/event-stream; charset=utf-8';
          headers['cache-control'] = 'no-cache';
          headers['content-length'] = String(sseBody.length);
          res.writeHead(status, headers);
          res.end(sseBody);
        });
      },
    );
  }

  private openUpstreamRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    pathname: string,
    body: Buffer,
    credential: string,
    idempotencyKey: string | undefined,
    accept: string,
    onResponse: (upRes: http.IncomingMessage) => void,
  ): void {
    const upstream = new URL(this.upstreamOrigin + pathname + this.search(req.url));
    const headers: Record<string, string> = {
      Authorization: `Bearer ${credential}`,
      Accept: accept,
      'X-Source-Platform': 'starizzi',
    };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

    const contentType = req.headers['content-type'];
    const method = (req.method || 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      headers['Content-Type'] = typeof contentType === 'string' ? contentType : 'application/json';
      headers['Content-Length'] = String(body.length);
    }

    const requestOptions: http.RequestOptions = {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === 'http:' ? 80 : 443),
      path: upstream.pathname + upstream.search,
      method,
      headers,
    };
    let receivedResponse = false;
    const handleUpstreamResponse = (upRes: http.IncomingMessage) => {
      receivedResponse = true;
      onResponse(upRes);
    };
    const upReq = upstream.protocol === 'http:'
      ? http.request(requestOptions, handleUpstreamResponse)
      : https.request(requestOptions, handleUpstreamResponse);
    upReq.on('error', () => {
      if (!receivedResponse) this.sendJson(res, 502, { error: { message: 'upstream unreachable' } });
    });
    if (method !== 'GET' && method !== 'HEAD' && body.length > 0) upReq.write(body);
    upReq.end();
  }

  private readBoundedResponse(upRes: http.IncomingMessage): Promise<Buffer | null> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      let total = 0;
      let exceeded = false;
      upRes.on('data', (chunk: Buffer) => {
        if (exceeded) return;
        total += chunk.length;
        if (total > MAX_FALLBACK_RESPONSE_BYTES) {
          exceeded = true;
          chunks.length = 0;
          return;
        }
        chunks.push(chunk);
      });
      upRes.on('end', () => resolve(exceeded ? null : Buffer.concat(chunks)));
      upRes.on('error', () => resolve(null));
    });
  }

  private pipeUpstreamResponse(upRes: http.IncomingMessage, res: http.ServerResponse): void {
    const headers: http.OutgoingHttpHeaders = { ...upRes.headers };
    delete headers['transfer-encoding'];
    res.writeHead(upRes.statusCode || 502, headers);
    upRes.pipe(res);
  }

  private sendBufferedUpstreamResponse(
    upRes: http.IncomingMessage,
    res: http.ServerResponse,
    body: Buffer,
  ): void {
    const headers: http.OutgoingHttpHeaders = { ...upRes.headers };
    delete headers['transfer-encoding'];
    headers['content-length'] = String(body.length);
    res.writeHead(upRes.statusCode || 502, headers);
    res.end(body);
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
