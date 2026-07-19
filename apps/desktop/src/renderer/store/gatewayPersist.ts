/**
 * Pure helpers for persisting/restoring the multi-agent gateway chat history.
 *
 * Chat sessions are stored in the main SQLite `user_data` table (type
 * 'gateway_session') and reloaded on launch — so tabs survive an app restart.
 * These functions sanitize the (untrusted) stored JSON back into valid sessions
 * and cap what we keep, with NO side effects (unit-testable).
 *
 * @module renderer/store/gatewayPersist
 */
import type { AgentChatSession, AgentStep, AIProvider, GatewayChatMessage } from '../types/agent-registry';

const MAX_SESSIONS = 40;
const MAX_MSGS_PER_SESSION = 200;
const VALID_ROLES = new Set(['user', 'assistant', 'system']);
const VALID_STATES = new Set(['pending', 'streaming', 'done', 'error']);

function sanitizeSteps(raw: unknown): AgentStep[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const steps: AgentStep[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const s = r as Record<string, unknown>;
    if (typeof s.id !== 'string' || typeof s.label !== 'string') continue;
    const status = s.status === 'running' || s.status === 'error' ? s.status : 'done';
    steps.push({
      id: s.id,
      kind: s.kind === 'progress' ? 'progress' : 'tool',
      label: s.label,
      detail: typeof s.detail === 'string' ? s.detail : undefined,
      status,
    });
  }
  return steps.length > 0 ? steps : undefined;
}

function sanitizeMessage(raw: unknown): GatewayChatMessage | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.id !== 'string' || typeof m.sessionId !== 'string') return null;
  if (typeof m.role !== 'string' || !VALID_ROLES.has(m.role)) return null;

  // A turn interrupted by an app close would be left 'streaming'/'pending';
  // normalize to 'done' so restored history isn't stuck in a spinner.
  let state = typeof m.state === 'string' && VALID_STATES.has(m.state) ? (m.state as GatewayChatMessage['state']) : 'done';
  if (state === 'streaming' || state === 'pending') state = 'done';

  const msg: GatewayChatMessage = {
    id: m.id,
    sessionId: m.sessionId,
    agentId: typeof m.agentId === 'string' ? m.agentId : '',
    role: m.role as GatewayChatMessage['role'],
    content: typeof m.content === 'string' ? m.content : '',
    state,
    createdAt: typeof m.createdAt === 'string' ? m.createdAt : new Date().toISOString(),
  };
  if (typeof m.model === 'string') msg.model = m.model;
  if (typeof m.reasoning === 'string') msg.reasoning = m.reasoning;
  const steps = sanitizeSteps(m.steps);
  if (steps) msg.steps = steps;
  return msg;
}

function sanitizeSession(raw: unknown): AgentChatSession | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (typeof s.id !== 'string' || typeof s.agentId !== 'string') return null;
  const messages = Array.isArray(s.messages)
    ? s.messages
        .map(sanitizeMessage)
        .filter((m): m is GatewayChatMessage => m !== null)
        .slice(-MAX_MSGS_PER_SESSION)
    : [];
  return {
    id: s.id,
    agentId: s.agentId,
    agentName: typeof s.agentName === 'string' ? s.agentName : s.agentId,
    agentIcon: typeof s.agentIcon === 'string' ? s.agentIcon : '🤖',
    messages,
    model:
      typeof s.model === 'string'
        ? (s.model === 'izzi/auto' || s.model === 'izzi-auto' || s.model === 'auto' ? 'izzi-smart' : s.model)
        : 'izzi-smart',
    provider: (typeof s.provider === 'string' ? s.provider : 'izzi') as AIProvider,
    reasoningEffort: typeof s.reasoningEffort === 'string' ? s.reasoningEffort : undefined,
    createdAt: typeof s.createdAt === 'string' ? s.createdAt : new Date().toISOString(),
    isActive: s.isActive !== false,
  };
}

/** Restore stored gateway sessions (untrusted JSON) into valid, ordered sessions. */
export function sanitizeStoredSessions(raw: unknown): AgentChatSession[] {
  if (!Array.isArray(raw)) return [];
  const sessions = raw
    .map(sanitizeSession)
    .filter((s): s is AgentChatSession => s !== null)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt)); // tab order = creation order
  return sessions.length > MAX_SESSIONS ? sessions.slice(-MAX_SESSIONS) : sessions;
}

/** Cap what we write back to disk (keep newest sessions + bounded messages). */
export function capForPersist(sessions: AgentChatSession[]): AgentChatSession[] {
  const capped = sessions.length > MAX_SESSIONS ? sessions.slice(-MAX_SESSIONS) : sessions;
  return capped.map((s) => {
    const bounded =
      s.messages.length > MAX_MSGS_PER_SESSION ? s.messages.slice(-MAX_MSGS_PER_SESSION) : s.messages;
    // Drop inline image data URLs before persisting — base64 blobs would bloat the
    // SQLite store; pasted images are a live-view affordance, not durable history.
    const hasImages = bounded.some((m) => m.images && m.images.length > 0);
    const cleaned = hasImages
      ? bounded.map((m) => (m.images && m.images.length > 0 ? { ...m, images: undefined } : m))
      : bounded;
    return cleaned === s.messages ? s : { ...s, messages: cleaned };
  });
}

/** Choose which restored tab should be active: last active, else the newest. */
export function pickActiveId(sessions: AgentChatSession[]): string | null {
  if (sessions.length === 0) return null;
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (sessions[i].isActive) return sessions[i].id;
  }
  return sessions[sessions.length - 1].id;
}
