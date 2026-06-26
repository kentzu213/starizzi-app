import type { GraphNode, GraphLink, MemoryItemDTO } from '../../shared/graph-types';

export {};

declare global {
  /** Renderer-facing graph IPC surface — mirrors the preload `graph` namespace (Req 7.1, 7.5). */
  interface ElectronGraphApi {
    list: () => Promise<GraphNode[]>;
    create: (input: Partial<GraphNode> & { title: string }) => Promise<GraphNode | { error: string }>;
    update: (
      id: string,
      patch: Partial<GraphNode> & { isPublic?: boolean },
    ) => Promise<{ ok: true } | { error: string }>;
    remove: (id: string) => Promise<{ ok: boolean; error?: string }>;
    links: () => Promise<GraphLink[]>;
  }

  /** Renderer-facing memory IPC surface — mirrors the preload `memory` namespace (Req 7.2, 7.5). */
  interface ElectronMemoryApi {
    list: (agentId: string, limit?: number) => Promise<MemoryItemDTO[]>;
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }

  interface Window {
    electronAPI?: ElectronApi;
  }
}
