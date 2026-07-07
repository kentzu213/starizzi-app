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
import {
  buildExtensionTools,
  executeExtensionTool,
  type ExtensionToolHost,
} from './extension-tools';
import { createStreamCollector, type AgentTurnEvent } from '../../shared/agent-turn-events';
import type { SessionRecorder } from './agent-session-recorder';

const IZZI_LLM_BASE = process.env.OPENAI_BASE_URL || 'https://api.izziapi.com/v1';
const MAX_TOOL_ITERATIONS = 5;

export interface IzziAgentMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface IzziAgentChatPayload {
  systemPrompt: string;
  message: string;
  history?: IzziAgentMessage[];
  model?: string;
  /** Opt-in: expose installed+running extension commands as tools the agent may call. */
  enableTools?: boolean;
  /** Correlates streamed process events to the renderer's assistant message. */
  turnId?: string;
  /** Identifies the agent for my-graph work-session capture. */
  agentId?: string;
  agentName?: string;
}

export interface IzziAgentChatResult {
  reply: string;
  error?: string;
}

const ROLES = new Set(['system', 'user', 'assistant']);

export class IzziAgent {
  constructor(
    private readonly auth: AuthManager,
    /** Optional bridge to installed extensions; enables agent tool-calling when present. */
    private readonly toolHost?: ExtensionToolHost,
  ) {}

  /** Resolve the Izzi key: env first, else the signed-in user's API key. Never logged. */
  private resolveKey(): string | null {
    const envKey = process.env.OPENAI_API_KEY;
    if (typeof envKey === 'string' && envKey.trim().length > 0) return envKey.trim();
    const userKey = typeof this.auth.getApiKey === 'function' ? this.auth.getApiKey() : null;
    return typeof userKey === 'string' && userKey.trim().length > 0 ? userKey.trim() : null;
  }

  async chat(
    payload: IzziAgentChatPayload,
    onEvent?: (evt: AgentTurnEvent) => void,
  ): Promise<IzziAgentChatResult> {
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    if (message.length === 0) return { reply: '', error: 'empty' };
    const turnId = typeof payload.turnId === 'string' ? payload.turnId : '';
    const emit = onEvent && turnId ? onEvent : undefined;

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

    // Loose message type so tool/assistant-with-tool_calls turns are allowed.
    const reqMessages: Array<Record<string, unknown>> = [
      ...(system ? [{ role: 'system', content: system }] : []),
      ...history,
      { role: 'user', content: message },
    ];

    // Opt-in tool exposure: only when requested AND a bridge is present.
    const toolIndex = payload.enableTools && this.toolHost ? buildExtensionTools(this.toolHost) : null;
    const tools = toolIndex && toolIndex.tools.length > 0 ? toolIndex.tools : null;

    try {
      for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
        const body: Record<string, unknown> = { model, messages: reqMessages, stream: false, max_tokens: 1200 };
        if (tools) {
          body.tools = tools;
          body.tool_choice = 'auto';
        }
        const res = await fetch(`${IZZI_LLM_BASE}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
          body: JSON.stringify(body),
        });
        if (!res.ok) return { reply: '', error: `http ${res.status}` };
        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: unknown; tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }> } }>;
        };
        const msg = data?.choices?.[0]?.message;
        const toolCalls = msg?.tool_calls;

        // No tools available or model returned a final answer → done.
        if (!tools || !toolIndex || !Array.isArray(toolCalls) || toolCalls.length === 0) {
          const content = msg?.content;
          return typeof content === 'string' && content.length > 0
            ? { reply: content }
            : { reply: '', error: 'empty-response' };
        }

        // Execute each requested tool and feed results back.
        reqMessages.push({ role: 'assistant', content: (msg?.content as string) || '', tool_calls: toolCalls });
        for (const tc of toolCalls) {
          const toolName = tc.function?.name || '';
          const label = toolName.replace(/__/g, '.'); // human-readable command id
          const stepId = tc.id || `${toolName}-${Math.random().toString(36).slice(2, 8)}`;
          // Emit a live "tool running" step (Stage 1/3: show the agent's process).
          emit?.({ turnId, kind: 'step', step: { id: stepId, kind: 'tool', label, status: 'running' } });
          let args: unknown = {};
          try { args = JSON.parse(tc.function?.arguments || '{}'); } catch { args = {}; }
          let resultStr: string;
          let ok = true;
          try {
            const result = await executeExtensionTool(this.toolHost!, toolIndex, toolName, args);
            resultStr = JSON.stringify(result ?? null);
          } catch (err) {
            ok = false;
            resultStr = JSON.stringify({ error: (err as Error).message });
          }
          emit?.({
            turnId,
            kind: 'step',
            step: { id: stepId, kind: 'tool', label, status: ok ? 'done' : 'error', detail: ok ? undefined : 'lỗi' },
          });
          reqMessages.push({ role: 'tool', tool_call_id: tc.id, content: resultStr.slice(0, 6000) });
        }
        // loop for the model's next turn
      }
      return { reply: '', error: 'tool-loop-exhausted' };
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
export function registerIzziAgentIpc(agent: IzziAgent, recorder?: SessionRecorder): void {
  ipcMain.handle('izziAgent:chat', async (event, payload: IzziAgentChatPayload) => {
    const turnId = typeof payload?.turnId === 'string' ? payload.turnId : '';
    const startedAt = new Date().toISOString();
    // Forward live process events to the renderer; collect steps for the record.
    const collector = createStreamCollector((evt) => event.sender.send('agentStream:event', evt));
    const result = await agent.chat(payload, turnId ? collector.onEvent : undefined);

    // Record the finished turn into the unified surfaces (my-graph + Replay tasks).
    if (recorder && payload?.agentId && typeof result.reply === 'string' && result.reply.length > 0) {
      recorder.record({
        agentId: payload.agentId,
        agentName: payload.agentName || payload.agentId,
        model: payload.model,
        request: payload.message,
        reply: result.reply,
        steps: collector.steps(),
        startedAt,
        finishedAt: new Date().toISOString(),
        turnId,
      });
    }
    return result;
  });
}
