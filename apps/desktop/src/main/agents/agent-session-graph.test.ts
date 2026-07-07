import { describe, it, expect, vi } from 'vitest';
import {
  buildSessionNode,
  hubTitle,
  AgentSessionCapturer,
  type GraphWriter,
} from './agent-session-graph';

describe('buildSessionNode', () => {
  it('builds a titled note with agent-session metadata (no tags field)', () => {
    const node = buildSessionNode({
      agentId: 'hermes',
      agentName: 'Hermes Agent',
      model: 'hermes',
      reasoningEffort: 'xhigh',
      request: 'Đăng bài lên page\nchi tiết',
      reply: 'Đã lên lịch',
      steps: [{ id: 's', kind: 'tool', label: 'postNow', status: 'done' }],
      startedAt: 'A',
      finishedAt: 'B',
    });
    expect(node.title).toContain('Hermes Agent');
    expect(node.nodeType).toBe('note');
    expect((node.metadata as Record<string, unknown>).kind).toBe('agent-session');
    expect((node.metadata as Record<string, unknown>).agentId).toBe('hermes');
    expect(node.content).toContain('Đăng bài lên page');
    expect(node.content).toContain('Đã lên lịch');
    expect(node.content).toContain('postNow');
    expect(node).not.toHaveProperty('tags'); // backend node model has no tags
  });

  it('clips an overly long title', () => {
    const node = buildSessionNode({
      agentId: 'a',
      agentName: 'A',
      request: 'x'.repeat(300),
      reply: 'r',
      startedAt: '',
      finishedAt: '',
    });
    expect(node.title.length).toBeLessThanOrEqual(81);
  });
});

type SpyWriter = GraphWriter & { created: Array<{ title: string }>; links: Array<{ s: string; t: string }> };

function fakeWriter(overrides: Partial<GraphWriter> = {}): SpyWriter {
  const created: Array<{ title: string }> = [];
  const links: Array<{ s: string; t: string }> = [];
  return {
    created,
    links,
    searchNodes: overrides.searchNodes ?? (async () => []),
    createNode:
      overrides.createNode ??
      (async (input) => {
        const node = { id: `id-${created.length}`, ...input } as never;
        created.push(input as { title: string });
        return node;
      }),
    createLink:
      overrides.createLink ??
      (async (s, t) => {
        links.push({ s, t });
        return { id: 'l', sourceId: s, targetId: t } as never;
      }),
  };
}

describe('AgentSessionCapturer', () => {
  it('creates a hub + session node and links them (no orphan)', async () => {
    const w = fakeWriter();
    const cap = new AgentSessionCapturer(w);
    const r = await cap.capture({
      agentId: 'hermes',
      agentName: 'Hermes',
      request: 'q',
      reply: 'a',
      startedAt: '',
      finishedAt: '',
    });
    expect(r.ok).toBe(true);
    expect(w.created).toHaveLength(2); // hub + session
    expect(w.links).toHaveLength(1); // hub → session
    expect(w.links[0].t).toBe(r.nodeId);
  });

  it('reuses an existing hub via search and caches it across turns', async () => {
    const searchNodes = vi.fn(async (q: string) =>
      q === hubTitle('Hermes') ? ([{ id: 'hub-1', title: hubTitle('Hermes') }] as never) : ([] as never),
    );
    const w = fakeWriter({ searchNodes });
    const cap = new AgentSessionCapturer(w);
    await cap.capture({ agentId: 'hermes', agentName: 'Hermes', request: 'q1', reply: 'a', startedAt: '', finishedAt: '' });
    await cap.capture({ agentId: 'hermes', agentName: 'Hermes', request: 'q2', reply: 'a', startedAt: '', finishedAt: '' });
    expect(searchNodes).toHaveBeenCalledTimes(1); // cached after first lookup
    expect(w.created).toHaveLength(2); // two sessions, hub reused (not created)
    expect(w.links).toHaveLength(2);
  });

  it('fails closed when createNode returns an error (logged out)', async () => {
    const w = fakeWriter({
      searchNodes: async () => [] as never,
      createNode: async () => ({ error: 'unauthorized' }) as never,
    });
    const cap = new AgentSessionCapturer(w);
    const r = await cap.capture({ agentId: 'a', agentName: 'A', request: 'q', reply: 'a', startedAt: '', finishedAt: '' });
    expect(r.ok).toBe(false);
    expect(w.links).toHaveLength(0);
  });

  it('never throws even if the writer throws', async () => {
    const w = fakeWriter({
      searchNodes: async () => {
        throw new Error('net');
      },
      createNode: async () => {
        throw new Error('net');
      },
    });
    const cap = new AgentSessionCapturer(w);
    const r = await cap.capture({ agentId: 'a', agentName: 'A', request: 'q', reply: 'a', startedAt: '', finishedAt: '' });
    expect(r.ok).toBe(false);
  });
});
