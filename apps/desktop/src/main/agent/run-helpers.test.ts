// Feature: agent-company Phase 1 (Run store). Pure sanitation must keep the storage
// backbone clean: whitelisted kinds, bounded + trimmed content, guaranteed provenance
// shape, and never an empty/orphan entry.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  RUN_ENTRY_KINDS,
  isRunEntryKind,
  isRunStatus,
  sanitizeGoal,
  sanitizeRunEntry,
} from './run-helpers';

describe('run-helpers.sanitizeRunEntry', () => {
  it('Property 1: result kind is always a whitelisted kind', () => {
    fc.assert(
      fc.property(fc.record({ runId: fc.string({ minLength: 1 }), kind: fc.anything(), content: fc.string({ minLength: 1 }) }), (raw) => {
        const out = sanitizeRunEntry({ ...raw, content: `x${raw.content}` });
        if (out) expect(RUN_ENTRY_KINDS).toContain(out.kind);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 2: content is trimmed, non-empty and bounded (<= 8000)', () => {
    fc.assert(
      fc.property(fc.string(), (content) => {
        const out = sanitizeRunEntry({ runId: 'run-1', content });
        if (out) {
          expect(out.content.length).toBeGreaterThan(0);
          expect(out.content.length).toBeLessThanOrEqual(8000);
          expect(out.content).toBe(out.content.trim());
        }
      }),
      { numRuns: 100 },
    );
  });

  it('Property 3: returns null iff runId or content is empty (no orphan/empty entries)', () => {
    fc.assert(
      fc.property(fc.string(), fc.string(), (runId, content) => {
        const out = sanitizeRunEntry({ runId, content });
        const expectNull = runId.trim() === '' || content.trim() === '';
        expect(out === null).toBe(expectNull);
      }),
      { numRuns: 100 },
    );
  });

  it('Property 4: provenance fields are string|undefined, never other types', () => {
    fc.assert(
      fc.property(fc.record({ stage: fc.anything(), agentId: fc.anything() }), (p) => {
        const out = sanitizeRunEntry({ runId: 'run-1', content: 'hello', ...p });
        if (out) {
          expect(['string', 'undefined']).toContain(typeof out.stage);
          expect(['string', 'undefined']).toContain(typeof out.agentId);
        }
      }),
      { numRuns: 100 },
    );
  });
});

describe('run-helpers guards + goal', () => {
  it('sanitizeGoal trims and clamps to <= 500', () => {
    fc.assert(
      fc.property(fc.string(), (g) => {
        const out = sanitizeGoal(g);
        expect(out.length).toBeLessThanOrEqual(500);
        expect(out).toBe(out.trim());
      }),
      { numRuns: 100 },
    );
  });

  it('isRunEntryKind / isRunStatus only accept whitelisted values', () => {
    expect(isRunEntryKind('artifact')).toBe(true);
    expect(isRunEntryKind('nope')).toBe(false);
    expect(isRunEntryKind(42)).toBe(false);
    expect(isRunStatus('active')).toBe(true);
    expect(isRunStatus('running')).toBe(false);
  });
});
