/**
 * GraphClient — the HTTP layer for the desktop Knowledge/Graph + Context/Memory
 * surfaces. Lives in the Electron MAIN process; the JWT never leaves main.
 *
 * Reuses the existing auth/session machinery (`AuthManager.getAccessToken()`)
 * and the same base URL + Bearer-header style as `SyncEngine`. Every call hits
 * the shared backend `/api/aibase/*` at https://api.izziapi.com — the single
 * source of truth shared with the web app. No new backend endpoint is created.
 *
 * Security (security-baseline A/B/C):
 *  - The token is read only here, sent only in the `Authorization: Bearer`
 *    header over HTTPS, and NEVER logged, cached, or returned across IPC.
 *  - Auth fails closed: a null token or HTTP 401 rejects the operation with no
 *    anonymous retry (reads → `[]`, writes → `{ error }`).
 *  - Diagnostics record only a short op type / status / message — never the
 *    token, never node content tied to a user's identity.
 *  - Backend JSON is read through pure own-property mappers (no prototype-chain).
 *
 * @module main/graph/graph-client
 * @see Requirements 1.1, 1.4, 1.5, 2.1–2.6, 6.1, 6.2, 6.4, 8.1, 9.1, 9.2, 9.4, 9.5
 */

import type { AuthManager } from '../auth/auth-manager';
import type { DatabaseManager } from '../db/database';
import { randomUUID } from 'crypto';
import {
  userNodeToModel,
  userLinkToModel,
  modelToCreatePayload,
  modelToPatchPayload,
  memoryNodeToItem,
} from '../../shared/graph-mapper';
import type { GraphNode, GraphLink, MemoryItemDTO } from '../../shared/graph-types';

/** Same base URL derivation as AuthManager / SyncEngine (HTTPS). */
const IZZI_API_BASE = process.env.OPENCLAW_API_URL || 'https://api.izziapi.com';

/** Create input accepted by `createNode` — the writable node fields + a title. */
export type NodeCreateInput = Partial<GraphNode> & { title: string };

/**
 * Options for write methods (Phase 2). `queueOnOffline` (default true for IPC
 * calls) enqueues the op to the offline queue on a network failure. The flush
 * orchestrator passes `false` so a still-offline flush does NOT re-enqueue.
 */
export interface WriteOptions {
  queueOnOffline?: boolean;
}

/** A minimal structural view of a fetch `Response` (avoids DOM-lib coupling in main). */
interface JsonResponse {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

/** Read an own-property array from an unknown response object (no prototype-chain). */
function ownArray(raw: unknown, key: string): unknown[] {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return [];
  const obj = raw as Record<string, unknown>;
  if (!Object.hasOwn(obj, key)) return [];
  const value = obj[key];
  return Array.isArray(value) ? value : [];
}

/** Read an own-property value from an unknown response object (no prototype-chain). */
function ownValue(raw: unknown, key: string): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const obj = raw as Record<string, unknown>;
  return Object.hasOwn(obj, key) ? obj[key] : undefined;
}

/** A short, token-free description of a thrown error for diagnostics. */
function shortError(err: unknown): string {
  if (err instanceof Error) {
    const text = err.message || err.name || 'error';
    return text.slice(0, 200);
  }
  return 'error';
}

export class GraphClient {
  constructor(
    private readonly auth: AuthManager,
    private readonly db: DatabaseManager,
  ) {}

  // ── Reads ──────────────────────────────────────────────────────────────

  /** GET /api/aibase/nodes → GraphNode[] (empty on no-auth / error; Req 1.1, 1.4, 1.5). */
  async listNodes(): Promise<GraphNode[]> {
    const token = await this.auth.getAccessToken();
    if (token == null) return []; // Req 1.4 — no backend call without a token

    try {
      const res = await fetch(`${IZZI_API_BASE}/api/aibase/nodes`, {
        headers: this.authHeaders(token),
      });
      if (res.status === 401) return []; // Req 9.5 — fail-closed, no anonymous retry
      if (!res.ok) {
        this.logFailure('graph.listNodes', res.status);
        return []; // Req 1.5
      }
      const data = await res.json();
      return ownArray(data, 'nodes')
        .map(userNodeToModel)
        .filter((node): node is GraphNode => node !== null);
    } catch (err) {
      this.logFailure('graph.listNodes', undefined, shortError(err));
      return []; // Req 1.5 — never throw to the renderer
    }
  }

  /** GET /api/aibase/links → GraphLink[] (empty on no-auth / error). */
  async listLinks(): Promise<GraphLink[]> {
    const token = await this.auth.getAccessToken();
    if (token == null) return [];

    try {
      const res = await fetch(`${IZZI_API_BASE}/api/aibase/links`, {
        headers: this.authHeaders(token),
      });
      if (res.status === 401) return [];
      if (!res.ok) {
        this.logFailure('graph.listLinks', res.status);
        return [];
      }
      const data = await res.json();
      return ownArray(data, 'links')
        .map(userLinkToModel)
        .filter((link): link is GraphLink => link !== null);
    } catch (err) {
      this.logFailure('graph.listLinks', undefined, shortError(err));
      return [];
    }
  }

  /** GET /api/aibase/memory/list?limit=N → MemoryItemDTO[] (empty on no-auth / error; Req 8.1). */
  async listMemory(limit?: number): Promise<MemoryItemDTO[]> {
    const token = await this.auth.getAccessToken();
    if (token == null) return [];

    const query =
      typeof limit === 'number' && Number.isFinite(limit)
        ? `?limit=${encodeURIComponent(String(Math.trunc(limit)))}`
        : '';

    try {
      const res = await fetch(`${IZZI_API_BASE}/api/aibase/memory/list${query}`, {
        headers: this.authHeaders(token),
      });
      if (res.status === 401) return [];
      if (!res.ok) {
        this.logFailure('memory.list', res.status);
        return [];
      }
      const data = await res.json();
      return ownArray(data, 'nodes')
        .map(memoryNodeToItem)
        .filter((item): item is MemoryItemDTO => item !== null);
    } catch (err) {
      this.logFailure('memory.list', undefined, shortError(err));
      return [];
    }
  }

  // ── Writes ─────────────────────────────────────────────────────────────

  /**
   * POST /api/aibase/nodes. Guards an empty/whitespace title BEFORE any network
   * call (Req 2.2). Returns the created GraphNode (mapped from `{ node }`) or
   * `{ error }` (fail-closed on no-auth / 401, pass-through on backend rejection).
   */
  async createNode(
    input: NodeCreateInput,
    options: WriteOptions = {},
  ): Promise<GraphNode | { error: string }> {
    const title = typeof input?.title === 'string' ? input.title.trim() : '';
    if (title.length === 0) {
      return { error: 'Title is required' }; // Req 2.2 — no backend call
    }

    const token = await this.auth.getAccessToken();
    if (token == null) {
      return { error: 'unauthorized' }; // Req 9.5 — fail-closed, no backend call
    }

    const payload = modelToCreatePayload({ ...input, title });
    try {
      const res = await fetch(`${IZZI_API_BASE}/api/aibase/nodes`, {
        method: 'POST',
        headers: this.authHeaders(token),
        body: JSON.stringify(payload),
      });
      if (res.status === 401) return { error: 'unauthorized' }; // Req 9.5 — no retry
      if (!res.ok) {
        const message = await this.readBackendError(res);
        this.logFailure('graph.createNode', res.status);
        return { error: message }; // Req 2.6 — pass backend rejection through
      }
      const data = await res.json();
      const node = userNodeToModel(ownValue(data, 'node'));
      return node ?? { error: 'Invalid response' };
    } catch (err) {
      // Network failure → offline. Queue the create for later flush (Req 4.1).
      this.logFailure('graph.createNode', undefined, shortError(err));
      if (options.queueOnOffline !== false) {
        this.db.enqueueOp({
          opType: 'create',
          target: 'node',
          localId: `local-${randomUUID()}`,
          payload: payload as unknown as Record<string, unknown>,
          createdAt: new Date().toISOString(),
        });
      }
      return { error: 'network error' };
    }
  }

  /**
   * PATCH /api/aibase/nodes/:id with the patch whitelist only (Req 2.3). The
   * backend confirms with `{ ok: true }` (it does not echo the node), so success
   * is reported as `{ ok: true }`; the renderer store re-reads the source of
   * truth via `refresh()`.
   */
  async updateNode(
    id: string,
    patch: Partial<GraphNode> & { isPublic?: boolean },
    options: WriteOptions = {},
  ): Promise<{ ok: true } | { error: string }> {
    const token = await this.auth.getAccessToken();
    if (token == null) {
      return { error: 'unauthorized' }; // Req 9.5 — fail-closed, no backend call
    }

    const payload = modelToPatchPayload(patch);
    try {
      const res = await fetch(`${IZZI_API_BASE}/api/aibase/nodes/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: this.authHeaders(token),
        body: JSON.stringify(payload),
      });
      if (res.status === 401) return { error: 'unauthorized' }; // Req 9.5 — no retry
      if (!res.ok) {
        const message = await this.readBackendError(res);
        this.logFailure('graph.updateNode', res.status);
        return { error: message }; // Req 2.6 — pass backend rejection through
      }
      return { ok: true };
    } catch (err) {
      // Network failure → offline. Queue the update; capture the last-seen
      // updatedAt as the LWW base so flush can defer to a newer backend edit (Req 4.1, 4.5).
      this.logFailure('graph.updateNode', undefined, shortError(err));
      if (options.queueOnOffline !== false) {
        this.db.enqueueOp({
          opType: 'update',
          target: 'node',
          backendId: id,
          baseUpdatedAt: this.cachedUpdatedAt(id),
          payload: payload as unknown as Record<string, unknown>,
          createdAt: new Date().toISOString(),
        });
      }
      return { error: 'network error' };
    }
  }

  /** DELETE /api/aibase/nodes/:id. Returns `{ ok }`, fail-closed on no-auth / 401. */
  async removeNode(
    id: string,
    options: WriteOptions = {},
  ): Promise<{ ok: boolean; error?: string }> {
    const token = await this.auth.getAccessToken();
    if (token == null) {
      return { ok: false, error: 'unauthorized' }; // Req 9.5 — fail-closed, no backend call
    }

    try {
      const res = await fetch(`${IZZI_API_BASE}/api/aibase/nodes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: this.authHeaders(token),
      });
      if (res.status === 401) return { ok: false, error: 'unauthorized' }; // Req 9.5 — no retry
      if (!res.ok) {
        const message = await this.readBackendError(res);
        this.logFailure('graph.removeNode', res.status);
        return { ok: false, error: message }; // Req 2.6 — pass backend rejection through
      }
      return { ok: true };
    } catch (err) {
      // Network failure → offline. Queue the delete for later flush (Req 4.1).
      this.logFailure('graph.removeNode', undefined, shortError(err));
      if (options.queueOnOffline !== false) {
        this.db.enqueueOp({
          opType: 'delete',
          target: 'node',
          backendId: id,
          payload: {},
          createdAt: new Date().toISOString(),
        });
      }
      return { ok: false, error: 'network error' };
    }
  }

  // ── Links ──────────────────────────────────────────────────────────────

  /**
   * POST /api/aibase/links — create an edge between two nodes that both belong
   * to the user. Returns the GraphLink or `{ error }` (fail-closed on no-auth /
   * 401; pass-through on backend rejection, e.g. 403 not-owned, 409 duplicate).
   * The target node must already exist on the backend (so branch = create node
   * first → then link).
   */
  async createLink(
    sourceId: string,
    targetId: string,
    label?: string,
    color?: string,
  ): Promise<GraphLink | { error: string }> {
    if (!sourceId || !targetId) return { error: 'sourceId and targetId required' };

    const token = await this.auth.getAccessToken();
    if (token == null) return { error: 'unauthorized' };

    try {
      const res = await fetch(`${IZZI_API_BASE}/api/aibase/links`, {
        method: 'POST',
        headers: this.authHeaders(token),
        body: JSON.stringify({ sourceId, targetId, label, color }),
      });
      if (res.status === 401) return { error: 'unauthorized' };
      if (!res.ok) {
        const message = await this.readBackendError(res);
        this.logFailure('graph.createLink', res.status);
        return { error: message };
      }
      const data = await res.json();
      const linkId = ownValue(ownValue(data, 'link'), 'id');
      const id = typeof linkId === 'string' ? linkId : `link-${sourceId}-${targetId}`;
      const link: GraphLink = { id, sourceId, targetId };
      if (typeof label === 'string') link.label = label;
      if (typeof color === 'string') link.color = color;
      return link;
    } catch (err) {
      this.logFailure('graph.createLink', undefined, shortError(err));
      return { error: 'network error' };
    }
  }

  /** DELETE /api/aibase/links/:id. Returns `{ ok }`, fail-closed on no-auth / 401. */
  async removeLink(id: string): Promise<{ ok: boolean; error?: string }> {
    const token = await this.auth.getAccessToken();
    if (token == null) return { ok: false, error: 'unauthorized' };

    try {
      const res = await fetch(`${IZZI_API_BASE}/api/aibase/links/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: this.authHeaders(token),
      });
      if (res.status === 401) return { ok: false, error: 'unauthorized' };
      if (!res.ok) {
        const message = await this.readBackendError(res);
        this.logFailure('graph.removeLink', res.status);
        return { ok: false, error: message };
      }
      return { ok: true };
    } catch (err) {
      this.logFailure('graph.removeLink', undefined, shortError(err));
      return { ok: false, error: 'network error' };
    }
  }

  /**
   * Look up the `updatedAt` of a cached node (populated by the SyncEngine's
   * graph-refresh step) to use as the LWW base. Returns undefined if not cached
   * — flush then treats the local edit optimistically (Req 4.5). Best-effort,
   * never throws.
   */
  private cachedUpdatedAt(id: string): string | undefined {
    try {
      const cached = this.db.getUserData('graph_nodes');
      for (const entry of cached) {
        const list = Array.isArray(entry) ? entry : [];
        for (const node of list) {
          if (
            node !== null &&
            typeof node === 'object' &&
            Object.hasOwn(node, 'id') &&
            node.id === id &&
            Object.hasOwn(node, 'updatedAt') &&
            typeof node.updatedAt === 'string'
          ) {
            return node.updatedAt;
          }
        }
      }
    } catch {
      // best-effort — a missing/odd cache just yields an optimistic flush
    }
    return undefined;
  }

  // ── Internals ──────────────────────────────────────────────────────────

  /** Build request headers. The token lives only here, never crosses IPC (Req 6.4, 7.3, 9.2). */
  private authHeaders(token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  /** Extract the backend's error message to pass through (Req 2.6); fall back to the status. */
  private async readBackendError(res: JsonResponse): Promise<string> {
    try {
      const data = await res.json();
      const error = ownValue(data, 'error');
      if (typeof error === 'string' && error.length > 0) return error;
    } catch {
      // ignore parse errors — fall through to a status-based message
    }
    return `HTTP ${res.status}`;
  }

  /**
   * Record a diagnostic for a failed call. Logs ONLY the op type, HTTP status,
   * and a short message — never the token, never node content with identity
   * (Req 9.2, 9.4). Best-effort: logging never throws.
   */
  private logFailure(type: string, status?: number, message?: string): void {
    const detail = status !== undefined ? `request failed (status ${status})` : message ?? 'request failed';
    try {
      this.db.appendDiagnosticEvent({
        type,
        status: 'error',
        detail,
        meta: status !== undefined ? { status } : undefined,
      });
    } catch {
      // diagnostics are best-effort and must never break the operation
    }
  }
}
