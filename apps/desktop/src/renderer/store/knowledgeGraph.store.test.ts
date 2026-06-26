// Unit tests for the Knowledge/Graph write store. The store talks to the
// backend only through the `window.electronAPI.graph` IPC bridge, so we mock
// that bridge and assert the store mirrors backend responses (Req 3.1, 3.3),
// keeps state on rejection (Req 3.4), and stays empty + no-ops when the bridge
// is absent (Req 6.3, 10.1).
//
// Validates: Requirements 3.1, 3.3, 3.4, 6.3, 10.1

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { useKnowledgeGraphStore } from './knowledgeGraph';
import type { GraphNode, GraphLink } from '../../shared/graph-types';

/** Build a complete backend GraphNode for fixtures. */
function makeNode(overrides: Partial<GraphNode> & { id: string; title: string }): GraphNode {
  return {
    nodeType: 'note',
    color: '#ffffff',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface MockGraphApi {
  list: ReturnType<typeof vi.fn>;
  links: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
}

/** Stub `window.electronAPI` with the given graph bridge (or no graph namespace). */
function installElectronAPI(graph?: MockGraphApi): void {
  vi.stubGlobal('window', { electronAPI: graph ? { graph } : {} });
}

/** A graph bridge whose reads return empty by default; override per test. */
function makeGraphApi(overrides: Partial<MockGraphApi> = {}): MockGraphApi {
  return {
    list: vi.fn().mockResolvedValue([]),
    links: vi.fn().mockResolvedValue([]),
    create: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  // zustand stores are module singletons — reset to initial state per test.
  useKnowledgeGraphStore.setState({ nodes: [], links: [], status: 'idle' });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useKnowledgeGraphStore', () => {
  it('takes the backend-returned id into state on a successful create (Req 3.1)', async () => {
    const created = makeNode({ id: 'srv-1', title: 'Created on server' });
    const graph = makeGraphApi({
      create: vi.fn().mockResolvedValue(created),
      list: vi.fn().mockResolvedValue([created]),
    });
    installElectronAPI(graph);

    // Input carries no id — the store must adopt the backend id, not a client guess.
    const returned = await useKnowledgeGraphStore.getState().createNode({ title: 'Created on server' });

    expect(returned).not.toBeNull();
    expect(returned?.id).toBe('srv-1');
    expect(graph.create).toHaveBeenCalledWith({ title: 'Created on server' });

    const state = useKnowledgeGraphStore.getState();
    expect(state.nodes.map((node) => node.id)).toContain('srv-1');
    expect(state.status).toBe('ready');
  });

  it('populates nodes and links from the mocked list/links on refresh (Req 3.3)', async () => {
    const a = makeNode({ id: 'a', title: 'Alpha' });
    const b = makeNode({ id: 'b', title: 'Beta' });
    const link: GraphLink = { id: 'l1', sourceId: 'a', targetId: 'b' };
    const graph = makeGraphApi({
      list: vi.fn().mockResolvedValue([a, b]),
      links: vi.fn().mockResolvedValue([link]),
    });
    installElectronAPI(graph);

    await useKnowledgeGraphStore.getState().refresh();

    const state = useKnowledgeGraphStore.getState();
    expect(state.nodes).toEqual([a, b]);
    expect(state.links).toEqual([link]);
    expect(state.status).toBe('ready');
  });

  it('leaves state unchanged and returns null when create is rejected (Req 3.4)', async () => {
    const seeded = makeNode({ id: 'existing', title: 'Existing' });
    const graph = makeGraphApi({
      create: vi.fn().mockResolvedValue({ error: 'Title is required' }),
    });
    installElectronAPI(graph);
    useKnowledgeGraphStore.setState({ nodes: [seeded], links: [], status: 'ready' });

    const returned = await useKnowledgeGraphStore.getState().createNode({ title: 'whatever' });

    expect(returned).toBeNull();
    expect(useKnowledgeGraphStore.getState().nodes).toEqual([seeded]);
    // A rejected write must not trigger a refresh (state stays as-is).
    expect(graph.list).not.toHaveBeenCalled();
  });

  it('leaves state unchanged and returns false when update is rejected (Req 3.4)', async () => {
    const seeded = makeNode({ id: 'n1', title: 'Node 1' });
    const graph = makeGraphApi({
      update: vi.fn().mockResolvedValue({ error: 'unauthorized' }),
    });
    installElectronAPI(graph);
    useKnowledgeGraphStore.setState({ nodes: [seeded], links: [], status: 'ready' });

    const ok = await useKnowledgeGraphStore.getState().updateNode('n1', { title: 'changed' });

    expect(ok).toBe(false);
    expect(useKnowledgeGraphStore.getState().nodes).toEqual([seeded]);
    expect(graph.list).not.toHaveBeenCalled();
  });

  it('stays empty and no-ops when the graph bridge is absent (Req 6.3, 10.1)', async () => {
    installElectronAPI(undefined); // electronAPI present, but no `graph` namespace

    await useKnowledgeGraphStore.getState().refresh();
    expect(useKnowledgeGraphStore.getState().nodes).toEqual([]);
    expect(useKnowledgeGraphStore.getState().links).toEqual([]);
    expect(useKnowledgeGraphStore.getState().status).toBe('empty');

    // Write actions are no-ops without the bridge.
    await expect(useKnowledgeGraphStore.getState().createNode({ title: 'x' })).resolves.toBeNull();
    await expect(useKnowledgeGraphStore.getState().updateNode('id', { title: 'x' })).resolves.toBe(false);
    await expect(useKnowledgeGraphStore.getState().removeNode('id')).resolves.toBe(false);

    expect(useKnowledgeGraphStore.getState().nodes).toEqual([]);
  });
});
