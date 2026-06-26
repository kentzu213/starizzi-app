import { describe, expect, it } from 'vitest';
import { normalizeMemoryItems, type MemoryItem } from './agent-memory';

/**
 * Feature: agent-workspace-redesign (Phase 3)
 * Validates: Requirements 10.4 (no-orphan read — items without source are filtered out)
 */

describe('normalizeMemoryItems (Req 10.4)', () => {
  it('valid items pass through unchanged', () => {
    const input = [
      { id: 'a1', title: 'Note 1', source: 'obsidian', createdAt: '2025-01-01' },
      { id: 'a2', title: 'Note 2', source: 'graphRAG', createdAt: '2025-01-02' },
    ];
    const result = normalizeMemoryItems(input);
    expect(result).toEqual([
      { id: 'a1', title: 'Note 1', source: 'obsidian', createdAt: '2025-01-01' },
      { id: 'a2', title: 'Note 2', source: 'graphRAG', createdAt: '2025-01-02' },
    ]);
  });

  it('filters out items missing `source` (no-orphan read — Req 10.4)', () => {
    const input = [
      { id: 'a1', title: 'Has source', source: 'vault', createdAt: '2025-01-01' },
      { id: 'a2', title: 'No source', createdAt: '2025-01-01' }, // missing source
    ];
    const result = normalizeMemoryItems(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('filters out items with empty string `source`', () => {
    const input = [
      { id: 'a1', title: 'Empty source', source: '', createdAt: '2025-01-01' },
      { id: 'a2', title: 'Valid', source: 'kb', createdAt: '2025-01-02' },
    ];
    const result = normalizeMemoryItems(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a2');
  });

  it('filters out items with non-string fields', () => {
    const input = [
      { id: 123, title: 'Num id', source: 'x', createdAt: '2025-01-01' }, // id not string
      { id: 'a1', title: null, source: 'x', createdAt: '2025-01-01' }, // title not string
      { id: 'a1', title: 'OK', source: 42, createdAt: '2025-01-01' }, // source not string
      { id: 'a1', title: 'OK', source: 'x', createdAt: true }, // createdAt not string
      { id: 'a1', title: 'Valid', source: 'real', createdAt: '2025-01-01' }, // valid
    ];
    const result = normalizeMemoryItems(input);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
    expect(result[0].source).toBe('real');
  });

  it('skips null/undefined/primitive items in the array', () => {
    const input = [
      null,
      undefined,
      42,
      'hello',
      true,
      { id: 'a1', title: 'Valid', source: 'src', createdAt: '2025-01-01' },
    ];
    const result = normalizeMemoryItems(input as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('skips array items', () => {
    const input = [
      ['not', 'an', 'object'],
      { id: 'a1', title: 'Valid', source: 'src', createdAt: '2025-01-01' },
    ];
    const result = normalizeMemoryItems(input as unknown[]);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a1');
  });

  it('filters out items with prototype-chain properties (not own) — security', () => {
    const proto = { source: 'inherited-source' };
    const item = Object.create(proto);
    item.id = 'a1';
    item.title = 'Proto test';
    item.createdAt = '2025-01-01';
    // `source` is on prototype, NOT own property

    const input = [item];
    const result = normalizeMemoryItems(input);
    expect(result).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    const result = normalizeMemoryItems([]);
    expect(result).toEqual([]);
  });

  it('does not fabricate data — output is always a subset of input', () => {
    const input = [
      { id: 'a1', title: 'One', source: 'vault', createdAt: '2025-01-01' },
      { id: 'a2', title: 'Two', source: 'graph', createdAt: '2025-01-02' },
      { id: 'a3', title: 'Three', source: '', createdAt: '2025-01-03' }, // filtered
    ];
    const result = normalizeMemoryItems(input);

    // Every output item must correspond to an input item (same field values)
    for (const out of result) {
      const match = input.find(
        (inp) =>
          typeof inp === 'object' &&
          inp !== null &&
          'id' in inp &&
          inp.id === out.id &&
          'title' in inp &&
          inp.title === out.title &&
          'source' in inp &&
          inp.source === out.source &&
          'createdAt' in inp &&
          inp.createdAt === out.createdAt,
      );
      expect(match).toBeDefined();
    }

    // Output length must be <= input length
    expect(result.length).toBeLessThanOrEqual(input.length);
  });

  it('does not mutate input', () => {
    const item = { id: 'a1', title: 'Test', source: 'vault', createdAt: '2025-01-01' };
    const input = [item];
    const inputBefore = JSON.stringify(input);

    normalizeMemoryItems(input);

    expect(JSON.stringify(input)).toBe(inputBefore);
  });
});
