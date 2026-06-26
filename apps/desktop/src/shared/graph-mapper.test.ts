// Feature: desktop-graph-backend-sync, Property 1: node mapping round-trip
// preserves the writable ("kept") fields and emits only whitelist keys, using
// own-property access (no prototype-chain).
//
// Validates: Requirements 1.2, 1.3, 2.3, 11.1, 11.5

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import { userNodeToModel, modelToPatchPayload } from './graph-mapper';

/** Keys the PATCH payload is allowed to contain (NodePatchPayload). */
const PATCH_WHITELIST = [
  'title',
  'nodeType',
  'color',
  'content',
  'url',
  'x',
  'y',
  'topicId',
  'isPublic',
  'metadata',
] as const;

/**
 * The "kept" fields preserved through read -> patch -> rebuild. This is the
 * intersection of the model and the patch whitelist, excluding patch-only
 * `isPublic` (absent from the read model) and server-owned fields.
 */
const PRESERVED_FIELDS = [
  'title',
  'nodeType',
  'color',
  'content',
  'url',
  'x',
  'y',
  'topicId',
  'metadata',
] as const;

/** Pick only the present (own, non-undefined) preserved fields from an object. */
function preserved(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PRESERVED_FIELDS) {
    if (Object.hasOwn(obj, key) && obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

/**
 * Generator for a valid `UserNode` JSON object: required id/title/nodeType/color/
 * timestamps, plus optional content/url/topicId/x/y/metadata. Strings use the
 * default unicode unit; x/y are finite numbers; metadata is an object.
 */
const userNodeJsonArb = fc.record(
  {
    id: fc.string({ minLength: 1 }),
    title: fc.string({ minLength: 1 }),
    nodeType: fc.string(),
    color: fc.string(),
    createdAt: fc.string(),
    updatedAt: fc.string(),
    content: fc.string(),
    url: fc.string(),
    topicId: fc.string(),
    x: fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }),
    y: fc.double({ min: -1_000_000, max: 1_000_000, noNaN: true }),
    metadata: fc.dictionary(
      fc.string(),
      fc.oneof(fc.string(), fc.integer(), fc.boolean()),
    ),
  },
  { requiredKeys: ['id', 'title', 'nodeType', 'color', 'createdAt', 'updatedAt'] },
);

describe('Property 1: node mapping round-trip (graph-mapper)', () => {
  it('preserves kept fields and emits only whitelist keys for valid node JSON', () => {
    fc.assert(
      fc.property(userNodeJsonArb, (json) => {
        const model = userNodeToModel(json);
        // Valid JSON (id + title present strings) always maps to a model.
        expect(model).not.toBeNull();

        const payload = modelToPatchPayload(model!);

        // Payload contains ONLY whitelist keys.
        for (const key of Object.keys(payload)) {
          expect(PATCH_WHITELIST).toContain(key);
        }

        // Rebuild a model by applying the patch payload onto a fresh object,
        // then assert the kept fields are equivalent across the round-trip.
        const rebuilt = { ...payload } as Record<string, unknown>;
        expect(preserved(rebuilt)).toEqual(
          preserved(model as unknown as Record<string, unknown>),
        );
      }),
      { numRuns: 100 },
    );
  });

  it('uses own-property access on prototype-polluted input', () => {
    // JSON.parse creates an OWN "__proto__" data property (it does not mutate
    // the prototype). A prototype-chain reader would leak the injected value.
    const polluted = JSON.parse(
      '{"id":"n1","title":"hello","nodeType":"note","color":"#fff","__proto__":{"injected":"evil"}}',
    );

    const model = userNodeToModel(polluted);
    expect(model).not.toBeNull();
    expect(model!.id).toBe('n1');
    expect(model!.title).toBe('hello');
    expect(model!.nodeType).toBe('note');

    const payload = modelToPatchPayload(model!) as Record<string, unknown>;

    // No prototype pollution leaked into the model or payload.
    expect(Object.hasOwn(payload, '__proto__')).toBe(false);
    expect(payload.injected).toBeUndefined();
    // Global Object.prototype was not polluted.
    expect((({}) as Record<string, unknown>).injected).toBeUndefined();

    // Payload still contains only whitelist keys.
    for (const key of Object.keys(payload)) {
      expect(PATCH_WHITELIST).toContain(key);
    }
  });
});
