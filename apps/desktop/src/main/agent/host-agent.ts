/**
 * Host agent loop — turns the local OpenAI-compatible router (codex-lb / gpt-5.5)
 * into a real agent that can act on the user's machine. It runs a tool-calling
 * loop: ask the model, execute any requested host tools (gated by the permission
 * mode + an approval callback), feed results back, repeat until the model returns
 * a final answer.
 *
 * Security (security-baseline B/C): only reachable in an agent permission mode;
 * risky tools go through `requestApproval` before executing; errors and results
 * are redacted before being fed back or surfaced.
 *
 * @module main/agent/host-agent
 */
import { buildAuthHeaders, resolveChatCompletionsUrl } from './custom-openai-provider';
import type { CustomProviderConfig } from './provider-settings-store';
import { HOST_TOOLS, classifyToolRisk, executeHostTool, summarizeToolCall, type ToolRisk } from './agent-tools';
import { needsApproval, type PermissionMode } from './agent-permissions';
import { extractSseEvents, type AgentTurnEvent } from '../../shared/agent-turn-events';

const MAX_TOOL_ITERATIONS = 12;
const TOOL_RESULT_CAP = 12000;

const SYSTEM_PROMPT =
  "You are an autonomous coding & ops agent running ON the user's computer through the Izzi desktop app. Work like a capable senior engineer paired with the user.\n\n" +
  'How you work:\n' +
  '- For a non-trivial task, start with a brief plan (1-3 short steps).\n' +
  '- Then DO the work with your tools (run shell commands, read/write/list files) — do NOT just tell the user to run things themselves. Inspect first, make the change, then VERIFY it (run the build / tests / the command and check the result).\n' +
  '- Narrate concisely: one short line before an action saying what you are doing and why. Do not over-explain or dump long output.\n' +
  '- Make the smallest change that solves the task; do not touch unrelated things.\n' +
  '- Keep going until the task is actually done. Then give a short summary of what you changed and what you verified, and be honest about anything you could NOT verify.\n' +
  "- Reply in the user's language.";

export interface HostApprovalRequest {
  tool: string;
  risk: ToolRisk;
  summary: string;
  args: Record<string, unknown>;
}

/** The user's decision on a risky action: deny, allow just this one, or allow all for this turn. */
export type ApprovalDecision = 'deny' | 'once' | 'all';
export type RequestApproval = (req: HostApprovalRequest) => Promise<ApprovalDecision>;

export interface HostAgentTurnOptions {
  config: CustomProviderConfig;
  apiKey: string;
  message: string;
  history: { role: 'system' | 'user' | 'assistant'; content: string }[];
  images: string[];
  /** Only the agent modes reach here ('agent' | 'agent-full'). */
  mode: PermissionMode;
  /** Working directory: default cwd for commands + base for relative file paths. '' = home. */
  workingDir?: string;
  turnId: string;
  requestApproval: RequestApproval;
  emit?: (evt: AgentTurnEvent) => void;
  redact?: (t: string) => string;
}

function buildUserContent(message: string, images: string[]): unknown {
  if (images.length === 0) return message;
  return [
    ...(message ? [{ type: 'text', text: message }] : []),
    ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
  ];
}

interface StreamedToolCall {
  id: string;
  name: string;
  args: string;
}

/**
 * POST a streaming chat completion and consume the SSE: emit each content token
 * live via `onDelta` while accumulating the final content + any tool_calls
 * (whose `arguments` arrive in fragments). Standard OpenAI streaming shape.
 * Throws on a non-OK HTTP response so the caller surfaces the error.
 */
async function streamChatTurn(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  onDelta: (text: string) => void,
): Promise<{ content: string; toolCalls: StreamedToolCall[] }> {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`http ${res.status}${errBody ? ': ' + errBody.slice(0, 200) : ''}`);
  }
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  const acc = new Map<number, StreamedToolCall>();

  for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });
    const { events, rest } = extractSseEvents(buffer);
    buffer = rest;
    for (const ev of events) {
      const payload = ev
        .split(/\r?\n/)
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .join('');
      if (!payload || payload === '[DONE]') continue;
      let obj: {
        choices?: Array<{
          delta?: {
            content?: unknown;
            tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
          };
        }>;
      };
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }
      const delta = obj?.choices?.[0]?.delta;
      if (!delta) continue;
      if (typeof delta.content === 'string' && delta.content) {
        content += delta.content;
        onDelta(delta.content);
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const t of delta.tool_calls) {
          const idx = typeof t?.index === 'number' ? t.index : 0;
          const cur = acc.get(idx) ?? { id: '', name: '', args: '' };
          if (typeof t?.id === 'string' && t.id) cur.id = t.id;
          if (typeof t?.function?.name === 'string' && t.function.name) cur.name = t.function.name;
          if (typeof t?.function?.arguments === 'string') cur.args += t.function.arguments;
          acc.set(idx, cur);
        }
      }
    }
  }
  const toolCalls = [...acc.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  return { content, toolCalls };
}

/** Run one agent turn (may span several model round-trips + tool executions). */
export async function runHostAgentTurn(opts: HostAgentTurnOptions): Promise<{ reply: string; error?: string }> {
  const { config, apiKey, message, history, images, mode, turnId, requestApproval, emit } = opts;
  const scrub = opts.redact ?? ((t: string) => t);
  const workingDir = opts.workingDir && opts.workingDir.trim() ? opts.workingDir.trim() : '';
  const url = resolveChatCompletionsUrl(config.baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(config.authType, apiKey),
  };
  const model = config.selectedModel;

  const systemContent = workingDir
    ? `${SYSTEM_PROMPT}\n\nYour working directory is: ${workingDir}. Use it as the default location for commands and as the base for relative file paths.`
    : SYSTEM_PROMPT;

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: buildUserContent(message, images) },
  ];

  // Once the user picks "allow all for this turn", stop prompting for the rest of it.
  let allowAllThisTurn = false;

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const { content, toolCalls } = await streamChatTurn(
        url,
        headers,
        { model, messages, tools: HOST_TOOLS, tool_choice: 'auto', stream: true },
        (text) => emit?.({ turnId, kind: 'delta', text }),
      );

      // No tool calls → the model gave its final answer (already streamed live).
      if (toolCalls.length === 0) {
        return content.length > 0 ? { reply: content } : { reply: '', error: 'empty-response' };
      }

      // Visually separate this step's narration from what comes next.
      if (content) emit?.({ turnId, kind: 'delta', text: '\n\n' });

      // Record the assistant turn that requested the tools.
      messages.push({
        role: 'assistant',
        content: content || '',
        tool_calls: toolCalls.map((t) => ({
          id: t.id,
          type: 'function',
          function: { name: t.name, arguments: t.args },
        })),
      });

      for (const tc of toolCalls) {
        const name = tc.name || '';
        const stepId = tc.id || `${name}-${Math.random().toString(36).slice(2, 8)}`;
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.args || '{}');
          if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
        } catch {
          args = {};
        }
        const risk = classifyToolRisk(name);
        const label = summarizeToolCall(name, args);
        emit?.({ turnId, kind: 'step', step: { id: stepId, kind: 'tool', label, status: 'running' } });

        // Gate risky actions behind the user's approval (unless approved for the turn).
        if (needsApproval(mode, risk) && !allowAllThisTurn) {
          const decision = await requestApproval({ tool: name, risk, summary: label, args });
          if (decision === 'all') {
            allowAllThisTurn = true;
          } else if (decision === 'deny') {
            emit?.({ turnId, kind: 'step', step: { id: stepId, kind: 'tool', label, status: 'error', detail: 'bị từ chối' } });
            messages.push({ role: 'tool', tool_call_id: tc.id, content: 'error: user denied this action' });
            continue;
          }
          // 'once' → proceed with just this action.
        }

        const result = await executeHostTool(name, args, { workingDir });
        const isErr = result.startsWith('error:');
        emit?.({
          turnId,
          kind: 'step',
          step: { id: stepId, kind: 'tool', label, status: isErr ? 'error' : 'done', detail: isErr ? result.slice(0, 100) : undefined },
        });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: scrub(result).slice(0, TOOL_RESULT_CAP) });
      }
    }
    return { reply: '', error: 'tool-loop-exhausted' };
  } catch (err) {
    return { reply: '', error: scrub((err as Error).message || 'network') };
  }
}
