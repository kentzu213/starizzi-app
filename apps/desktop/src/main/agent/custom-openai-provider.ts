import axios from 'axios';
import { randomUUID } from 'crypto';
import type { ChatProvider, ProviderTestResult } from './chat-provider';
import { readStreamBody, streamOpenAISse } from './openai-sse';
import type { CustomProviderConfig } from './provider-settings-store';
import { buildIzziRequestHeaders } from './izzi-request-headers';
import type {
  ManagedAgentStatus,
  ManagedAgentStreamRequest,
  ManagedProviderStreamChunk,
} from './types';

const REQUEST_TIMEOUT_MS = 120000;

/** True for a base64 data URL that carries an image (the only image form we accept). */
function isDataImage(u: unknown): u is string {
  return typeof u === 'string' && u.startsWith('data:image/');
}

/**
 * Build the OpenAI-compatible `content` for the user turn: a plain string when
 * there are no images, or a content-parts array (text + image_url) when images
 * are attached. Vision-capable endpoints (e.g. codex-lb / gpt-5.5) read the
 * image_url parts.
 */
function buildUserContent(message: string, images: string[]): unknown {
  if (images.length === 0) return message;
  return [
    ...(message ? [{ type: 'text', text: message }] : []),
    ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
}

/** Resolve the chat completions URL from a base URL, avoiding the double `/v1` bug. */
export function resolveChatCompletionsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  if (/\/chat\/completions$/.test(base)) return base;
  if (/\/v1$/.test(base)) return `${base}/chat/completions`;
  return `${base}/v1/chat/completions`;
}

/** Build the auth header(s) for the given auth type (Bearer or x-api-key). */
export function buildAuthHeaders(authType: 'bearer' | 'x-api-key', apiKey: string): Record<string, string> {
  return authType === 'bearer' ? { Authorization: `Bearer ${apiKey}` } : { 'x-api-key': apiKey };
}

/** Resolve the models-list URL from a base URL, mirroring the chat URL rules. */
export function resolveModelsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, '');
  if (/\/models$/.test(base)) return base;
  if (/\/v1$/.test(base)) return `${base}/models`;
  return `${base}/v1/models`;
}

/**
 * Map an HTTP/error condition into a concise, key-free message (R6).
 * `redact` is supplied by the caller (SecretStore.redact) so any key in the
 * raw body is scrubbed before the message is surfaced or logged.
 */
function describeHttpError(status: number, rawBody: string, redact: (text: string) => string): string {
  if (status === 401 || status === 403) {
    return `Xác thực thất bại (HTTP ${status}) — kiểm tra API key/kiểu auth`;
  }
  const summary = redact(rawBody).split('\n')[0]?.slice(0, 120) || '';
  return summary
    ? `Endpoint trả HTTP ${status}: ${summary}`
    : `Endpoint trả HTTP ${status}`;
}

function describeNetworkError(error: unknown, redact: (text: string) => string): string {
  const code = (error as { code?: string })?.code;
  if (code === 'ECONNABORTED' || code === 'ETIMEDOUT') {
    return 'Không kết nối được tới endpoint / hết thời gian chờ';
  }
  const message = error instanceof Error ? error.message : 'Lỗi mạng không xác định';
  return redact(message) || 'Không kết nối được tới endpoint';
}

function isStreamingFallbackError(status: number, rawBody: string): boolean {
  if (status !== 400) return false;
  return /not supported/i.test(rawBody) || (/stream(?:ing)?/i.test(rawBody) && /temporarily unavailable/i.test(rawBody));
}

/**
 * CustomOpenAIProvider — streams chat from a user-supplied OpenAI-compatible
 * endpoint. The API key is received as a transient constructor argument from the
 * resolver and is never persisted as durable state beyond this instance.
 */
export class CustomOpenAIProvider implements ChatProvider {
  private config: CustomProviderConfig;
  private apiKey: string;
  /** Redactor injected by the resolver so error messages never leak the key. */
  private redact: (text: string) => string;

  constructor(
    config: CustomProviderConfig,
    apiKey: string,
    redact: (text: string) => string = (t) => t,
  ) {
    this.config = config;
    this.apiKey = apiKey;
    this.redact = redact;
  }

  /**
   * Resolve the chat completions URL, avoiding the double `/v1` bug.
   * - ends with `/chat/completions` → use as-is
   * - ends with `/v1` → append `/chat/completions`
   * - otherwise → append `/v1/chat/completions`
   */
  private getChatUrl(): string {
    return resolveChatCompletionsUrl(this.config.baseUrl);
  }

  private buildHeaders(
    accept = 'text/event-stream',
    url = this.getChatUrl(),
    idempotencyKey?: string,
  ): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Accept: accept,
      ...buildIzziRequestHeaders(url, idempotencyKey),
      ...buildAuthHeaders(this.config.authType, this.apiKey),
    };
  }

  async *streamChat(
    request: ManagedAgentStreamRequest,
  ): AsyncGenerator<ManagedProviderStreamChunk> {
    const images = Array.isArray(request.images) ? request.images.filter(isDataImage) : [];
    const messages: Array<{ role: string; content: unknown }> = [
      ...request.history.map((msg) => ({ role: msg.role, content: msg.content })),
      { role: 'user', content: buildUserContent(request.message, images) },
    ];

    const chatUrl = this.getChatUrl();
    const idempotencyKey = Object.keys(buildIzziRequestHeaders(chatUrl)).length > 0 ? randomUUID() : undefined;
    let response;
    try {
      response = await axios.request<NodeJS.ReadableStream>({
        method: 'POST',
        url: chatUrl,
        data: { model: this.config.selectedModel, messages, stream: true },
        responseType: 'stream',
        validateStatus: () => true,
        headers: this.buildHeaders('text/event-stream', chatUrl, idempotencyKey),
        timeout: REQUEST_TIMEOUT_MS,
      });
    } catch (error) {
      throw new Error(describeNetworkError(error, this.redact));
    }

    if (response.status >= 400) {
      const body = await readStreamBody(response.data);
      if (isStreamingFallbackError(response.status, body)) {
        let fallback;
        try {
          fallback = await axios.request({
            method: 'POST',
            url: chatUrl,
            data: { model: this.config.selectedModel, messages, stream: false },
            validateStatus: () => true,
            headers: this.buildHeaders('application/json', chatUrl, idempotencyKey),
            timeout: REQUEST_TIMEOUT_MS,
          });
        } catch (error) {
          throw new Error(describeNetworkError(error, this.redact));
        }

        if (fallback.status >= 400) {
          const rawBody =
            typeof fallback.data === 'string'
              ? fallback.data
              : JSON.stringify(fallback.data ?? '');
          throw new Error(describeHttpError(fallback.status, rawBody, this.redact));
        }

        const content = fallback.data?.choices?.[0]?.message?.content;
        yield { type: 'status', state: 'running' };
        yield { type: 'assistant_start' };
        if (typeof content === 'string' && content.length > 0) {
          yield { type: 'assistant_delta', delta: content };
        }
        yield { type: 'assistant_done' };
        return;
      }
      throw new Error(describeHttpError(response.status, body, this.redact));
    }

    yield { type: 'status', state: 'running' };
    yield { type: 'assistant_start' };
    yield* streamOpenAISse(response.data);
  }

  /** Small probe request to verify key/URL/model without sending a real chat (R7). */
  async testConnection(): Promise<ProviderTestResult> {
    try {
      const response = await axios.request<unknown>({
        method: 'POST',
        url: this.getChatUrl(),
        data: {
          model: this.config.selectedModel,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
          stream: false,
        },
        validateStatus: () => true,
        headers: this.buildHeaders('application/json'),
        timeout: REQUEST_TIMEOUT_MS,
      });

      if (response.status >= 200 && response.status < 300) {
        return { ok: true, model: this.config.selectedModel, httpStatus: response.status };
      }

      const rawBody = typeof response.data === 'string'
        ? response.data
        : JSON.stringify(response.data ?? '');
      return {
        ok: false,
        httpStatus: response.status,
        message: describeHttpError(response.status, rawBody, this.redact),
      };
    } catch (error) {
      return { ok: false, message: describeNetworkError(error, this.redact) };
    }
  }

  /**
   * List the models the endpoint exposes via `GET {baseUrl}/models` (OpenAI
   * format: `{ data: [{ id }] }`). Powers dynamic model discovery — whatever the
   * local router serves (codex-lb gpt-5.6-*, or any model added later) shows up
   * automatically. Errors are redacted of the key.
   */
  async listModels(): Promise<{ ok: boolean; models?: string[]; error?: string }> {
    try {
      const response = await axios.request<unknown>({
        method: 'GET',
        url: resolveModelsUrl(this.config.baseUrl),
        validateStatus: () => true,
        headers: {
          Accept: 'application/json',
          ...buildIzziRequestHeaders(resolveModelsUrl(this.config.baseUrl)),
          ...buildAuthHeaders(this.config.authType, this.apiKey),
        },
        timeout: 15000,
      });

      if (response.status < 200 || response.status >= 300) {
        const rawBody =
          typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? '');
        return { ok: false, error: describeHttpError(response.status, rawBody, this.redact) };
      }

      const data = response.data as { data?: Array<{ id?: unknown }> };
      const models = Array.isArray(data?.data)
        ? data.data
            .map((m) => (typeof m?.id === 'string' ? m.id : ''))
            .filter((id): id is string => id.length > 0)
        : [];
      return { ok: true, models };
    } catch (error) {
      return { ok: false, error: describeNetworkError(error, this.redact) };
    }
  }

  async getStatus(): Promise<ManagedAgentStatus | null> {
    return { state: 'idle', updatedAt: new Date().toISOString() };
  }
}
