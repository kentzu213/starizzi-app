/**
 * IzziAgent — the chat layer for IZZI-NATIVE persona agents (Socrates,
 * Orchestrator) shown in the Agent Hub. Lives in the Electron MAIN process; the
 * Izzi API key NEVER leaves main and is never logged.
 *
 * Unlike the local Docker agents (OpenClaw/Hermes), these run through the Izzi
 * OpenAI-compatible endpoint (`/v1/chat/completions`) with a persona system
 * prompt — so they "install" instantly (no container) and bill to the signed-in
 * user's Izzi account. Mirrors the GraphAgent key-resolution + call pattern.
 *
 * Security (security-baseline A/B): key resolved from `OPENAI_API_KEY` env or the
 * signed-in user's izzi key (`AuthManager.getApiKey()`), used only in the
 * Authorization header over HTTPS, never logged, never returned across IPC.
 *
 * @module main/agents/izzi-agent
 */
import { ipcMain } from 'electron';
import type { AuthManager } from '../auth/auth-manager';

const IZZI_LLM_BASE = process.env.OPENAI_BASE_URL || 'https://api.izziapi.com/v1';

export interface IzziAgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface IzziAgentChatPayload {
  systemPrompt: string;
  message: string;
  history?: IzziAgentMessage[];
  model?: string;
}

export interface IzziAgentChatResult {
  reply: string;
  error?: string;
}

const ROLES = new Set(['system', 'user', 'assistant']);

export class IzziAgent {
  constructor(private readonly auth: AuthManager) {}

  /** Resolve the Izzi key: env first, else the signed-in user's API key. Never logged. */
  private resolveKey(): string | null {
    const envKey = process.env.OPENAI_API_KEY;
    if (typeof envKey === 'string' && envKey.trim().length > 0) return envKey.trim();
    const userKey = typeof this.auth.getApiKey === 'function' ? this.auth.getApiKey() : null;
    return typeof userKey === 'string' && userKey.trim().length > 0 ? userKey.trim() : null;
  }

  async chat(payload: IzziAgentChatPayload): Promise<IzziAgentChatResult> {
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    if (message.length === 0) return { reply: '', error: 'empty' };

    const key = this.resolveKey();
    if (!key) return { reply: '', error: 'no-key' };

    const system = typeof payload.systemPrompt === 'string' ? payload.systemPrompt : '';
    // The Izzi smart router accepts a bare model id; strip any "izzi/" UI prefix.
    const model = (typeof payload.model === 'string' && payload.model ? payload.model : 'auto').replace(
      /^izzi\//,
      '',
    );
    const history: IzziAgentMessage[] = Array.isArray(payload.history)
      ? payload.history
          .filter(
            (m): m is IzziAgentMessage =>
              m !== null &&
              typeof m === 'object' &&
              ROLES.has((m as IzziAgentMessage).role) &&
              typeof (m as IzziAgentMessage).content === 'string' &&
              (m as IzziAgentMessage).content.trim().length > 0,
          )
          .slice(-10)
      : [];

    const messages: IzziAgentMessage[] = [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      ...history,
      { role: 'user' as const, content: message },
    ];

    try {
      const res = await fetch(`${IZZI_LLM_BASE}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages, stream: false, max_tokens: 1200 }),
      });
      if (!res.ok) return { reply: '', error: `http ${res.status}` };
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = data?.choices?.[0]?.message?.content;
      return typeof content === 'string' && content.length > 0
        ? { reply: content }
        : { reply: '', error: 'empty-response' };
    } catch {
      return { reply: '', error: 'network' };
    }
  }
}

/**
 * Register the `izziAgent:chat` IPC handler. The Izzi key stays inside IzziAgent
 * (main process) and NEVER crosses the bridge — the renderer only receives
 * `{ reply, error }`.
 */
export function registerIzziAgentIpc(agent: IzziAgent): void {
  ipcMain.handle('izziAgent:chat', (_e, payload: IzziAgentChatPayload) => agent.chat(payload));
}
