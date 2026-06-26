import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  parseUniverseResponse,
  adaptUniverse,
  buildUniverseSeed,
  UNIVERSE_NODE_CAP,
  type RawUniverse,
} from './universe-adapter';

const NOW = '2026-01-01T00:00:00.000Z';

/** A small realistic universe mirroring GET /api/dochub/graph. */
function sampleResponse() {
  return {
    success: true,
    data: {
      nodes: [
        { id: 'core', name: 'AI Knowledge', color: '#7c4dff', type: 'core', group: 'core' },
        { id: 'ai-agent', name: 'AI Agent', color: '#5ca7ff', type: 'topic', group: 'ai-agent', topicId: 'ai-agent' },
        { id: 'ai-agent--Multi-Agent', name: 'Multi-Agent', type: 'child', group: 'ai-agent', topicId: 'ai-agent' },
        { id: 'cnode--x1', name: 'Some article', type: 'article', group: 'ai-agent', topicId: 'ai-agent' },
      ],
      links: [
        { source: 'core', target: 'ai-agent', type: 'core-topic' },
        { source: 'ai-agent', target: 'ai-agent--Multi-Agent', type: 'topic-child' },
        { source: 'ai-agent', target: 'cnode--x1', type: 'child-article' },
        { source: 'ai-agent', target: 'missing-node', type: 'child-article' }, // dangling
      ],
    },
  };
}

describe('parseUniverseResponse', () => {
  it('unwraps { success, data } and keeps only valid nodes/links', () => {
    const parsed = parseUniverseResponse(sampleResponse());
    expect(parsed).not.toBeNull();
    expect(parsed!.nodes).toHaveLength(4);
    expect(parsed!.links).toHaveLength(4);
  });

  it('accepts a bare { nodes, links } object', () => {
    const parsed = parseUniverseResponse({ nodes: [{ id: 'a' }], links: [] });
    expect(parsed?.nodes).toHaveLength(1);
  });

  it('returns null for unusable shapes and empty node lists', () => {
    expect(parseUniverseResponse(null)).toBeNull();
    expect(parseUniverseResponse('nope')).toBeNull();
    expect(parseUniverseResponse({ data: { nodes: [], links: [] } })).toBeNull();
    expect(parseUniverseResponse({ data: { nodes: [{ noId: true }], links: [] } })).toBeNull();
  });

  it('ignores a link missing source or target', () => {
    const parsed = parseUniverseResponse({ nodes: [{ id: 'a' }], links: [{ source: 'a' }] });
    expect(parsed?.links).toHaveLength(0);
  });

  it('does not read inherited (prototype-chain) keys', () => {
    const proto = { id: 'evil' };
    const node = Object.create(proto) as Record<string, unknown>;
    const parsed = parseUniverseResponse({ nodes: [node], links: [] });
    // `id` is inherited, not own → node dropped → no usable nodes → null.
    expect(parsed).toBeNull();
  });
});

describe('adaptUniverse', () => {
  it('maps web types to workspace visual types and marks every node as a seed', () => {
    const { nodes } = adaptUniverse(parseUniverseResponse(sampleResponse())!, NOW);
    const byId = new Map(nodes.map((n) => [n.id, n]));
    expect(byId.get('core')!.nodeType).toBe('root');
    expect(byId.get('ai-agent')!.nodeType).toBe('insight');
    expect(byId.get('ai-agent--Multi-Agent')!.nodeType).toBe('question');
    expect(byId.get('cnode--x1')!.nodeType).toBe('artifact');
    for (const n of nodes) {
      expect((n.metadata as Record<string, unknown>).seed).toBe(true);
      expect((n.metadata as Record<string, unknown>).universeId).toBe(n.id);
    }
  });

  it('drops dangling links (no-orphan): every link endpoint resolves to a node', () => {
    const { nodes, links } = adaptUniverse(parseUniverseResponse(sampleResponse())!, NOW);
    const ids = new Set(nodes.map((n) => n.id));
    expect(links.length).toBe(3); // the 'missing-node' link is removed
    for (const l of links) {
      expect(ids.has(l.sourceId)).toBe(true);
      expect(ids.has(l.targetId)).toBe(true);
    }
  });

  it('is deterministic: identical input → identical positions', () => {
    const parsed = parseUniverseResponse(sampleResponse())!;
    const a = adaptUniverse(parsed, NOW);
    const b = adaptUniverse(parsed, NOW);
    expect(a.nodes.map((n) => [n.id, n.x, n.y])).toEqual(b.nodes.map((n) => [n.id, n.x, n.y]));
  });

  it('caps node count, keeping core/topic/child before articles', () => {
    const nodes = [
      { id: 'core', type: 'core' },
      { id: 't1', type: 'topic' },
      ...Array.from({ length: UNIVERSE_NODE_CAP + 50 }, (_, i) => ({
        id: `a${i}`,
        type: 'article',
        group: 't1',
      })),
    ];
    const raw: RawUniverse = { nodes, links: [] };
    const { nodes: out } = adaptUniverse(raw, NOW);
    expect(out.length).toBe(UNIVERSE_NODE_CAP);
    expect(out.some((n) => n.id === 'core')).toBe(true);
    expect(out.some((n) => n.id === 't1')).toBe(true);
  });

  it('falls back to the id when a node has no name, and to a default colour', () => {
    const { nodes } = adaptUniverse({ nodes: [{ id: 'x', type: 'article' }], links: [] }, NOW);
    expect(nodes[0].title).toBe('x');
    expect(nodes[0].color).toBe('#5ca7ff');
  });
});

describe('buildUniverseSeed', () => {
  it('parses + adapts in one call', () => {
    const { nodes, links } = buildUniverseSeed(sampleResponse(), NOW);
    expect(nodes).toHaveLength(4);
    expect(links).toHaveLength(3);
  });

  it('returns an empty graph for bad input (never throws)', () => {
    expect(buildUniverseSeed(null)).toEqual({ nodes: [], links: [] });
    expect(buildUniverseSeed({ data: { nodes: [], links: [] } })).toEqual({ nodes: [], links: [] });
  });

  it('property: output never contains a dangling link', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.string({ minLength: 1, maxLength: 8 }),
            type: fc.constantFrom('core', 'topic', 'child', 'article'),
            group: fc.string({ maxLength: 4 }),
          }),
          { maxLength: 30 },
        ),
        fc.array(
          fc.record({
            source: fc.string({ minLength: 1, maxLength: 8 }),
            target: fc.string({ minLength: 1, maxLength: 8 }),
          }),
          { maxLength: 30 },
        ),
        (nodes, links) => {
          const { nodes: outNodes, links: outLinks } = adaptUniverse({ nodes, links }, NOW);
          const ids = new Set(outNodes.map((n) => n.id));
          for (const l of outLinks) {
            expect(ids.has(l.sourceId) && ids.has(l.targetId)).toBe(true);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
