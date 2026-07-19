import axios from 'axios';
import { randomUUID } from 'crypto';
import { parseManagedAgentStream } from './stream-parser';
import { readStreamBody, streamOpenAISse } from './openai-sse';
import type { ChatProvider } from './chat-provider';
import { buildIzziRequestHeaders, isOfficialIzziApiUrl } from './izzi-request-headers';
import type {
  ManagedAgentStatus,
  ManagedAgentStreamRequest,
  ManagedProviderStreamChunk,
} from './types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// IzziAPI cloud endpoint — OpenAI-compatible REST API for chat completions
// Note: The local OpenClaw Gateway (port 18789) is WebSocket-based and does NOT
// serve HTTP POST /v1/chat/completions. Chat must go through izziapi.com REST API.
//
// IMPORTANT: izziapi.com uses `x-api-key` header (NOT `Authorization: Bearer`)
// IMPORTANT: openclaw.json baseUrl already includes `/v1`, so we must NOT append it again
// See TROUBLESHOOTING.md Issue #1 for the /v1/v1/chat/completions double-path bug

// Canonical SmartRouter trigger. The server can select Grok/Codex or another
// healthy candidate without requiring a desktop release for each route change.
const DEFAULT_MODEL = 'izzi-smart';

/** Normalize legacy UI aliases while preserving every explicit model id. */
export function normalizeManagedModel(model: string | null | undefined): string {
  const value = model?.trim();
  if (!value || value === 'izzi/auto' || value === 'izzi-auto' || value === 'auto') {
    return DEFAULT_MODEL;
  }
  return value;
}

const MOCK_AGENT_MODE =
  process.env.STARIZZI_MOCK_AGENT_MODE === 'true' ||
  process.env.STARIZZI_MOCK_AGENT_MODE === '1';

function normalizeStatusPayload(payload: unknown): ManagedAgentStatus | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const data = payload as Record<string, unknown>;
  const state = String(data.state ?? data.status ?? '').toLowerCase();

  if (state !== 'idle' && state !== 'connecting' && state !== 'running' && state !== 'error') {
    return null;
  }

  return {
    state,
    lastError: typeof data.lastError === 'string'
      ? data.lastError
      : typeof data.error === 'string'
        ? data.error
        : undefined,
    updatedAt: typeof data.updatedAt === 'string'
      ? data.updatedAt
      : typeof data.updated_at === 'string'
        ? data.updated_at
        : new Date().toISOString(),
  };
}

/**
 * Read local ~/.openclaw/openclaw.json for IzziAPI credentials and config.
 * Returns { apiKey, baseUrl, model } from ninerouter provider config.
 * 
 * IMPORTANT: baseUrl in openclaw.json already includes `/v1`!
 * Do NOT append `/v1` again or you get 404 from /v1/v1/chat/completions.
 * See TROUBLESHOOTING.md Issue #1.
 */
function getLocalConfig(): { apiKey: string | null; baseUrl: string | null; model: string | null } {
  try {
    const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
    if (!fs.existsSync(configPath)) return { apiKey: null, baseUrl: null, model: null };
    const raw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(raw);

    const ninerouter = config?.models?.providers?.ninerouter;
    const apiKey = ninerouter?.apiKey || config?.apiKey || null;
    const baseUrl = ninerouter?.baseUrl || null; // e.g. "https://api.izziapi.com/v1"
    
    // Get the primary model from agents config
    const primaryModel = config?.agents?.defaults?.model?.primary || null;

    return { apiKey, baseUrl, model: primaryModel };
  } catch {
    return { apiKey: null, baseUrl: null, model: null };
  }
}

/**
 * Build OpenAI-compatible /v1/chat/completions payload.
 * 
 * izziapi.com exposes OpenAI-compatible endpoints:
 * - /v1/chat/completions (streaming SSE)  
 * - /v1/models
 * 
 * Auth: x-api-key header (NOT Authorization: Bearer)
 * Model: uses configured model or falls back to DEFAULT_MODEL
 */
function buildOpenAIPayload(request: ManagedAgentStreamRequest, model: string, stream: boolean) {
  const messages = [
    ...request.history.map((msg) => ({
      role: msg.role,
      content: msg.content,
    })),
    {
      role: 'user' as const,
      content: request.message,
    },
  ];

  return {
    model,
    messages,
    stream,
  };
}

export class ManagedAgentProvider implements ChatProvider {
  private getAccessToken: () => Promise<string | null>;
  private mockMode: boolean;

  constructor(options: {
    getAccessToken: () => Promise<string | null>;
  }) {
    this.getAccessToken = options.getAccessToken;
    this.mockMode = MOCK_AGENT_MODE;
  }

  /**
   * Resolve chat URL from openclaw.json config.
   * baseUrl already includes /v1 (e.g. "https://api.izziapi.com/v1")
   * so we only append /chat/completions.
   */
  private getChatUrl(): string {
    const config = getLocalConfig();
    if (config.baseUrl) {
      // baseUrl = "https://api.izziapi.com/v1" → append /chat/completions
      return `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
    }
    // Fallback: hardcoded URL
    return 'https://api.izziapi.com/v1/chat/completions';
  }

  async *streamChat(
    request: ManagedAgentStreamRequest,
  ): AsyncGenerator<ManagedProviderStreamChunk> {
    if (this.mockMode) {
      yield { type: 'status', state: 'connecting' };
      await new Promise((resolve) => setTimeout(resolve, 70));
      yield { type: 'status', state: 'running' };
      yield { type: 'assistant_start' };
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield { type: 'assistant_delta', delta: `Da nhan muc tieu: ${request.message}. ` };
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield {
        type: 'task_upsert',
        task: {
          id: `task-${request.sessionId}`,
          sessionId: request.sessionId,
          title: 'Xac nhan release gate cho desktop app',
          status: 'in_progress',
          summary: 'Review updater, packaging va UAT checklist truoc khi phat hanh.',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
      yield {
        type: 'memory_upsert',
        memory: {
          id: `memory-${request.sessionId}`,
          sessionId: request.sessionId,
          kind: 'constraint',
          content: 'Managed runner la execution mode duy nhat trong desktop app.',
          pinned: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      };
      await new Promise((resolve) => setTimeout(resolve, 80));
      yield {
        type: 'assistant_delta',
        delta: 'Task va memory mock da duoc tao de phuc vu smoke validation.',
      };
      yield { type: 'assistant_done' };
      return;
    }

    // Get API key and config from local OpenClaw config (set by installer)
    const config = getLocalConfig();
    const localApiKey = config.apiKey;
    const accessToken = await this.getAccessToken();
    const chatUrl = this.getChatUrl();
    const officialIzziOrigin = isOfficialIzziApiUrl(chatUrl);

    if (!localApiKey && (!accessToken || !officialIzziOrigin)) {
      throw new Error('Missing IzziAPI API key. Run the izzi-openclaw installer first.');
    }

    // Resolve model: legacy SmartRouter aliases → canonical izzi-smart; explicit
    // ids such as grok-4.5-high pass through unchanged.
    const model = normalizeManagedModel(config.model);

    // Build auth headers
    // CRITICAL: izziapi.com uses `x-api-key` header, NOT `Authorization: Bearer`
    const idempotencyKey = officialIzziOrigin ? randomUUID() : undefined;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      ...buildIzziRequestHeaders(chatUrl, idempotencyKey),
    };

    if (localApiKey) {
      headers['x-api-key'] = localApiKey;
    } else if (accessToken) {
      // Fallback to Bearer for Supabase token (if server supports it)
      headers['Authorization'] = `Bearer ${accessToken}`;
    }

    console.log(`[ManagedAgentProvider] POST ${chatUrl} model=${model}`);

    const response = await axios.request<NodeJS.ReadableStream>({
      method: 'POST',
      url: chatUrl,
      data: buildOpenAIPayload(request, model, true),
      responseType: 'stream',
      validateStatus: () => true,
      headers,
      timeout: 120000,
    });

    if (response.status >= 400) {
      const body = await readStreamBody(response.data);
      const shouldRetryNonStreaming =
        response.status === 400 &&
        (/not supported/i.test(body) || (/stream(?:ing)?/i.test(body) && /temporarily unavailable/i.test(body)));
      if (!shouldRetryNonStreaming) {
        throw new Error(body || `Chat completions endpoint returned HTTP ${response.status}`);
      }

      const fallback = await axios.request({
        method: 'POST',
        url: chatUrl,
        data: buildOpenAIPayload(request, model, false),
        validateStatus: () => true,
        headers: { ...headers, Accept: 'application/json' },
        timeout: 120000,
      });
      if (fallback.status >= 400) {
        const rawBody =
          typeof fallback.data === 'string' ? fallback.data : JSON.stringify(fallback.data ?? '');
        throw new Error(rawBody || `Chat completions endpoint returned HTTP ${fallback.status}`);
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

    const contentType = String(response.headers['content-type'] ?? '');

    // Handle OpenAI SSE format: data: {"choices":[{"delta":{"content":"..."}}]}
    if (contentType.includes('text/event-stream') || contentType.includes('text/plain')) {
      yield { type: 'status', state: 'running' };
      yield { type: 'assistant_start' };
      yield* streamOpenAISse(response.data);
    } else {
      // Fallback: try the original stream parser for non-SSE responses
      yield* parseManagedAgentStream(response.data, contentType);
    }
  }

  async getStatus(_sessionId?: string): Promise<ManagedAgentStatus | null> {
    if (this.mockMode) {
      return {
        state: 'idle',
        updatedAt: new Date().toISOString(),
      };
    }

    // Status is managed locally — no /api/agent/status endpoint exists
    // Return idle status since we use direct /v1/chat/completions streaming
    return {
      state: 'idle',
      updatedAt: new Date().toISOString(),
    };
  }
}
