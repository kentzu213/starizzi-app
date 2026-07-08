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
import type { AgentTurnEvent } from '../../shared/agent-turn-events';

const MAX_TOOL_ITERATIONS = 12;
const TOOL_RESULT_CAP = 12000;

const SYSTEM_PROMPT =
  "You are an autonomous coding & ops agent running ON the user's computer through the Izzi desktop app. " +
  'You have tools to run shell commands and read/write/list files on their machine. ' +
  'Prefer DOING the task with your tools over telling the user to run commands themselves. ' +
  'Work step by step: inspect first (read_file / list_dir / run_command), make the change (write_file / run_command), then verify it. ' +
  'When you run a command, say briefly why. Keep going until the task is complete, then give a short summary of what you did. ' +
  'Reply in the user\'s language.';

export interface HostApprovalRequest {
  tool: string;
  risk: ToolRisk;
  summary: string;
  args: Record<string, unknown>;
}

export type RequestApproval = (req: HostApprovalRequest) => Promise<boolean>;

export interface HostAgentTurnOptions {
  config: CustomProviderConfig;
  apiKey: string;
  message: string;
  history: { role: 'system' | 'user' | 'assistant'; content: string }[];
  images: string[];
  /** Only the agent modes reach here ('agent' | 'agent-full'). */
  mode: PermissionMode;
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

/** Run one agent turn (may span several model round-trips + tool executions). */
export async function runHostAgentTurn(opts: HostAgentTurnOptions): Promise<{ reply: string; error?: string }> {
  const { config, apiKey, message, history, images, mode, turnId, requestApproval, emit } = opts;
  const scrub = opts.redact ?? ((t: string) => t);
  const url = resolveChatCompletionsUrl(config.baseUrl);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...buildAuthHeaders(config.authType, apiKey),
  };
  const model = config.selectedModel;

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history,
    { role: 'user', content: buildUserContent(message, images) },
  ];

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, messages, tools: HOST_TOOLS, tool_choice: 'auto', stream: false }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        return { reply: '', error: scrub(`http ${res.status}${body ? ': ' + body.slice(0, 200) : ''}`) };
      }
      const data = (await res.json()) as {
        choices?: Array<{
          message?: {
            content?: unknown;
            tool_calls?: Array<{ id: string; function?: { name?: string; arguments?: string } }>;
          };
        }>;
      };
      const msg = data?.choices?.[0]?.message;
      const toolCalls = Array.isArray(msg?.tool_calls) ? msg!.tool_calls! : [];

      // No tool calls → the model gave its final answer.
      if (toolCalls.length === 0) {
        const content = msg?.content;
        return typeof content === 'string' && content.length > 0
          ? { reply: content }
          : { reply: '', error: 'empty-response' };
      }

      // Record the assistant turn that requested the tools.
      messages.push({ role: 'assistant', content: (msg?.content as string) || '', tool_calls: toolCalls });

      for (const tc of toolCalls) {
        const name = tc.function?.name || '';
        const stepId = tc.id || `${name}-${Math.random().toString(36).slice(2, 8)}`;
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.function?.arguments || '{}');
          if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
        } catch {
          args = {};
        }
        const risk = classifyToolRisk(name);
        const label = summarizeToolCall(name, args);
        emit?.({ turnId, kind: 'step', step: { id: stepId, kind: 'tool', label, status: 'running' } });

        // Gate risky actions behind the user's approval.
        if (needsApproval(mode, risk)) {
          const approved = await requestApproval({ tool: name, risk, summary: label, args });
          if (!approved) {
            emit?.({ turnId, kind: 'step', step: { id: stepId, kind: 'tool', label, status: 'error', detail: 'bị từ chối' } });
            messages.push({ role: 'tool', tool_call_id: tc.id, content: 'error: user denied this action' });
            continue;
          }
        }

        const result = await executeHostTool(name, args);
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
