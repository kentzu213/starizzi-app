/**
 * Agent turn streaming events — the live "process" channel shared between the
 * Electron MAIN process (emitter) and the renderer (consumer).
 *
 * A single chat turn (identified by `turnId` = the assistant message id) emits a
 * sequence of these events over the `agentStream:event` IPC channel WHILE the
 * final reply is still being produced. The final reply is ALSO returned by the
 * chat IPC call (back-compat), so a turn still works even if no events are
 * consumed (e.g. an older renderer, or a non-streaming provider).
 *
 * Pure type + parser module: no Electron, no side effects — unit-testable and
 * importable from both processes.
 *
 * @module shared/agent-turn-events
 */

export type AgentStepStatus = 'running' | 'done' | 'error';

/** A discrete step in an agent's work: a tool/extension call, or a progress note. */
export interface AgentStep {
  id: string;
  /** 'tool' = an extension/tool invocation; 'progress' = a generic progress marker. */
  kind: 'tool' | 'progress';
  label: string;
  detail?: string;
  status: AgentStepStatus;
}

/** One streamed event within a turn. `turnId` correlates to the assistant message id. */
export type AgentTurnEvent =
  | { turnId: string; kind: 'delta'; text: string }
  | { turnId: string; kind: 'reasoning'; text: string }
  | { turnId: string; kind: 'step'; step: AgentStep }
  | { turnId: string; kind: 'done'; error?: string };

/**
 * Forwards each turn event to `forward` (e.g. the IPC sender) while accumulating
 * the running content / reasoning / steps — so the caller can persist a complete
 * work-session after the turn ends. Steps are de-duplicated + updated by id.
 */
export interface StreamCollector {
  onEvent: (evt: AgentTurnEvent) => void;
  content: () => string;
  reasoning: () => string;
  steps: () => AgentStep[];
}

export function createStreamCollector(forward: (evt: AgentTurnEvent) => void): StreamCollector {
  let content = '';
  let reasoning = '';
  const steps: AgentStep[] = [];
  const byId = new Map<string, AgentStep>();
  return {
    onEvent(evt) {
      forward(evt);
      if (evt.kind === 'delta') content += evt.text;
      else if (evt.kind === 'reasoning') reasoning += evt.text;
      else if (evt.kind === 'step') {
        const existing = byId.get(evt.step.id);
        if (existing) Object.assign(existing, evt.step);
        else {
          const copy = { ...evt.step };
          byId.set(evt.step.id, copy);
          steps.push(copy);
        }
      }
    },
    content: () => content,
    reasoning: () => reasoning,
    steps: () => steps,
  };
}

/** Parsed content/reasoning delta from one OpenAI SSE event. */
export interface StreamDelta {
  content?: string;
  reasoning?: string;
  /** True for the terminal `data: [DONE]` sentinel. */
  done?: boolean;
}

/**
 * Split accumulated SSE text into complete event blocks (separated by a blank
 * line) plus a trailing remainder that hasn't terminated yet. Pure.
 */
export function extractSseEvents(buffer: string): { events: string[]; rest: string } {
  const events: string[] = [];
  let rest = buffer;
  let idx = rest.indexOf('\n\n');
  while (idx !== -1) {
    const block = rest.slice(0, idx);
    if (block.trim().length > 0) events.push(block);
    rest = rest.slice(idx + 2);
    idx = rest.indexOf('\n\n');
  }
  return { events, rest };
}

/**
 * Parse one SSE event block's `data:` line(s) into a content/reasoning delta.
 * Handles the OpenAI streaming shape (`choices[0].delta.content`) and the two
 * common reasoning field names (`reasoning_content`, `reasoning`). Returns null
 * when the block carries no usable text (e.g. a role-only opener). Never throws.
 */
export function parseOpenAiSseEvent(eventBlock: string): StreamDelta | null {
  const dataLines = eventBlock
    .split(/\r?\n/)
    .filter((l) => l.startsWith('data:'))
    .map((l) => l.slice(5).trim());
  if (dataLines.length === 0) return null;
  const payload = dataLines.join('');
  if (payload === '[DONE]') return { done: true };
  try {
    const obj = JSON.parse(payload) as {
      choices?: Array<{
        delta?: { content?: unknown; reasoning?: unknown; reasoning_content?: unknown };
      }>;
    };
    const delta = obj?.choices?.[0]?.delta ?? {};
    const content = typeof delta.content === 'string' ? delta.content : undefined;
    const reasoning =
      typeof delta.reasoning_content === 'string'
        ? delta.reasoning_content
        : typeof delta.reasoning === 'string'
          ? (delta.reasoning as string)
          : undefined;
    if (content === undefined && reasoning === undefined) return null;
    return { content, reasoning };
  } catch {
    return null;
  }
}
