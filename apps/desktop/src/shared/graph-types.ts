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
