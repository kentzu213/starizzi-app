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
import { randomUUID } from 'crypto';
import { buildAuthHeaders, resolveChatCompletionsUrl } from './custom-openai-provider';
import { buildIzziRequestHeaders, isOfficialIzziApiUrl, modelSupportsTools } from './izzi-request-headers';
import type { CustomProviderConfig } from './provider-settings-store';
import { HOST_TOOLS, classifyToolRisk, executeHostTool, summarizeToolCall, type OpenAiTool, type ToolRisk } from './agent-tools';
import { needsApproval, type PermissionMode } from './agent-permissions';
import { extractSseEvents, type AgentTurnEvent } from '../../shared/agent-turn-events';

const MAX_TOOL_ITERATIONS = 60;
const TOOL_RESULT_CAP = 12000;

const SYSTEM_PROMPT =
  "You are an autonomous coding & ops agent running ON the user's computer through the Izzi desktop app. Work like a capable senior engineer paired with the user.\n\n" +
  'How you work:\n' +
  '- For a multi-step task, FIRST call the update_plan tool to publish your steps — this shows the user a live task board — then keep it updated: set a step in_progress before you start it, and completed when it is done.\n' +
  '- Then DO the work with your tools (run shell commands, read/write/list files) — do NOT just tell the user to run things themselves. Inspect first, make the change, then VERIFY it (run the build / tests / the command and check the result).\n' +
  '- Narrate concisely: one short line before an action saying what you are doing and why. Do not over-explain or dump long output.\n' +
  '- Make the smallest change that solves the task; do not touch unrelated things.\n' +
  '- If a command or step fails, read the error and fix the root cause. Do NOT blindly retry the same action several different ways — that wastes your step budget.\n' +
  '- Reuse what you already learned this turn: do NOT re-read a file or re-list a directory you have already seen — the earlier tool results are still in the conversation.\n' +
  '- Keep going until the task is actually done. Then give a short summary of what you changed and what you verified, and be honest about anything you could NOT verify.\n' +
  "- Reply in the user's language.";

/**
 * A short environment note appended to the system prompt so the model emits
 * shell-correct commands from the first try (the #1 cause of wasted steps is the
 * model guessing the wrong shell — e.g. PowerShell cmdlets on cmd.exe).
 */
function buildEnvNote(): string {
  const isWin = process.platform === 'win32';
  const shell = isWin
    ? 'cmd.exe on Windows. Use cmd-compatible syntax; to use PowerShell cmdlets, invoke `powershell -NoProfile -Command "..."`.'
    : '/bin/sh.';
  return (
    `\n\nEnvironment: host OS is ${process.platform}. run_command runs through the default shell (${shell})` +
    ' To create or overwrite files, prefer the write_file tool instead of shell here-docs or New-Item.'
  );
}

/** One step of the agent's live task plan (surfaced on the Tasks board). */
export interface PlanStep {
  step: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked';
}

/** Meta-tool: lets the model publish/update its task plan so the user watches progress. */
const UPDATE_PLAN_TOOL: OpenAiTool = {
  type: 'function',
  function: {
    name: 'update_plan',
    description:
      'Publish or update your task plan for this turn so the user can follow progress on the Tasks board. ' +
      'Call it once early with the full list of short steps (each status "pending"), then call it again to set a step ' +
      '"in_progress" before you start it and "completed" when done (or "blocked" if stuck). Send the FULL list each time.',
    parameters: {
      type: 'object',
      properties: {
        plan: {
          type: 'array',
          description: 'The full ordered list of steps with their current status.',
          items: {
            type: 'object',
            properties: {
              step: { type: 'string', description: 'Short description of the step.' },
              status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'blocked'] },
            },
            required: ['step', 'status'],
          },
        },
      },
      required: ['plan'],
    },
  },
};

/** Parse the model's update_plan arguments into clean PlanStep[]. Never throws. */
function parsePlan(args: Record<string, unknown>): PlanStep[] {
  const raw = Array.isArray((args as { plan?: unknown }).plan) ? (args as { plan: unknown[] }).plan : [];
  const allowed = new Set(['pending', 'in_progress', 'completed', 'blocked']);
  const out: PlanStep[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const step = typeof (item as { step?: unknown }).step === 'string' ? (item as { step: string }).step.trim() : '';
    if (!step) continue;
    const s = (item as { status?: unknown }).status;
    const status = typeof s === 'string' && allowed.has(s) ? (s as PlanStep['status']) : 'pending';
    out.push({ step, status });
  }
  return out.slice(0, 20);
}

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
  /** Extra tool schemas advertised alongside the host tools (e.g. Auto-Post). */
  extraTools?: OpenAiTool[];
  /** Execute an extra tool; return undefined to fall back to the host-tool executor. */
  executeExtra?: (name: string, args: Record<string, unknown>) => Promise<string | undefined>;
  /** Risk for an extra tool; return undefined to fall back to the host-tool classifier. */
  classifyExtraRisk?: (name: string) => ToolRisk | undefined;
  /** Called whenever the model publishes/updates its task plan (→ live Tasks board). */
  onPlan?: (steps: PlanStep[]) => void;
  /** Abort signal — when aborted, the turn stops after the current step (Stop button). */
  signal?: AbortSignal;
  /** Drain any user "steering" messages queued mid-turn; injected before the next round. */
  pollInjection?: () => string | undefined;
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
  signal?: AbortSignal,
): Promise<{ content: string; toolCalls: StreamedToolCall[] }> {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
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

/**
 * Non-streaming variant — POST with `stream:false`, parse the single JSON reply
 * into the same `{ content, toolCalls }` shape. Fallback for backends that reject
 * streaming+function-calling for some models (e.g. codex-lb on a ChatGPT/Codex
 * account with gpt-5.6-*, which errors 400 on stream+tools but works non-streamed).
 * The whole answer is surfaced via `onDelta` at once (no live token stream).
 */
async function nonStreamChatTurn(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<{ content: string; toolCalls: StreamedToolCall[] }> {
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`http ${res.status}${errBody ? ': ' + errBody.slice(0, 200) : ''}`);
  }
  const data = (await res.json().catch(() => ({}))) as {
    choices?: Array<{
      message?: {
        content?: unknown;
        tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }>;
      };
    }>;
  };
  const msg = data?.choices?.[0]?.message ?? {};
  const content = typeof msg.content === 'string' ? msg.content : '';
  const toolCalls: StreamedToolCall[] = Array.isArray(msg.tool_calls)
    ? msg.tool_calls.map((t, i) => ({
        id: typeof t?.id === 'string' && t.id ? t.id : `call_${i}`,
        name: t?.function?.name ?? '',
        args: typeof t?.function?.arguments === 'string' ? t.function.arguments : '',
      }))
    : [];
  if (content) onDelta(content);
  return { content, toolCalls };
}

/** True for the "streaming+tools not supported for this model" 400 (Codex/ChatGPT account). */
export function isStreamingUnsupportedError(err: unknown): boolean {
  const m = err instanceof Error ? err.message : String(err);
  return /http 400/.test(m) && (/not supported/i.test(m) || (/stream(?:ing)?/i.test(m) && /temporarily unavailable/i.test(m)));
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
  // The production Izzi route currently cannot serve direct Sol tool calls.
  // Keep tools intact for local/custom Codex-LB endpoints that do support them.
  const supportsTools = !isOfficialIzziApiUrl(url) || modelSupportsTools(model);
  const tools = [...HOST_TOOLS, UPDATE_PLAN_TOOL, ...(opts.extraTools && opts.extraTools.length ? opts.extraTools : [])];

  const systemContent = workingDir
    ? `${SYSTEM_PROMPT}\n\nYour working directory is: ${workingDir}. Use it as the default location for commands and as the base for relative file paths.${buildEnvNote()}`
    : `${SYSTEM_PROMPT}${buildEnvNote()}`;

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: buildUserContent(message, images) },
  ];

  // Once the user picks "allow all for this turn", stop prompting for the rest of it.
  let allowAllThisTurn = false;
  // Some codex-lb / Codex(ChatGPT-account) models reject streaming+tools with a 400
  // (e.g. gpt-5.6-sol). Flip to non-streaming for the rest of the turn once we hit
  // it, so the same request succeeds instead of dead-ending.
  let streamingSupported = true;

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      if (opts.signal?.aborted) return { reply: '', error: 'aborted' };
      // Fold in any "steering" the user typed while the agent was working, before
      // the next model round so it can course-correct mid-task.
      for (let injected = opts.pollInjection?.(); injected; injected = opts.pollInjection?.()) {
        messages.push({ role: 'user', content: injected });
        emit?.({
          turnId,
          kind: 'step',
          step: {
            id: `inject-${Math.random().toString(36).slice(2, 8)}`,
            kind: 'progress',
            label: `Điều chỉnh: ${injected.slice(0, 60)}`,
            status: 'done',
          },
        });
      }

      const onDelta = (text: string) => emit?.({ turnId, kind: 'delta', text });
      const buildBody = (stream: boolean) => ({
        model,
        messages,
        ...(supportsTools ? { tools, tool_choice: 'auto' } : {}),
        stream,
      });
      const roundHeaders = {
        ...headers,
        ...buildIzziRequestHeaders(url, isOfficialIzziApiUrl(url) ? randomUUID() : undefined),
      };
      let content: string;
      let toolCalls: StreamedToolCall[];
      try {
        ({ content, toolCalls } = streamingSupported
          ? await streamChatTurn(url, roundHeaders, buildBody(true), onDelta, opts.signal)
          : await nonStreamChatTurn(url, roundHeaders, buildBody(false), onDelta, opts.signal));
      } catch (err) {
        if (streamingSupported && isStreamingUnsupportedError(err)) {
          streamingSupported = false;
          emit?.({
            turnId,
            kind: 'step',
            step: {
              id: `nostream-${Math.random().toString(36).slice(2, 8)}`,
              kind: 'progress',
              label: `${model}: không hỗ trợ streaming+tools — chuyển chế độ không streaming`,
              status: 'done',
            },
          });
          ({ content, toolCalls } = await nonStreamChatTurn(url, roundHeaders, buildBody(false), onDelta, opts.signal));
        } else {
          throw err;
        }
      }

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
        if (opts.signal?.aborted) return { reply: '', error: 'aborted' };
        const name = tc.name || '';
        const stepId = tc.id || `${name}-${Math.random().toString(36).slice(2, 8)}`;
        let args: Record<string, unknown> = {};
        try {
          const parsed = JSON.parse(tc.args || '{}');
          if (parsed && typeof parsed === 'object') args = parsed as Record<string, unknown>;
        } catch {
          args = {};
        }

        // Planning meta-tool: publish/update the task plan → live Tasks board.
        // It never touches the machine, so it bypasses the approval gate.
        if (name === 'update_plan') {
          const steps = parsePlan(args);
          opts.onPlan?.(steps);
          const done = steps.filter((s) => s.status === 'completed').length;
          emit?.({
            turnId,
            kind: 'step',
            step: { id: stepId, kind: 'progress', label: `Kế hoạch: ${done}/${steps.length} bước`, status: 'done' },
          });
          messages.push({ role: 'tool', tool_call_id: tc.id, content: `ok: plan recorded (${steps.length} steps)` });
          continue;
        }

        const risk = opts.classifyExtraRisk?.(name) ?? classifyToolRisk(name);
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

        let result = opts.executeExtra ? await opts.executeExtra(name, args) : undefined;
        if (result === undefined) result = await executeHostTool(name, args, { workingDir });
        const isErr = result.startsWith('error:');
        emit?.({
          turnId,
          kind: 'step',
          step: { id: stepId, kind: 'tool', label, status: isErr ? 'error' : 'done', detail: isErr ? result.slice(0, 100) : undefined },
        });
        messages.push({ role: 'tool', tool_call_id: tc.id, content: scrub(result).slice(0, TOOL_RESULT_CAP) });
      }
    }
    // Step budget reached: ask for a final wrap-up WITHOUT tools so the user always
    // gets a real answer (progress + what's left) instead of an empty error. The
    // turn is resumable — the next message continues with full history.
    emit?.({ turnId, kind: 'delta', text: '\n\n' });
    try {
      const { content } = await streamChatTurn(
        url,
        headers,
        {
          model,
          messages: [
            ...messages,
            {
              role: 'user',
              content:
                'Bạn đã dùng hết số bước công cụ cho lượt này — DỪNG gọi công cụ. Tổng kết ngắn gọn: đã làm được gì, kiểm chứng được gì, và còn bước nào chưa xong. Nếu chưa hoàn tất, nói rõ để người dùng nhắn "tiếp tục".',
            },
          ],
          stream: true,
        },
        (text) => emit?.({ turnId, kind: 'delta', text }),
        opts.signal,
      );
      if (content.trim().length > 0) return { reply: content };
    } catch {
      /* fall through to a static wrap-up */
    }
    return {
      reply:
        'Mình đã chạy nhiều bước cho tác vụ này nhưng chưa hoàn tất trong một lượt. Nhắn "tiếp tục" để mình làm tiếp từ chỗ đang dở.',
    };
  } catch (err) {
    if (opts.signal?.aborted) return { reply: '', error: 'aborted' };
    return { reply: '', error: scrub((err as Error).message || 'network') };
  }
}
