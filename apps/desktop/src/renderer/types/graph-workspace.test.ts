// Feature: ai-branching-graph-workspace (decision B — shared graph model).
// Unit tests for the PURE adapters over GraphNode + the branch-create payload.

import { describe, it, expect } from 'vitest';
import type { GraphNode } from '../../shared/graph-types';
import {
  coerceNodeType,
  nodeViewType,
  nodeSummary,
  nodeTags,
  nodeProvenance,
  dedupeTags,
  branchCreateInput,
  parseCommand,
  NODE_TYPE_COLORS,
} from './graph-workspace';

function node(over: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'n1',
    title: 'Node',
    nodeType: 'session',
    color: '#22dcc2',
    x: 100,
    y: 50,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...over,
  };
}

describe('coerceNodeType', () => {
  it('passes valid workspace types through', () => {
    for (const t of ['root', 'session', 'question', 'insight', 'task', 'artifact'] as const) {
      expect(coerceNodeType(t)).toBe(t);
    }
  });
  it('defaults unknown/odd values to session', () => {
    expect(coerceNodeType('note')).toBe('session');
    expect(coerceNodeType('')).toBe('session');
    expect(coerceNodeType(undefined)).toBe('session');
    expect(coerceNodeType(42)).toBe('session');
  });
  it('nodeViewType reads from node.nodeType', () => {
    expect(nodeViewType(node({ nodeType: 'task' }))).toBe('task');
    expect(nodeViewType(node({ nodeType: 'whatever' }))).toBe('session');
  });
});

describe('metadata accessors (own-property only)', () => {
  it('reads summary / tags / provenance from metadata', () => {
    const n = node({
      metadata: {
        summary: 'a summary',
        tags: ['x', 'y'],
        provenance: { parentId: 'p1', sourceMessageId: 'm1', agent: 'izzi', createdAt: '2025-01-02T00:00:00Z' },
      },
    });
    expect(nodeSummary(n)).toBe('a summary');
    expect(nodeTags(n)).toEqual(['x', 'y']);
    expect(nodeProvenance(n)).toEqual({
      parentId: 'p1',
      sourceMessageId: 'm1',
      agent: 'izzi',
      createdAt: '2025-01-02T00:00:00Z',
    });
  });
  it('returns safe defaults when metadata is missing/odd', () => {
    expect(nodeSummary(node({ metadata: undefined }))).toBe('');
    expect(nodeTags(node({ metadata: undefined }))).toEqual([]);
    expect(nodeProvenance(node({ metadata: undefined }))).toBeNull();
    // odd shapes
    expect(nodeTags(node({ metadata: { tags: 'not-an-array' } as unknown as Record<string, unknown> }))).toEqual([]);
    expect(nodeProvenance(node({ metadata: { provenance: 'x' } as unknown as Record<string, unknown> }))).toBeNull();
  });
  it('filters non-string tags', () => {
    const n = node({ metadata: { tags: ['ok', 1, null, 'two'] as unknown as string[] } });
    expect(nodeTags(n)).toEqual(['ok', 'two']);
  });
  it('does not read inherited (prototype) metadata keys', () => {
    const polluted = JSON.parse('{"summary":"real","__proto__":{"tags":["evil"]}}');
    const n = node({ metadata: polluted });
    expect(nodeSummary(n)).toBe('real');
    expect(nodeTags(n)).toEqual([]); // inherited tags must NOT leak
  });
});

describe('dedupeTags', () => {
  it('lowercases, dedupes, drops empties', () => {
    expect(dedupeTags(['A', 'a', ' B ', '', 'b', 'C'])).toEqual(['a', 'b', 'c']);
  });
});

describe('branchCreateInput', () => {
  const parent = node({ id: 'parent', x: 200, y: 100 });

  it('builds a create payload with provenance, type→color, and offset position', () => {
    const out = branchCreateInput(parent, { title: '  Explore X  ', nodeType: 'question', tags: ['A', 'a'] }, 0, '2025-03-03T00:00:00Z');
    expect(out.title).toBe('Explore X');
    expect(out.nodeType).toBe('question');
    expect(out.color).toBe(NODE_TYPE_COLORS.question);
    expect(out.x).toBe(480); // parent.x + 280
    const meta = out.metadata as { summary: string; tags: string[]; provenance: Record<string, unknown> };
    expect(meta.tags).toEqual(['a']);
    expect(meta.provenance).toEqual({
      parentId: 'parent',
      sourceMessageId: null,
      agent: null,
      createdAt: '2025-03-03T00:00:00Z',
    });
  });

  it('defaults type to question and title to a fallback', () => {
    const out = branchCreateInput(parent, { title: '   ' }, 0);
    expect(out.title).toBe('Nhánh mới');
    expect(out.nodeType).toBe('question');
  });

  it('only sets content when a body is provided', () => {
    expect(branchCreateInput(parent, { title: 'T' }, 0).content).toBeUndefined();
    expect(branchCreateInput(parent, { title: 'T', body: 'note' }, 0).content).toBe('note');
  });

  it('spreads siblings vertically (different y per sibling index)', () => {
    const y0 = branchCreateInput(parent, { title: 'a' }, 0).y;
    const y1 = branchCreateInput(parent, { title: 'b' }, 1).y;
    const y2 = branchCreateInput(parent, { title: 'c' }, 2).y;
    expect(new Set([y0, y1, y2]).size).toBe(3);
  });

  it('carries sourceMessageId + agent into provenance', () => {
    const out = branchCreateInput(parent, { title: 'T', sourceMessageId: 'msg-9', agent: 'izzi' }, 0);
    const meta = out.metadata as { provenance: { sourceMessageId: string; agent: string } };
    expect(meta.provenance.sourceMessageId).toBe('msg-9');
    expect(meta.provenance.agent).toBe('izzi');
  });
});

describe('parseCommand', () => {
  it('parses /branch /summarize /merge with args, case-insensitive', () => {
    expect(parseCommand('/branch idea here')).toEqual({ command: 'branch', arg: 'idea here' });
    expect(parseCommand('/SUMMARIZE')).toEqual({ command: 'summarize', arg: '' });
    expect(parseCommand('  /merge into parent ')).toEqual({ command: 'merge', arg: 'into parent' });
  });
  it('treats non-command text as a normal message', () => {
    expect(parseCommand('hello world')).toEqual({ command: null, arg: 'hello world' });
    expect(parseCommand('/unknown x')).toEqual({ command: null, arg: '/unknown x' });
  });
});
