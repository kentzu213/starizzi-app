import type { GraphNode, GraphLink, MemoryItemDTO } from '../../shared/graph-types';
import type { BranchClassification } from './graph-workspace';
import type { UniverseNodeDetail } from '../../shared/universe-adapter';

export {};

declare global {
  /** Renderer-facing graph IPC surface — mirrors the preload `graph` namespace (Req 7.1, 7.5). */
  interface ElectronGraphApi {
    list: () => Promise<GraphNode[]>;
    universe: () => Promise<{ nodes: GraphNode[]; links: GraphLink[] }>;
    nodeDetail: (id: string) => Promise<UniverseNodeDetail | null>;
    create: (input: Partial<GraphNode> & { title: string }) => Promise<GraphNode | { error: string }>;
    update: (
      id: string,
      patch: Partial<GraphNode> & { isPublic?: boolean },
    ) => Promise<{ ok: true } | { error: string }>;
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
    links: () => Promise<GraphLink[]>;
    createLink: (
      sourceId: string,
      targetId: string,
      label?: string,
      color?: string,
    ) => Promise<GraphLink | { error: string }>;
    removeLink: (id: string) => Promise<{ ok: boolean; error?: string }>;
  }

  /** Renderer-facing memory IPC surface — mirrors the preload `memory` namespace (Req 7.2, 7.5). */
  interface ElectronMemoryApi {
    list: (agentId: string, limit?: number) => Promise<MemoryItemDTO[]>;
  }

  /**
   * Renderer-facing graph-agent IPC surface — mirrors the preload `graphAgent`
   * namespace. The Izzi key stays in main; the renderer only sees the reply +
   * branch classification. `classification` is structurally the renderer
   * `BranchClassification` (same 5-type union, same fields).
   */
  interface ElectronGraphAgentApi {
    chat: (payload: {
      node: GraphNode;
      ancestors: GraphNode[];
      message: string;
    }) => Promise<{ reply: string; classification: BranchClassification | null }>;
  }

  /**
   * The renderer view of the preload `electronAPI`. The new graph/memory
   * namespaces are typed precisely from the shared models (Req 7.4); all other
   * existing namespaces stay loosely typed via the index signature so this
   * change is purely additive and never regresses existing call sites.
   */
  interface ElectronApi {
    graph?: ElectronGraphApi;
    memory?: ElectronMemoryApi;
    graphAgent?: ElectronGraphAgentApi;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  interface Window {
    electronAPI?: ElectronApi;
  }
}
