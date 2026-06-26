/**
 * Universe adapter — PURE mapper from the PUBLIC community knowledge graph
 * (izziapi.com `GET /api/dochub/graph`) into the desktop workspace `GraphNode`
 * model, for the "Nạp Vũ trụ tri thức" seed overlay in the Branching Graph
 * Workspace.
 *
 * The public graph is the SHARED knowledge universe (one source of truth). We do
 * NOT copy it into each user's personal graph — instead the workspace renders it
 * as a READ-ONLY seed layer (`metadata.seed === true`); a node only becomes an
 * owned `user_node` when the user explicitly "adopts" it to start working. This
 * keeps the second-brain model intact (universe shared, your work is yours) and
 * avoids a bulk write / billing blast radius.
 *
 * The web response is UNTRUSTED (network): every read is own-property only (no
 * prototype-chain), shapes are validated, and the node count is capped. No I/O,
 * no Electron, no secrets → fully unit-testable.
 *
 * @module shared/universe-adapter
 */
import type { GraphNode, GraphLink } from './graph-types';

/** Minimal shape of a web community GraphNode we consume (others ignored). */
export interface RawUniverseNode {
  id: string;
  name?: string;
  color?: string;
  type?: string; // "core" | "topic" | "child" | "article"
  group?: string;
  topicId?: string;
}

/** Minimal shape of a web community GraphLink we consume. */
export interface RawUniverseLink {
  source: string;
  target: string;
  color?: string;
}

export interface RawUniverse {
  nodes: RawUniverseNode[];
  links: RawUniverseLink[];
}

/** Workspace visual type each web node type maps to (drives icon + accent). */
const TYPE_MAP: Record<string, GraphNode['nodeType']> = {
  core: 'root',
  topic: 'insight',
  child: 'question',
  article: 'artifact',
};

const DEFAULT_SEED_COLOR = '#5ca7ff';
/** Hard cap so a pathological response can never freeze the canvas. */
export const UNIVERSE_NODE_CAP = 400;

// ── Untrusted-input helpers (own-property only) ──────────────────────────

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
function ownStr(obj: Record<string, unknown>, key: string): string | undefined {
  if (!Object.hasOwn(obj, key)) return undefined;
  const v = obj[key];
  return typeof v === 'string' ? v : undefined;
}
function ownArr(obj: Record<string, unknown>, key: string): unknown[] {
  if (!Object.hasOwn(obj, key)) return [];
  const v = obj[key];
  return Array.isArray(v) ? v : [];
}

/**
 * Parse the raw `GET /api/dochub/graph` response (`{ success, data:{nodes,links} }`
 * or a bare `{ nodes, links }`) into a validated `RawUniverse`. Returns null if
 * the shape is unusable. Never throws.
 */
export function parseUniverseResponse(raw: unknown): RawUniverse | null {
  if (!isObj(raw)) return null;
  // Unwrap `{ success, data }` if present, else treat the object itself as data.
  const data = Object.hasOwn(raw, 'data') && isObj(raw.data) ? raw.data : raw;
  if (!isObj(data)) return null;

  const nodes: RawUniverseNode[] = [];
  for (const item of ownArr(data, 'nodes')) {
    if (!isObj(item)) continue;
    const id = ownStr(item, 'id');
    if (!id) continue;
    nodes.push({
      id,
      name: ownStr(item, 'name'),
      color: ownStr(item, 'color'),
      type: ownStr(item, 'type'),
      group: ownStr(item, 'group'),
      topicId: ownStr(item, 'topicId'),
    });
  }

  const links: RawUniverseLink[] = [];
  for (const item of ownArr(data, 'links')) {
    if (!isObj(item)) continue;
    const source = ownStr(item, 'source');
    const target = ownStr(item, 'target');
    if (!source || !target) continue;
    links.push({ source, target, color: ownStr(item, 'color') });
  }

  if (nodes.length === 0) return null;
  return { nodes, links };
}

/**
 * Deterministic radial layout: core at the origin, topics on a ring, every
 * other node clustered on a small circle around its topic (`group`/`topicId`).
 * Pure trig → identical positions for identical input (testable). Nodes whose
 * group has no topic land on an outer fallback ring.
 */
function computePositions(nodes: RawUniverseNode[]): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>();
  const topics = nodes.filter((n) => n.type === 'topic');
  const topicCount = Math.max(1, topics.length);
  const R_TOPIC = 460;
  const R_LEAF_BASE = 150;

  const topicPos = new Map<string, { x: number; y: number; angle: number }>();
  topics.forEach((t, i) => {
    const angle = (i / topicCount) * Math.PI * 2;
    const x = Math.cos(angle) * R_TOPIC;
    const y = Math.sin(angle) * R_TOPIC;
    topicPos.set(t.id, { x, y, angle });
    pos.set(t.id, { x, y });
  });

  // Group leaves (non-core, non-topic) by their topic group.
  const leavesByTopic = new Map<string, RawUniverseNode[]>();
  for (const n of nodes) {
    if (n.type === 'core' || n.type === 'topic') continue;
    const g = n.group || n.topicId || '__ungrouped__';
    const list = leavesByTopic.get(g);
    if (list) list.push(n);
    else leavesByTopic.set(g, [n]);
  }

  let ungroupedIndex = 0;
  for (const [group, leaves] of leavesByTopic) {
    const anchor = topicPos.get(group);
    const radius = R_LEAF_BASE + leaves.length * 4;
    leaves.forEach((leaf, j) => {
      const ringAngle = (j / Math.max(1, leaves.length)) * Math.PI * 2;
      if (anchor) {
        pos.set(leaf.id, {
          x: anchor.x + Math.cos(ringAngle) * radius,
          y: anchor.y + Math.sin(ringAngle) * radius,
        });
      } else {
        // Outer fallback ring for nodes with no resolvable topic.
        const a = (ungroupedIndex / 12) * Math.PI * 2;
        pos.set(leaf.id, { x: Math.cos(a) * 920, y: Math.sin(a) * 920 });
        ungroupedIndex += 1;
      }
    });
  }

  // Core(s) at the origin.
  for (const n of nodes) if (n.type === 'core') pos.set(n.id, { x: 0, y: 0 });
  return pos;
}

/**
 * Adapt a validated `RawUniverse` into read-only seed `GraphNode[]` + `GraphLink[]`
 * for the workspace canvas. Caps the node count (core/topic/child kept first, then
 * articles), maps web type → workspace visual type, marks every node as a seed
 * (`metadata.seed`, `metadata.universeId`), and drops any link without both
 * endpoints present (no-orphan). PURE; never throws.
 */
export function adaptUniverse(
  raw: RawUniverse,
  now: string = new Date().toISOString(),
): { nodes: GraphNode[]; links: GraphLink[] } {
  // Cap: keep structural nodes (core/topic/child) first, then articles.
  const rank = (t?: string): number =>
    t === 'core' ? 0 : t === 'topic' ? 1 : t === 'child' ? 2 : 3;
  const ordered = [...raw.nodes].sort((a, b) => rank(a.type) - rank(b.type));
  const capped = ordered.slice(0, UNIVERSE_NODE_CAP);

  const positions = computePositions(capped);
  const present = new Set(capped.map((n) => n.id));

  const nodes: GraphNode[] = capped.map((n) => {
    const nodeType = TYPE_MAP[n.type ?? ''] ?? 'session';
    const p = positions.get(n.id) ?? { x: 0, y: 0 };
    const title = (n.name ?? '').trim() || n.id;
    return {
      id: n.id,
      title,
      nodeType,
      color: n.color || DEFAULT_SEED_COLOR,
      content: '',
      x: p.x,
      y: p.y,
      metadata: {
        seed: true,
        universeId: n.id,
        universeType: n.type ?? 'article',
        summary: '',
        tags: n.type ? [n.type] : [],
      },
      createdAt: now,
      updatedAt: now,
    };
  });

  const seen = new Set<string>();
  const links: GraphLink[] = [];
  for (const l of raw.links) {
    if (!present.has(l.source) || !present.has(l.target)) continue; // no-orphan
    const id = `useed-${l.source}->${l.target}`;
    if (seen.has(id)) continue; // dedupe
    seen.add(id);
    const link: GraphLink = { id, sourceId: l.source, targetId: l.target };
    if (typeof l.color === 'string') link.color = l.color;
    links.push(link);
  }

  return { nodes, links };
}

/** Convenience: parse + adapt in one call. Returns empty graph on bad input. */
export function buildUniverseSeed(
  raw: unknown,
  now?: string,
): { nodes: GraphNode[]; links: GraphLink[] } {
  const parsed = parseUniverseResponse(raw);
  if (parsed === null) return { nodes: [], links: [] };
  return adaptUniverse(parsed, now);
}
