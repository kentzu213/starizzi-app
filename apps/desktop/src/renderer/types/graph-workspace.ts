/**
 * AI Branching Graph Workspace — data model + PURE helpers.
 *
 * A graph of idea/session nodes. Each node holds a title/summary/body, a chat
 * transcript, and provenance. The AI agent can spawn child nodes (branches) when
 * a new subtopic/question/task/insight/artifact emerges, forming a knowledge tree.
 *
 * This module is PURE (no React, no side effects) so the branching logic is
 * unit-testable. UI (GraphWorkspace) and the LLM provider live elsewhere.
 *
 * @module types/graph-workspace
 */

/** Visual + semantic classification of a node. */
export type WorkspaceNodeType =
  | 'root'
  | 'session'
  | 'question'
  | 'insight'
  | 'task'
  | 'artifact';

/** Provenance: where a node/branch came from (Req: always store provenance). */
export interface NodeProvenance {
  parentId: string | null;
  sourceMessageId: string | null;
  agent: string | null;
  createdAt: string;
}

export interface WorkspaceNode {
  id: string;
  type: WorkspaceNodeType;
  title: string;
  summary: string;
  body: string;
  tags: string[];
  parentId: string | null;
  x: number;
  y: number;
  provenance: NodeProvenance;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceEdge {
  id: string;
  sourceId: string;
  targetId: string;
  type: 'branch' | 'merge';
}

export interface WorkspaceMessage {
  id: string;
  nodeId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

/** Structured output of the branch-intent classifier (internal, JSON). */
export interface BranchClassification {
  shouldCreateBranch: boolean;
  parentNodeId: string;
  title: string;
  summary: string;
  nodeType: Exclude<WorkspaceNodeType, 'root'>;
  reason: string;
  tags: string[];
  confidence: number;
}

/** Confidence at/above which a branch is auto-created; below = suggest only. */
export const BRANCH_AUTOCREATE_THRESHOLD = 0.65;

/** Per-type visual metadata. Colors live in CSS (.gw-node--<type>); no hex here. */
export const nodeTypeMeta: Record<
  WorkspaceNodeType,
  { label: string; icon: string }
> = {
  root: { label: 'Gốc', icon: '🌱' },
  session: { label: 'Phiên', icon: '💬' },
  question: { label: 'Câu hỏi', icon: '❓' },
  insight: { label: 'Insight', icon: '💡' },
  task: { label: 'Task', icon: '✅' },
  artifact: { label: 'Artifact', icon: '📦' },
};

/** Generate a stable-ish local id (crypto.randomUUID when available). */
export function createNodeId(prefix = 'node'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Input describing the branch to create (from a command or the classifier). */
export interface BranchIntent {
  title: string;
  summary?: string;
  body?: string;
  nodeType?: Exclude<WorkspaceNodeType, 'root'>;
  tags?: string[];
  sourceMessageId?: string | null;
  agent?: string | null;
}

/**
 * Create a child node branching from `parent`. PURE: deterministic position
 * (offset right of parent, spread vertically by existing sibling count) and full
 * provenance. Title is required and trimmed; falls back to a generic label.
 */
export function createBranchNode(
  parent: WorkspaceNode,
  intent: BranchIntent,
  siblingCount: number,
  now: string = new Date().toISOString(),
): WorkspaceNode {
  const title = (intent.title || '').trim() || 'Nhánh mới';
  const id = createNodeId('node');
  const laneHeight = 96;
  const spread = (siblingCount - 0) * laneHeight - (siblingCount > 0 ? laneHeight : 0) / 2;
  return {
    id,
    type: intent.nodeType ?? 'question',
    title,
    summary: (intent.summary ?? '').trim(),
    body: (intent.body ?? '').trim(),
    tags: dedupeTags(intent.tags ?? []),
    parentId: parent.id,
    x: parent.x + 280,
    y: parent.y + spread,
    provenance: {
      parentId: parent.id,
      sourceMessageId: intent.sourceMessageId ?? null,
      agent: intent.agent ?? null,
      createdAt: now,
    },
    createdAt: now,
    updatedAt: now,
  };
}

/** Build the edge connecting a parent to its freshly-created branch child. */
export function createBranchEdge(parentId: string, childId: string): WorkspaceEdge {
  return {
    id: `edge-${parentId}-${childId}`,
    sourceId: parentId,
    targetId: childId,
    type: 'branch',
  };
}

/** Lowercase, de-duplicate, drop empties. Pure. */
export function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const t = String(raw).trim().toLowerCase();
    if (t && !seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

export type ParsedCommand =
  | { command: 'branch'; arg: string }
  | { command: 'summarize'; arg: string }
  | { command: 'merge'; arg: string }
  | { command: null; arg: string };

/**
 * Parse a chat input for a leading slash-command (/branch, /summarize, /merge).
 * PURE. Non-command input returns `{ command: null, arg: <original trimmed> }`.
 */
export function parseCommand(input: string): ParsedCommand {
  const text = (input ?? '').trim();
  const match = text.match(/^\/(branch|summarize|merge)\b\s*([\s\S]*)$/i);
  if (!match) return { command: null, arg: text };
  const command = match[1].toLowerCase() as 'branch' | 'summarize' | 'merge';
  return { command, arg: match[2].trim() };
}
