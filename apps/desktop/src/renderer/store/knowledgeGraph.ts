import { create } from 'zustand';
import type { GraphNode, GraphLink } from '../../shared/graph-types';

/**
 * Knowledge/Graph write store — the renderer-side state for the Knowledge/Graph
 * surface, wired to the shared backend through the `electronAPI.graph` IPC
 * bridge. The backend is the single source of truth: after every accepted write
 * the store re-reads via `refresh()` so the local state mirrors what was saved
 * (Req 3.1, 3.2, 3.3).
 *
 * Mirrors the conventions of `agentWorkspace.ts`: a single zustand store with
 * state + async actions, feature-detecting `window.electronAPI?.graph` and
 * no-op'ing when the bridge is absent (Req 10.1). The JWT never reaches the
 * renderer — all HTTP happens in the main process behind the IPC bridge.
 *
 * @module renderer/store/knowledgeGraph
 * @see Requirements 3.1, 3.2, 3.3, 3.4, 9.3, 10.1
 */

/** Create input for a new node — the writable node fields plus a required title. */
export type NodeCreateInput = Partial<GraphNode> & { title: string };

/** Patch input for an existing node — the writable fields plus patch-only `isPublic`. */
export type NodePatchInput = Partial<GraphNode> & { isPublic?: boolean };

type GraphStatus = 'idle' | 'loading' | 'ready' | 'empty';

interface KnowledgeGraphState {
  nodes: GraphNode[];
  links: GraphLink[];
  status: GraphStatus;
  refresh: () => Promise<void>;
  createNode: (input: NodeCreateInput) => Promise<GraphNode | null>;
  updateNode: (id: string, patch: NodePatchInput) => Promise<boolean>;
  removeNode: (id: string) => Promise<boolean>;
}

/** Insert or replace a node by id (newest-first on insert), mirroring `agentWorkspace` `upsertById`. */
function upsertNode(nodes: GraphNode[], next: GraphNode): GraphNode[] {
  const existingIndex = nodes.findIndex((node) => node.id === next.id);
  if (existingIndex === -1) {
    return [next, ...nodes];
  }
  const nextNodes = [...nodes];
  nextNodes[existingIndex] = next;
  return nextNodes;
}

/**
 * Own-property guard: a create response is a GraphNode (success) rather than an
 * `{ error }`. Uses `Object.hasOwn` only — never the prototype chain (Req 9.3).
 */
function isGraphNodeResult(result: unknown): result is GraphNode {
  return (
    result !== null &&
    typeof result === 'object' &&
    !Object.hasOwn(result, 'error') &&
    Object.hasOwn(result, 'id')
  );
}

/**
 * Own-property guard: a write response confirms success with `{ ok: true }`.
 * Uses `Object.hasOwn` only — never the prototype chain (Req 9.3).
 */
function isOkResult(result: unknown): result is { ok: true } {
  if (result === null || typeof result !== 'object' || !Object.hasOwn(result, 'ok')) {
    return false;
  }
  return (result as { ok?: unknown }).ok === true;
}

export const useKnowledgeGraphStore = create<KnowledgeGraphState>((set, get) => ({
  nodes: [],
  links: [],
  status: 'idle',

  refresh: async () => {
    const graph = window.electronAPI?.graph;
    if (!graph) {
      // Bridge absent → keep the read-only empty state (Req 10.1).
      set({ nodes: [], links: [], status: 'empty' });
      return;
    }

    set({ status: 'loading' });
    const [nodes, links] = await Promise.all([graph.list(), graph.links()]);
    const safeNodes = Array.isArray(nodes) ? nodes : [];
    const safeLinks = Array.isArray(links) ? links : [];
    set({
      nodes: safeNodes,
      links: safeLinks,
      status: safeNodes.length > 0 ? 'ready' : 'empty',
    });
  },

  createNode: async (input) => {
    const graph = window.electronAPI?.graph;
    if (!graph) return null; // no write surface without the bridge (Req 10.1)

    const result = await graph.create(input);
    if (isGraphNodeResult(result)) {
      // Update state FROM the backend response (real id), not a client guess (Req 3.1)…
      set((state) => ({ nodes: upsertNode(state.nodes, result) }));
      // …then re-read the source of truth so state mirrors what was saved (Req 3.3).
      await get().refresh();
      return result;
    }
    // Rejected → keep state consistent; do not surface a failed write as success (Req 3.4).
    return null;
  },

  updateNode: async (id, patch) => {
    const graph = window.electronAPI?.graph;
    if (!graph) return false; // no write surface without the bridge (Req 10.1)

    const result = await graph.update(id, patch);
    if (isOkResult(result)) {
      await get().refresh(); // re-read the source of truth (Req 3.3)
      return true;
    }
    return false; // rejected → state unchanged (Req 3.4)
  },

  removeNode: async (id) => {
    const graph = window.electronAPI?.graph;
    if (!graph) return false; // no write surface without the bridge (Req 10.1)

    const result = await graph.remove(id);
    if (isOkResult(result)) {
      await get().refresh(); // re-read the source of truth (Req 3.3)
      return true;
    }
    return false; // rejected → state unchanged (Req 3.4)
  },
}));
