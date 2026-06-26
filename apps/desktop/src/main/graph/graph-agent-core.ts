/**
 * Graph agent core — PURE prompt builders + classifier-JSON parser for the
 * AI Branching Graph Workspace. No Electron, no network, no secrets → unit-testable.
 *
 * Two concerns (per spec) kept separate: the chat reply messages, and the branch
 * classifier messages whose JSON output is parsed/validated here. Classifier
 * output is treated as UNTRUSTED data (own-property reads, enum + range validation).
 *
 * @module main/graph/graph-agent-core
 */
import type { GraphNode } from '../../shared/graph-types';

export const SYSTEM_PROMPT =
  'You are an exploration agent inside a branching knowledge graph. Help the user ' +
  'deepen the selected node. Keep answers useful and concise. When a new subtopic, ' +
  'question, task, artifact, or insight emerges, it should become a new branch. ' +
  'Preserve context from the current node and its ancestors. Reply in the user\'s language.';

export const CLASSIFIER_PROMPT =
  'You analyze a chat exchange inside a knowledge graph and decide whether it warrants ' +
  'a NEW child node (branch). Only branch for a genuinely new subtopic, a deeper line of ' +
  'inquiry, a decision, an artifact, a task, or a question worth keeping — NOT for every ' +
  'message. Respond with ONLY a JSON object, no prose, of the exact shape:\n' +
  '{"shouldCreateBranch":boolean,"title":"short title","summary":"1-3 sentences",' +
  '"nodeType":"question|insight|task|artifact|session","reason":"why","tags":["..."],' +
  '"confidence":0.0}';

/** Allowed branch node types (root is never a branch target). */
export const BRANCH_NODE_TYPES = ['question', 'insight', 'task', 'artifact', 'session'] as const;
export type BranchNodeType = (typeof BRANCH_NODE_TYPES)[number];

/** Mirrors the renderer `BranchClassification` (structurally identical over IPC). */
export interface ParsedClassification {
  shouldCreateBranch: boolean;
  parentNodeId: string;
  title: string;
  summary: string;
  nodeType: BranchNodeType;
  reason: string;
  tags: string[];
  confidence: number;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Own-property read of `metadata.summary` (no prototype-chain). */
function summaryOf(node: GraphNode): string {
  const m = node.metadata;
  if (m === null || typeof m !== 'object' || Array.isArray(m)) return '';
  const obj = m as Record<string, unknown>;
  const v = Object.hasOwn(obj, 'summary') ? obj.summary : undefined;
  return typeof v === 'string' ? v : '';
}

/** Build the ancestor + current-node context block (ancestor context inheritance). */
export function buildContextBlock(node: GraphNode, ancestors: GraphNode[]): string {
  const lines: string[] = [];
  if (ancestors.length > 0) {
    lines.push('Ancestor path:');
    for (const a of ancestors) {
      const s = summaryOf(a);
      lines.push(`- ${a.title}${s ? ` — ${s}` : ''}`);
    }
  }
  const cs = summaryOf(node);
  lines.push(`Current node: ${node.title}${cs ? ` — ${cs}` : ''}`);
  if (node.content && node.content.trim()) {
    lines.push(`Current node notes: ${node.content.trim().slice(0, 800)}`);
  }
  return lines.join('\n');
}

/** Messages for the chat reply call. */
export function buildChatMessages(node: GraphNode, ancestors: GraphNode[], message: string): ChatMessage[] {
  return [
    { role: 'system', content: `${SYSTEM_PROMPT}\n\n${buildContextBlock(node, ancestors)}` },
    { role: 'user', content: message },
  ];
}

/** Messages for the branch-classifier call. */
export function buildClassifierMessages(message: string, reply: string): ChatMessage[] {
  return [
    { role: 'system', content: CLASSIFIER_PROMPT },
    { role: 'user', content: `User: ${message}\n\nAssistant: ${reply}` },
  ];
}

/** Extract the first balanced-looking JSON object substring from model output. */
function extractJsonObject(raw: string): string | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  return raw.slice(start, end + 1);
}

function clamp01(n: unknown): number {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/**
 * Parse + validate the classifier's JSON output into a ParsedClassification.
 * UNTRUSTED input: own-property reads, nodeType validated against the enum
 * (default 'question'), confidence clamped to [0,1], `parentNodeId` taken from
 * the trusted caller (never the model). Returns null on parse failure / empty
 * title so the caller can fall back to the heuristic. PURE; never throws.
 */
export function parseClassification(raw: string, parentNodeId: string): ParsedClassification | null {
  const json = extractJsonObject(typeof raw === 'string' ? raw : '');
  if (json === null) return null;

  let obj: Record<string, unknown>;
  try {
    const parsed = JSON.parse(json);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    obj = parsed as Record<string, unknown>;
  } catch {
    return null;
  }

  const read = (key: string): unknown => (Object.hasOwn(obj, key) ? obj[key] : undefined);

  const title = typeof read('title') === 'string' ? (read('title') as string).trim() : '';
  if (title.length === 0) return null;

  const rawType = read('nodeType');
  const nodeType: BranchNodeType = BRANCH_NODE_TYPES.includes(rawType as BranchNodeType)
    ? (rawType as BranchNodeType)
    : 'question';

  const rawTags = read('tags');
  const tags = Array.isArray(rawTags)
    ? rawTags.filter((t): t is string => typeof t === 'string').map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    shouldCreateBranch: read('shouldCreateBranch') === true,
    parentNodeId,
    title: title.slice(0, 120),
    summary: typeof read('summary') === 'string' ? (read('summary') as string).slice(0, 400) : '',
    nodeType,
    reason: typeof read('reason') === 'string' ? (read('reason') as string).slice(0, 300) : '',
    tags,
    confidence: clamp01(read('confidence')),
  };
}
