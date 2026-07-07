/**
 * SessionRecorder — the single sink for a completed agent turn, so every agent
 * (Hermes + izzi personas) records the SAME way into the SAME unified surfaces:
 *
 *  1. my-graph (personal knowledge graph) via AgentSessionCapturer — the
 *     "agent-side write loop" (second-brain).
 *  2. Replay tasks (the daily work board) via an `agent_tasks` row — so finished
 *     agent work shows up next to the legacy agent's tasks.
 *
 * Both writes are best-effort and fail-closed: a graph/DB failure NEVER breaks
 * the chat turn. No secrets are recorded (only request/reply/step labels).
 *
 * @module main/agents/agent-session-recorder
 */
import type { AgentTask } from '../agent/types';
import type { AgentSessionInput, AgentSessionCapturer } from './agent-session-graph';

/** Minimal DB surface for the Replay-task write (matches DatabaseManager). */
export interface AgentTaskWriter {
  upsertAgentTask(task: AgentTask): AgentTask;
}

const MAX_TASK_TITLE = 80;
const MAX_TASK_SUMMARY = 240;

function clip(s: string, n: number): string {
  const t = (s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/**
 * Build the Replay-task row for a finished agent turn. Pure — unit-testable.
 * `sessionId` is intentionally left undefined: the `agent_tasks.session_id` FK
 * references `chat_sessions(id)`, and a gateway agent id is not a chat session,
 * so binding it would violate the foreign key.
 */
export function buildSessionTask(input: AgentSessionInput): AgentTask {
  const firstLine = (input.request || '').split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const idBase = input.turnId || `${input.agentId}-${input.finishedAt}`;
  return {
    id: `agent-session--${idBase}`,
    title: clip(`${input.agentName}: ${firstLine || 'phiên làm việc'}`, MAX_TASK_TITLE),
    status: 'done',
    summary: clip(input.reply, MAX_TASK_SUMMARY),
    sourceMessageId: input.turnId,
    createdAt: input.startedAt,
    updatedAt: input.finishedAt,
  };
}

/**
 * Records a completed agent turn into every unified surface. Construct once in
 * the main process with the graph capturer + the task DB; the agent IPC handlers
 * call `record(input)` after a turn resolves.
 */
export class SessionRecorder {
  constructor(
    private readonly capturer: AgentSessionCapturer,
    private readonly tasks: AgentTaskWriter,
  ) {}

  /** Fire-and-forget: persist to my-graph + Replay tasks. Never throws. */
  record(input: AgentSessionInput): void {
    // my-graph (async, fail-closed inside the capturer)
    void this.capturer.capture(input).catch(() => undefined);
    // Replay tasks (sync sqlite; guard so a DB error can't break the turn)
    try {
      this.tasks.upsertAgentTask(buildSessionTask(input));
    } catch {
      // best-effort — the graph capture + chat reply are unaffected
    }
  }
}
