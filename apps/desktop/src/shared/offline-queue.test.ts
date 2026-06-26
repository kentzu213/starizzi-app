// Feature: desktop-graph-backend-sync, Phase 2 — offline queue pure logic.
//
// Property 2 (idempotence): coalesce(coalesce(q)) deep-equals coalesce(q).
// Property 3 (metamorphic): coalesce(q).length <= q.length.
// Property 4 (no-orphan): every op in sendableLinkOps(q, known) has both
//   endpoint refs in `known`.
//
// Validates: Requirements 4.3, 4.4, 4.5, 4.7, 11.2, 11.3, 11.4

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { coalesce, sendableLinkOps, resolveConflict, type QueueOp } from './offline-queue';

// ── Arbitraries ────────────────────────────────────────────────────────────

/** A small pool of entity ids so ops realistically collide on the same key. */
const NODE_IDS = ['a', 'b', 'c'] as const;

/** Generate a node QueueOp referencing one of a small id pool. */
const nodeOpArb = (seq: number): fc.Arbitrary<QueueOp> =>
  fc.record({
    opType: fc.constantFrom<'create' | 'update' | 'delete'>('create', 'update', 'delete'),
    key: fc.constantFrom(...NODE_IDS),
    useBackendId: fc.boolean(),
    payload: fc.dictionary(
      fc.constantFrom('title', 'color', 'content', 'x', 'y'),
      fc.oneof(fc.string(), fc.integer()),
    ),
  }).map(({ opType, key, useBackendId, payload }) => {
    const op: QueueOp = {
      seq,
      opType,
      target: 'node',
      payload,
      createdAt: '2025-01-01T00:00:00.000Z',
    };
    // create ops are offline-only (localId, no backendId); update/delete target
    // an existing backend entity.
    if (opType === 'create') op.localId = key;
    else if (useBackendId) op.backendId = key;
    else op.localId = key;
    return op;
  });

/** Generate a queue with strictly increasing seq values. */
const queueArb: fc.Arbitrary<QueueOp[]> = fc
  .array(fc.nat({ max: 1 }), { maxLength: 12 })
  .chain((arr) => fc.tuple(...arr.map((_, i) => nodeOpArb(i))))
  .map((ops) => ops as QueueOp[]);

/** Generate a link QueueOp with arbitrary endpoint refs. */
const linkOpArb = (seq: number): fc.Arbitrary<QueueOp> =>
  fc.record({
    sourceRef: fc.constantFrom(...NODE_IDS, 'missing'),
    targetRef: fc.constantFrom(...NODE_IDS, 'missing'),
  }).map(({ sourceRef, targetRef }) => ({
    seq,
    opType: 'create' as const,
    target: 'link' as const,
    payload: { sourceRef, targetRef },
    createdAt: '2025-01-01T00:00:00.000Z',
  }));

const linkQueueArb: fc.Arbitrary<QueueOp[]> = fc
  .array(fc.nat({ max: 1 }), { maxLength: 10 })
  .chain((arr) => fc.tuple(...arr.map((_, i) => linkOpArb(i))))
  .map((ops) => ops as QueueOp[]);

// ── Property tests ───────────────────────────────────────────────────────────

describe('Property 2: coalesce is idempotent (Req 4.3, 11.2)', () => {
  it('coalesce(coalesce(q)) deep-equals coalesce(q)', () => {
    fc.assert(
      fc.property(queueArb, (q) => {
        const once = coalesce(q);
        const twice = coalesce(once);
        expect(twice).toEqual(once);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 3: coalesce never increases op count (Req 4.3, 11.3)', () => {
  it('coalesce(q).length <= q.length', () => {
    fc.assert(
      fc.property(queueArb, (q) => {
        expect(coalesce(q).length).toBeLessThanOrEqual(q.length);
      }),
      { numRuns: 100 },
    );
  });
});

describe('Property 4: sendableLinkOps preserves the no-orphan invariant (Req 4.4, 4.7, 11.4)', () => {
  it('every returned link op has both endpoint refs in knownNodeIds', () => {
    fc.assert(
      fc.property(
        linkQueueArb,
        fc.subarray([...NODE_IDS]),
        (q, knownArr) => {
          const known = new Set<string>(knownArr);
          for (const op of sendableLinkOps(q, known)) {
            const source = op.payload.sourceRef as string;
            const target = op.payload.targetRef as string;
            expect(known.has(source)).toBe(true);
            expect(known.has(target)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Example (deterministic) tests for the tricky sequences ────────────────────

const base = (over: Partial<QueueOp> & Pick<QueueOp, 'seq' | 'opType' | 'target'>): QueueOp => ({
  payload: {},
  createdAt: '2025-01-01T00:00:00.000Z',
  ...over,
});

describe('coalesce — tricky sequences', () => {
  it('create + update on the same node → one create with merged fields', () => {
    const q: QueueOp[] = [
      base({ seq: 0, opType: 'create', target: 'node', localId: 'n1', payload: { title: 'A', color: '#111' } }),
      base({ seq: 1, opType: 'update', target: 'node', localId: 'n1', payload: { color: '#222' } }),
    ];
    const out = coalesce(q);
    expect(out).toHaveLength(1);
    expect(out[0].opType).toBe('create');
    expect(out[0].payload).toEqual({ title: 'A', color: '#222' });
  });

  it('create + delete on the same offline node (no backendId) → empty', () => {
    const q: QueueOp[] = [
      base({ seq: 0, opType: 'create', target: 'node', localId: 'n1', payload: { title: 'A' } }),
      base({ seq: 1, opType: 'delete', target: 'node', localId: 'n1' }),
    ];
    expect(coalesce(q)).toEqual([]);
  });

  it('update + update on the same node → one merged update (later field wins)', () => {
    const q: QueueOp[] = [
      base({ seq: 0, opType: 'update', target: 'node', backendId: 'n1', payload: { title: 'first', x: 1 } }),
      base({ seq: 1, opType: 'update', target: 'node', backendId: 'n1', payload: { title: 'second' } }),
    ];
    const out = coalesce(q);
    expect(out).toHaveLength(1);
    expect(out[0].opType).toBe('update');
    expect(out[0].payload).toEqual({ title: 'second', x: 1 });
  });

  it('update + delete on the same backend node → just the delete', () => {
    const q: QueueOp[] = [
      base({ seq: 0, opType: 'update', target: 'node', backendId: 'n1', payload: { title: 'x' } }),
      base({ seq: 1, opType: 'delete', target: 'node', backendId: 'n1' }),
    ];
    const out = coalesce(q);
    expect(out).toHaveLength(1);
    expect(out[0].opType).toBe('delete');
    expect(out[0].backendId).toBe('n1');
  });

  it('leaves operations on different nodes independent', () => {
    const q: QueueOp[] = [
      base({ seq: 0, opType: 'create', target: 'node', localId: 'n1', payload: { title: 'A' } }),
      base({ seq: 1, opType: 'update', target: 'node', backendId: 'n2', payload: { title: 'B' } }),
    ];
    expect(coalesce(q)).toHaveLength(2);
  });
});

describe('sendableLinkOps — no-orphan gating', () => {
  it('withholds a link until both endpoint nodes are known, then emits it', () => {
    const link: QueueOp = base({
      seq: 5,
      opType: 'create',
      target: 'link',
      payload: { sourceRef: 'a', targetRef: 'b' },
    });

    // Only one endpoint known → withheld.
    expect(sendableLinkOps([link], new Set(['a']))).toEqual([]);
    // Both endpoints known → emitted.
    const out = sendableLinkOps([link], new Set(['a', 'b']));
    expect(out).toHaveLength(1);
    expect(out[0].seq).toBe(5);
  });
});

describe('resolveConflict — last-write-wins by updatedAt', () => {
  it('backend strictly newer than base → backend wins', () => {
    expect(resolveConflict('2025-01-01T00:00:00Z', '2025-01-02T00:00:00Z')).toBe('backend');
  });

  it('equal or older backend → local wins', () => {
    expect(resolveConflict('2025-01-02T00:00:00Z', '2025-01-02T00:00:00Z')).toBe('local');
    expect(resolveConflict('2025-01-02T00:00:00Z', '2025-01-01T00:00:00Z')).toBe('local');
  });

  it('missing base or backend timestamp → local wins', () => {
    expect(resolveConflict(undefined, '2025-01-02T00:00:00Z')).toBe('local');
    expect(resolveConflict('2025-01-02T00:00:00Z', undefined)).toBe('local');
  });
});
