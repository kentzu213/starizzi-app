/**
 * Pure helpers for the AI-company "Run" store (agent-company spec, Phase 1).
 *
 * DB-independent: id generation + input sanitation (whitelist kinds/status, trim +
 * clamp fields, guarantee provenance shape). Kept pure + property-tested so the
 * storage backbone stays clean — untrusted content is data, never a selector.
 *
 * @module main/agent/run-helpers
 */
import { randomUUID } from 'crypto';
import type { AgentRunEntry, AgentRunEntryKind, AgentRunStatus } from './types';

export const RUN_ENTRY_KINDS: readonly AgentRunEntryKind[] = ['artifact', 'note', 'handoff', 'event'];
export const RUN_STATUSES: readonly AgentRunStatus[] = ['active', 'done', 'blocked', 'archived'];

const MAX_CONTENT = 8000;
const MAX_GOAL = 500;
const MAX_FIELD = 120;

export function isRunEntryKind(v: unknown): v is AgentRunEntryKind {
  return typeof v === 'string' && (RUN_ENTRY_KINDS as readonly string[]).includes(v);
}

export function isRunStatus(v: unknown): v is AgentRunStatus {
  return typeof v === 'string' && (RUN_STATUSES as readonly string[]).includes(v);
}

/** Trim + clamp an arbitrary value to a bounded string. */
function clamp(v: unknown, max: number): string {
  return (typeof v === 'string' ? v : '').trim().slice(0, max);
}

export function sanitizeGoal(goal: unknown): string {
  return clamp(goal, MAX_GOAL);
}

export function newRunId(): string {
  return `run-${randomUUID()}`;
}

export function newEntryId(): string {
  return `rune-${randomUUID()}`;
}

export interface RunEntryInput {
  runId: string;
  kind?: unknown;
  stage?: unknown;
  agentId?: unknown;
  content: unknown;
}

/**
 * Normalize an entry input into a clean, provenance-carrying entry (minus id/createdAt,
 * which the store assigns). Returns null when there is no usable runId or content, so
 * the store never persists an orphan/empty entry.
 */
export function sanitizeRunEntry(input: RunEntryInput): Omit<AgentRunEntry, 'id' | 'createdAt'> | null {
  const runId = clamp(input?.runId, MAX_FIELD);
  const content = clamp(input?.content, MAX_CONTENT);
  if (!runId || !content) return null;
  return {
    runId,
    kind: isRunEntryKind(input.kind) ? input.kind : 'note',
    stage: clamp(input.stage, MAX_FIELD) || undefined,
    agentId: clamp(input.agentId, MAX_FIELD) || undefined,
    content,
  };
}
