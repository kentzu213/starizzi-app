/**
 * Graph & Memory shared types — the single source of truth for the desktop
 * graph/memory data model, importable from BOTH the Electron main process and
 * the React renderer.
 *
 * These interfaces mirror the Backend_Chia_Sẻ `UserNode` / `UserLink` shapes
 * EXACTLY (`/api/aibase/*` at https://api.izziapi.com). They MUST NOT diverge
 * from the backend model — the backend is the single source of truth.
 *
 * Pure type module: no runtime code, no side effects.
 *
 * @module shared/graph-types
 * @see Requirements 1.3, 3.2, 7.4
 */

/** Mirrors the backend `UserNode` exactly (Req 1.3, 3.2). */
export interface GraphNode {
  id: string;
  title: string;
  nodeType: string;
  content?: string;
  url?: string;
  metadata?: Record<string, unknown>;
  color: string;
  parentId?: string;
  topicId?: string;
  x?: number;
  y?: number;
  createdAt: string;
  updatedAt: string;
}

/** Mirrors the backend `UserLink` exactly. */
export interface GraphLink {
  id: string;
  sourceId: string;
  targetId: string;
  label?: string;
  color?: string;
}

/**
 * Fields the backend accepts on `POST /api/aibase/nodes`.
 * `title` is required and must be non-empty (Req 2.1, 2.2). Server-owned fields
 * (id/createdAt/updatedAt/parentId) are intentionally absent.
 */
export interface NodeCreatePayload {
  title: string;
  nodeType?: string;
  color?: string;
  content?: string;
  url?: string;
  topicId?: string;
  x?: number;
  y?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Whitelist for `PATCH /api/aibase/nodes/:id` (Req 2.3). Adds `isPublic`
 * (patch-only); server-owned fields are intentionally absent.
 */
export interface NodePatchPayload {
  title?: string;
  nodeType?: string;
  color?: string;
  content?: string;
  url?: string;
  x?: number;
  y?: number;
  topicId?: string;
  isPublic?: boolean;
  metadata?: Record<string, unknown>;
}

/**
 * Flat memory item returned across the IPC bridge; the renderer normalizes it
 * further via the existing `normalizeMemoryItems` (Req 8.2).
 */
export interface MemoryItemDTO {
  id: string;
  title: string;
  source: string;
  createdAt: string;
}

/**
 * A community/cluster of nodes returned by `GET /api/aibase/communities`.
 * Mirrors the web `Community` type exactly so the canvas can draw hulls.
 */
export interface GraphCommunity {
  id: number;
  label: string;
  color: string;
  nodeIds: string[];
  size: number;
  centroid: { x: number; y: number } | null;
}

/**
 * A single search hit from `GET /api/aibase/search`. Mirrors the web `SearchHit`
 * type exactly so the search bar renders identically.
 */
export interface GraphSearchHit {
  id: string;
  title: string;
  nodeType: string;
  color: string;
  matchedField: string;
  matchSnippet: string;
  score: number;
  x: number | null;
  y: number | null;
}

/** Metadata returned by `POST /api/aibase/import-url` for a single URL. */
export interface ImportUrlResult {
  title: string;
  description: string;
  nodeType: string;
  url: string;
  metadata: Record<string, unknown>;
}

/** Preview returned by `POST /api/aibase/extract-document` (nodes/links to confirm). */
export interface ExtractDocumentResult {
  nodes: unknown[];
  links: unknown[];
  title: string;
  isDuplicate?: boolean;
  warning?: string;
  crossLinks?: unknown[];
}

/** Result of `POST /api/aibase/graph/synthesize` (build a learning-path map). */
export interface SynthesizeTopicResult {
  ok: boolean;
  topic: string;
  rootTitle: string;
  milestones: number;
  nodesAdded: number;
  free?: boolean;
  charged?: number;
  balance?: number;
}
