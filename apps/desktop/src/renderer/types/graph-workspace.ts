/**
 * AI Branching Graph Workspace — PURE adapters over the SHARED graph model.
 *
 * Decision B: the branching workspace IS the second-brain graph. The single
 * source of truth is the shared `/api/aibase/*` backend (`GraphNode`/`GraphLink`
 * from `shared/graph-types`), reached via the `electronAPI.graph` bridge. There
 * is NO separate local node model.
 *
 * Workspace-specific concepts (visual type, summary, tags, branch provenance)
 * are carried in the node's `metadata` JSON — no schema change, no new endpoint.
 * This module maps between the backend `GraphNode` and the workspace view, and
 * builds the create payload for a new branch. All functions are PURE and
 * own-property only (no prototype-chain), so they are unit-testable.
 *
 * @module types/graph-workspace
 */
import type { GraphNode } from '../../shared/graph-types';

/** Visual + semantic classification of a node (stored as `GraphNode.nodeType`). */
export type WorkspaceNodeType =
  | 'root'
  | 'session'
  | 'question'
  | 'insight'
  | 'task'
  | 'artifact';

export const WORKSPACE_NODE_TYPES: readonly WorkspaceNodeType[] = [
  'root',
  'session',
  'question',
  'insight',
  'task',
  'artifact',
];

/** Per-type label + icon for the UI. Colors are in NODE_TYPE_COLORS / CSS. */
export const nodeTypeMeta: Record<WorkspaceNodeType, { label: string; icon: string }> = {
  root: { label: 'Gốc', icon: '🌱' },
  session: { label: 'Phiên', icon: '💬' },
  question: { label: 'Câu hỏi', icon: '❓' },
  insight: { label: 'Insight', icon: '💡' },
  task: { label: 'Task', icon: '✅' },
  artifact: { label: 'Artifact', icon: '📦' },
};

/** Controlled per-type accent palette (sent as GraphNode.color on create). */
export const NODE_TYPE_COLORS: Record<WorkspaceNodeType, string> = {
  root: '#67e8f9',
  session: '#22dcc2',
  question: '#5ca7ff',
  insight: '#ffc45c',
  task: '#45d982',
  artifact: '#a78bfa',
};

/** A node-scoped chat message. Transcripts are local (backend has no message API). */
export interface WorkspaceMessage {
  id: string;
  nodeId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

/** Branch provenance carried in `GraphNode.metadata.provenance`. */
export interface NodeProvenance {
  parentId: string | null;
  sourceMessageId: string | null;
  agent: string | null;
  createdAt: string;
}

/** Structured output of the branch-intent classifier (internal JSON). */
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

/** The shape passed to `electronAPI.graph.create` for a new branch node. */
export interface BranchCreatePayload {
  title: string;
  nodeType: string;
  color: string;
  content?: string;
  x: number;
  y: number;
  metadata: Record<string, unknown>;
}

// ── Own-property metadata accessors (no prototype-chain) ──

function ownMeta(node: GraphNode): Record<string, unknown> {
  const meta = node.metadata;
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) return {};
  return meta as Record<string, unknown>;
}

/** Coerce an unknown value to a valid WorkspaceNodeType (default 'session'). */
export function coerceNodeType(value: unknown): WorkspaceNodeType {
  return WORKSPACE_NODE_TYPES.includes(value as WorkspaceNodeType)
    ? (value as WorkspaceNodeType)
    : 'session';
}

/** The workspace view type of a backend node (from its `nodeType`). */
export function nodeViewType(node: GraphNode): WorkspaceNodeType {
  return coerceNodeType(node.nodeType);
}

/** The node's summary (from `metadata.summary`), or ''. */
export function nodeSummary(node: GraphNode): string {
  const v = ownMeta(node).summary;
  return typeof v === 'string' ? v : '';
}

/** The node's tags (from `metadata.tags`), or []. */
export function nodeTags(node: GraphNode): string[] {
  const v = ownMeta(node).tags;
  if (!Array.isArray(v)) return [];
  return v.filter((t): t is string => typeof t === 'string');
}

/** The node's branch provenance (from `metadata.provenance`), or null. */
export function nodeProvenance(node: GraphNode): NodeProvenance | null {
  const v = ownMeta(node).provenance;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const p = v as Record<string, unknown>;
  return {
    parentId: typeof p.parentId === 'string' ? p.parentId : null,
    sourceMessageId: typeof p.sourceMessageId === 'string' ? p.sourceMessageId : null,
    agent: typeof p.agent === 'string' ? p.agent : null,
    createdAt: typeof p.createdAt === 'string' ? p.createdAt : '',
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

/**
 * Build the `electronAPI.graph.create` payload for a branch off `parent`. PURE:
 * deterministic position (right of parent, vertically spread by sibling count),
 * type→color mapping, and full provenance in metadata. Title trimmed with a
 * generic fallback.
 */
export function branchCreateInput(
  parent: GraphNode,
  intent: BranchIntent,
  siblingCount: number,
  now: string = new Date().toISOString(),
): BranchCreatePayload {
  const nodeType: WorkspaceNodeType = intent.nodeType ?? 'question';
  const title = (intent.title || '').trim() || 'Nhánh mới';
  const laneHeight = 96;
  const spread = siblingCount * laneHeight - (siblingCount > 0 ? laneHeight / 2 : 0);
  const payload: BranchCreatePayload = {
    title,
    nodeType,
    color: NODE_TYPE_COLORS[nodeType],
    x: (parent.x ?? 0) + 280,
    y: (parent.y ?? 0) + spread,
    metadata: {
      summary: (intent.summary ?? '').trim(),
      tags: dedupeTags(intent.tags ?? []),
      provenance: {
        parentId: parent.id,
        sourceMessageId: intent.sourceMessageId ?? null,
        agent: intent.agent ?? null,
        createdAt: now,
      } satisfies NodeProvenance,
    },
  };
  const body = (intent.body ?? '').trim();
  if (body) payload.content = body;
  return payload;
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
