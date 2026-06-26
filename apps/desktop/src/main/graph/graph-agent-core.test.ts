import { describe, it, expect } from 'vitest';
import type { GraphNode } from '../../shared/graph-types';
import {
  parseClassification,
  buildContextBlock,
  buildChatMessages,
  buildClassifierMessages,
} from './graph-agent-core';

/**
 * Feature: ai-branching-graph-workspace — graph agent core (pure).
 * Classifier output is untrusted: enum-validated, confidence-clamped, parentNodeId
 * is always the trusted caller's, never the model's.
 */

function node(over: Partial<GraphNode> = {}): GraphNode {
  return {
    id: 'n1',
    title: 'Root',
    nodeType: 'root',
    color: '#67e8f9',
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    ...over,
  };
}

describe('parseClassification', () => {
  it('parses a valid JSON object and uses the caller parentNodeId', () => {
    const raw =
      '{"shouldCreateBranch":true,"parentNodeId":"HACKER","title":"Sub-topic","summary":"s","nodeType":"task","reason":"r","tags":["a","b"],"confidence":0.82}';
    const out = parseClassification(raw, 'real-parent');
    expect(out).not.toBeNull();
    expect(out!.parentNodeId).toBe('real-parent'); // model value ignored
    expect(out!.nodeType).toBe('task');
    expect(out!.confidence).toBeCloseTo(0.82);
    expect(out!.tags).toEqual(['a', 'b']);
    expect(out!.shouldCreateBranch).toBe(true);
  });

  it('extracts JSON embedded in surrounding prose', () => {
    const raw = 'Sure! Here is the analysis:\n{"shouldCreateBranch":true,"title":"X","nodeType":"question","confidence":0.7} done';
    expect(parseClassification(raw, 'p')!.title).toBe('X');
  });

  it('defaults an invalid nodeType to question and clamps confidence', () => {
    const out = parseClassification('{"title":"T","nodeType":"bogus","confidence":5}', 'p');
    expect(out!.nodeType).toBe('question');
    expect(out!.confidence).toBe(1);
    const out2 = parseClassification('{"title":"T","confidence":-3}', 'p');
    expect(out2!.confidence).toBe(0);
  });

  it('treats shouldCreateBranch as true only when strictly true', () => {
    expect(parseClassification('{"title":"T","shouldCreateBranch":"yes"}', 'p')!.shouldCreateBranch).toBe(false);
    expect(parseClassification('{"title":"T","shouldCreateBranch":true}', 'p')!.shouldCreateBranch).toBe(true);
  });

  it('filters non-string tags', () => {
    expect(parseClassification('{"title":"T","tags":["ok",1,null,"two"]}', 'p')!.tags).toEqual(['ok', 'two']);
  });

  it('returns null on empty title, non-JSON, or non-object', () => {
    expect(parseClassification('{"title":"   "}', 'p')).toBeNull();
    expect(parseClassification('not json at all', 'p')).toBeNull();
    expect(parseClassification('[1,2,3]', 'p')).toBeNull();
    expect(parseClassification('', 'p')).toBeNull();
  });
});

describe('buildContextBlock', () => {
  it('includes ancestor path + current node with metadata summaries', () => {
    const root = node({ id: 'r', title: 'Root', metadata: { summary: 'the root' } });
    const cur = node({ id: 'c', title: 'Current', metadata: { summary: 'here' }, content: 'some notes' });
    const block = buildContextBlock(cur, [root]);
    expect(block).toContain('Ancestor path:');
    expect(block).toContain('Root — the root');
    expect(block).toContain('Current node: Current — here');
    expect(block).toContain('some notes');
  });
});

describe('message builders', () => {
  it('buildChatMessages has system(context)+user', () => {
    const msgs = buildChatMessages(node(), [], 'hello');
    expect(msgs[0].role).toBe('system');
    expect(msgs[1]).toEqual({ role: 'user', content: 'hello' });
  });
  it('buildClassifierMessages embeds user+assistant', () => {
    const msgs = buildClassifierMessages('q', 'a');
    expect(msgs[0].role).toBe('system');
    expect(msgs[1].content).toContain('User: q');
    expect(msgs[1].content).toContain('Assistant: a');
  });
});
