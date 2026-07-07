/**
 * Agent → my-graph work-session capture (the second-brain "agent-side write loop").
 *
 * After an agent finishes a chat turn, this persists a compact "work session"
 * node into the user's personal graph (`/api/aibase/*` via GraphClient) and links
 * it to a stable per-agent hub node — so sessions are never orphaned and the
 * graph shows which agent did what (and, via tool steps, how agents combine).
 *
 * Security / second-brain (rules B/D):
 *  - Writes go through GraphClient (JWT stays in main, auth fail-closed).
 *  - Best-effort: any auth/network failure is swallowed — capture must NEVER
 *    break the chat turn.
 *  - No secrets / raw credentialed tool payloads are written — only the user's
 *    request, the agent's reply, model/effort, and short step labels.
 *  - No `tags` field exists on the backend node model, so session markers live
 *    in `metadata` (own-property data, not a selector).
 *
 * @module main/agents/agent-session-graph
 */
import type { GraphNode, GraphLink, GraphSearchHit } from '../../shared/graph-types';
import type { AgentStep } from '../../shared/agent-turn-events';

/** Minimal GraphClient surface this module needs (structurally matches GraphClient). */
export interface GraphWriter {
  searchNodes(query: string, limit?: number): Promise<GraphSearchHit[]>;
  createNode(input: { title: string } & Partial<GraphNode>): Promise<GraphNode | { error: string }>;
  createLink(
    sourceId: string,
    targetId: string,
    label?: string,
    color?: string,
  ): Promise<GraphLink | { error: string }>;
}

export interface AgentSessionInput {
  agentId: string;
  agentName: string;
  model?: string;
  reasoningEffort?: string;
  request: string;
  reply: string;
  steps?: AgentStep[];
  startedAt: string;
  finishedAt: string;
}

const MAX_TITLE = 80;
const MAX_CONTENT = 6000;
/** Muted, WCAG-friendly accents (no AI-purple neon per the graph UI rule). */
const HUB_COLOR = '#5B8AA6';
const SESSION_COLOR = '#8FA9B8';

function clip(s: string, n: number): string {
  const t = (s ?? '').trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
}

/** Deterministic hub title per agent (also the search key for find-or-create). */
export function hubTitle(agentName: string): string {
  return `🤖 Agent Work — ${agentName}`;
}

/** Build the work-session node payload. Pure — unit-testable. */
export function buildSessionNode(input: AgentSessionInput): { title: string } & Partial<GraphNode> {
  const firstLine = (input.request || '').split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  const title = clip(`${input.agentName}: ${firstLine || 'phiên làm việc'}`, MAX_TITLE);

  const steps = Array.isArray(input.steps) ? input.steps : [];
  const stepsText =
    steps.length > 0
      ? `\n\n### Các bước\n${steps
          .map((s) => `- ${s.status === 'error' ? '✗' : '•'} ${s.label}${s.detail ? ` — ${s.detail}` : ''}`)
          .join('\n')}`
      : '';

  const meta = [
    `Agent: ${input.agentName} (${input.agentId})`,
    input.model ? `Model: ${input.model}` : '',
    input.reasoningEffort ? `Reasoning: ${input.reasoningEffort}` : '',
    `Thời gian: ${input.startedAt} → ${input.finishedAt}`,
  ]
    .filter(Boolean)
    .join(' · ');

  const content = clip(
    `${meta}\n\n### Yêu cầu\n${input.request}\n\n### Kết quả\n${input.reply}${stepsText}`,
    MAX_CONTENT,
  );

  return {
    title,
    content,
    nodeType: 'note',
    color: SESSION_COLOR,
    metadata: {
      kind: 'agent-session',
      agentId: input.agentId,
      model: input.model ?? null,
      reasoningEffort: input.reasoningEffort ?? null,
      steps: steps.map((s) => ({ label: s.label, status: s.status })),
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
    },
  };
}

function ownId(n: unknown): string | null {
  if (n === null || typeof n !== 'object') return null;
  const id = (n as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

/**
 * Captures agent work sessions into the personal graph. Caches the per-agent hub
 * node id in memory to avoid re-searching every turn. Fail-closed: any auth/
 * network error resolves to `{ ok: false }` and never throws.
 */
export class AgentSessionCapturer {
  private hubIdByAgent = new Map<string, string>();

  constructor(private readonly graph: GraphWriter) {}

  async capture(input: AgentSessionInput): Promise<{ ok: boolean; nodeId?: string; reason?: string }> {
    try {
      const hubId = await this.ensureHub(input.agentId, input.agentName);
      const node = await this.graph.createNode(buildSessionNode(input));
      const nodeId = ownId(node);
      if (!nodeId) {
        const err = (node as { error?: unknown })?.error;
        return { ok: false, reason: typeof err === 'string' ? err : 'no-node' };
      }
      if (hubId) {
        // Link hub → session so the node is never orphaned (best-effort).
        await this.graph.createLink(hubId, nodeId, 'session', SESSION_COLOR).catch(() => undefined);
      }
      return { ok: true, nodeId };
    } catch {
      return { ok: false, reason: 'error' };
    }
  }

  /**
   * Find-or-create the per-agent hub node and cache its id. Returns null when the
   * graph is unavailable (e.g. logged out) so `capture` still leaves a session node.
   */
  private async ensureHub(agentId: string, agentName: string): Promise<string | null> {
    const cached = this.hubIdByAgent.get(agentId);
    if (cached) return cached;

    const title = hubTitle(agentName);
    try {
      const hits = await this.graph.searchNodes(title, 5);
      for (const h of hits) {
        if (h && h.title === title) {
          const id = ownId(h);
          if (id) {
            this.hubIdByAgent.set(agentId, id);
            return id;
          }
        }
      }
    } catch {
      // search failed (offline / logged out) — fall through to create, else give up
    }

    const created = await this.graph.createNode({
      title,
      content: `Tổng hợp các phiên làm việc của agent ${agentName} (Tool Starizzi tự động ghi lại).`,
      nodeType: 'topic',
      color: HUB_COLOR,
      metadata: { kind: 'agent-hub', agentId },
    });
    const id = ownId(created);
    if (id) {
      this.hubIdByAgent.set(agentId, id);
      return id;
    }
    return null;
  }
}
