/**
 * GraphAgent — the AI layer for the Branching Graph Workspace. Lives in the
 * Electron MAIN process; the Izzi API key NEVER leaves main and is never logged.
 *
 * Calls Izzi via its OpenAI-compatible endpoint (`/v1/chat/completions`). The key
 * is resolved from `OPENAI_API_KEY` (env) or the signed-in user's izzi API key
 * (`AuthManager.getApiKey()`) — so usage is billed to the user's izzi account.
 * If no key is available the chat returns an empty reply and the renderer falls
 * back to its local heuristic (so the UI is never broken).
 *
 * Two separate concerns: (1) the chat reply, (2) a branch-classifier JSON call.
 * Non-streaming for now; the IPC contract is stable so streaming can be added
 * later without changing the renderer. TODO(stream): emit deltas via a channel.
 *
 * Security (security-baseline A/B): key only here, only in the Authorization
 * header over HTTPS; prompts and key are never logged; classifier output is
 * parsed as untrusted data in graph-agent-core.
 *
 * @module main/graph/graph-agent
 */
import type { AuthManager } from '../auth/auth-manager';
import type { GraphNode } from '../../shared/graph-types';
import {
  buildChatMessages,
  buildClassifierMessages,
  parseClassification,
  type ChatMessage,
  type ParsedClassification,
} from './graph-agent-core';

const IZZI_LLM_BASE = process.env.OPENAI_BASE_URL || 'https://api.izziapi.com/v1';
const IZZI_MODEL = process.env.IZZI_MODEL || 'auto';

export interface GraphAgentChatPayload {
  node: GraphNode;
  ancestors: GraphNode[];
  message: string;
}

export interface GraphAgentChatResult {
  reply: string;
  classification: ParsedClassification | null;
}

export class GraphAgent {
  constructor(private readonly auth: AuthManager) {}

  /** Resolve the Izzi key: env first, else the signed-in user's API key. Never logged. */
  private resolveKey(): string | null {
    const envKey = process.env.OPENAI_API_KEY;
    if (typeof envKey === 'string' && envKey.trim().length > 0) return envKey.trim();
    const userKey = typeof this.auth.getApiKey === 'function' ? this.auth.getApiKey() : null;
    return typeof userKey === 'string' && userKey.trim().length > 0 ? userKey.trim() : null;
  }

  async chat(payload: GraphAgentChatPayload): Promise<GraphAgentChatResult> {
    const node = payload?.node;
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    if (!node || typeof node.id !== 'string' || message.length === 0) {
      return { reply: '', classification: null };
    }

    const key = this.resolveKey();
    if (!key) return { reply: '', classification: null }; // → renderer heuristic fallback

    const ancestors = Array.isArray(payload.ancestors) ? payload.ancestors : [];

    const reply = await this.complete(buildChatMessages(node, ancestors, message), key, 600);
    if (!reply) return { reply: '', classification: null };

    // Best-effort branch classification (second, cheap call). Never breaks the reply.
    let classification: ParsedClassification | null = null;
    const raw = await this.complete(buildClassifierMessages(message, reply), key, 300);
    if (raw) classification = parseClassification(raw, node.id);

    return { reply, classification };
  }

  /** One OpenAI-compatible completion (non-streaming). Returns '' on any failure. */
  private async complete(messages: ChatMessage[], key: string, maxTokens: number): Promise<string> {
    try {
      const res = await fetch(`${IZZI_LLM_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model: IZZI_MODEL, messages, max_tokens: maxTokens, stream: false }),
      });
      if (!res.ok) return '';
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = data?.choices?.[0]?.message?.content;
      return typeof content === 'string' ? content : '';
    } catch {
      return ''; // network/parse failure → renderer falls back; never throw
    }
  }
}
