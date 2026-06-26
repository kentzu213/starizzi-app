/**
 * Offline write queue — PURE logic for Phase 2 of desktop-graph-backend-sync.
 *
 * When the desktop cannot reach the shared backend, write operations are queued
 * locally (persisted in SQLite by `DatabaseManager`) and flushed on reconnect by
 * the `SyncEngine`. This module holds the SIDE-EFFECT-FREE brain of that flow:
 * how pending operations collapse (`coalesce`), which link operations are safe to
 * send without creating orphans (`sendableLinkOps`), and who wins a concurrent
 * edit (`resolveConflict`). Persistence, id-remapping, and HTTP live in the
 * orchestrator (SyncEngine), never here.
 *
 * Every function is pure: no side effects, never throws, reads via own-property
 * only (no prototype-chain), and never fabricates data.
 *
 * @module shared/offline-queue
 * @see Requirements 4.3 (coalesce), 4.4/4.7 (no-orphan), 4.5 (last-write-wins),
 *      11.2 (idempotence), 11.3 (metamorphic), 11.4 (no-orphan invariant)
 */

/** A single queued write operation. `localId` names an offline-created entity
 *  not yet on the backend; `backendId` names an existing backend entity;
 *  `baseUpdatedAt` is the `updatedAt` the desktop saw when the edit was made
 *  (used for last-write-wins at flush time). For a link op, `payload` carries
 *  `sourceRef` / `targetRef` (each a localId or backendId). */
export interface QueueOp {
  seq: number;
  opType: 'create' | 'update' | 'delete';
  target: 'node' | 'link';
  localId?: string;
  backendId?: string;
  baseUpdatedAt?: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Stable grouping key for an op: prefer the backend id, then the local id; an
 *  op with neither is its own group (never merged with unrelated ops). */
function groupKey(op: QueueOp): string {
  const id = op.backendId ?? op.localId;
  return `${op.target}:${id ?? `__noid_${op.seq}`}`;
}

/** Own-property read of an optional string ref (no prototype-chain). */
function ownRef(payload: Record<string, unknown>, key: string): string | undefined {
  if (!Object.hasOwn(payload, key)) return undefined;
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

/** Merge payloads in order, later own-properties winning. Pure; returns a new object. */
function mergePayloads(ops: QueueOp[]): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const op of ops) {
    const p = op.payload;
    if (p === null || typeof p !== 'object') continue;
    for (const key of Object.keys(p)) {
      if (Object.hasOwn(p, key)) merged[key] = p[key];
    }
  }
  return merged;
}

/** A coalesced group: the single surviving op (or `null` if the group cancelled
 *  out, e.g. create+delete offline) plus every original `seq` it consumed — so
 *  the flush orchestrator can dequeue all consumed rows together. */
export interface CoalesceGroup {
  survivor: QueueOp | null;
  seqs: number[];
}

/**
 * Group + collapse the queue, returning each group's surviving op and the
 * original `seq`s it consumed (Req 4.3). Same collapse rules as {@link coalesce};
 * exposed separately so the flush can dequeue every consumed row (including the
 * rows of a cancelled create+delete group). Groups are returned in
 * first-appearance (FIFO) order. Pure.
 */
export function coalesceGroups(q: QueueOp[]): CoalesceGroup[] {
  if (!Array.isArray(q) || q.length === 0) return [];

  const ordered = [...q].sort((a, b) => a.seq - b.seq);

  const groups = new Map<string, QueueOp[]>();
  const order: string[] = [];
  for (const op of ordered) {
    const key = groupKey(op);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(op);
    } else {
      groups.set(key, [op]);
      order.push(key);
    }
  }

  const result: CoalesceGroup[] = [];

  for (const key of order) {
    const ops = groups.get(key)!;
    const seqs = ops.map((o) => o.seq);
    const hasCreate = ops.some((o) => o.opType === 'create');
    const hasDelete = ops.some((o) => o.opType === 'delete');
    const hasBackendId = ops.some((o) => o.backendId !== undefined);
    const first = ops[0];

    // create + delete, never synced → cancels out (Req 4.3).
    if (hasCreate && hasDelete && !hasBackendId) {
      result.push({ survivor: null, seqs });
      continue;
    }

    // delete dominates (entity exists on backend, or a create that did reach it).
    if (hasDelete) {
      const del = [...ops].reverse().find((o) => o.opType === 'delete')!;
      result.push({ survivor: { ...del, seq: first.seq, payload: {} }, seqs });
      continue;
    }

    // create (+ later updates) → one create with merged payload.
    if (hasCreate) {
      result.push({
        survivor: { ...first, opType: 'create', seq: first.seq, payload: mergePayloads(ops) },
        seqs,
      });
      continue;
    }

    // updates only → one merged update; keep earliest baseUpdatedAt for LWW.
    result.push({
      survivor: {
        ...first,
        opType: 'update',
        seq: first.seq,
        baseUpdatedAt: first.baseUpdatedAt,
        payload: mergePayloads(ops),
      },
      seqs,
    });
  }

  return result;
}

/**
 * Collapse a queue of pending writes (Req 4.3). Per stable entity key
 * (`target` + backendId|localId), in FIFO order:
 *
 *  - create + later update(s)        → one `create` with merged payload
 *  - create + delete (no backendId)  → removed entirely (created & deleted offline → no-op)
 *  - update(s) only                  → one merged `update` (later field wins)
 *  - update(s) + delete              → just the `delete` (updates are moot)
 *
 * Survivors keep the representative op's `seq` and the result is sorted by `seq`,
 * preserving the order in which entities first appeared. Pure and idempotent:
 * `coalesce(coalesce(q))` deep-equals `coalesce(q)` (Property 2), and the result
 * is never longer than the input (Property 3). Unrelated ops are never reordered
 * or invented.
 */
export function coalesce(q: QueueOp[]): QueueOp[] {
  return coalesceGroups(q)
    .map((group) => group.survivor)
    .filter((survivor): survivor is QueueOp => survivor !== null)
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Select the link operations that are safe to send (Req 4.4, 4.7). A link op is
 * sendable only when BOTH of its endpoint refs (`payload.sourceRef`,
 * `payload.targetRef`) resolve in `knownNodeIds` — i.e. each endpoint either
 * exists on the backend or is itself a node-create present in the (already
 * resolved) queue. Link ops referencing a not-yet-available node are withheld,
 * preserving the no-orphan invariant (Property 4). FIFO order is preserved.
 */
export function sendableLinkOps(
  q: QueueOp[],
  knownNodeIds: ReadonlySet<string>,
): QueueOp[] {
  if (!Array.isArray(q)) return [];
  return q
    .filter((op) => op.target === 'link' && op.opType !== 'delete')
    .filter((op) => {
      const source = ownRef(op.payload, 'sourceRef');
      const target = ownRef(op.payload, 'targetRef');
      return (
        source !== undefined &&
        target !== undefined &&
        knownNodeIds.has(source) &&
        knownNodeIds.has(target)
      );
    })
    .sort((a, b) => a.seq - b.seq);
}

/**
 * Last-write-wins by `updatedAt` (Req 4.5). Returns `'backend'` when the backend
 * copy is strictly newer than the version the local edit was based on — meaning
 * the local blind overwrite should be skipped to avoid clobbering a newer edit.
 * Otherwise `'local'`. A missing base or backend timestamp yields `'local'`
 * (no basis to defer to the backend).
 */
export function resolveConflict(
  baseUpdatedAt: string | undefined,
  backendUpdatedAt: string | undefined,
): 'local' | 'backend' {
  if (baseUpdatedAt === undefined || backendUpdatedAt === undefined) return 'local';
  const base = Date.parse(baseUpdatedAt);
  const backend = Date.parse(backendUpdatedAt);
  if (Number.isNaN(base) || Number.isNaN(backend)) return 'local';
  return backend > base ? 'backend' : 'local';
}
