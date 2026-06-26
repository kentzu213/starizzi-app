/**
 * Graph & Memory IPC registration — wires the renderer-facing IPC channels to
 * the main-process `GraphClient`. Lives in the Electron MAIN process.
 *
 * Security (security-baseline B): every handler delegates straight to the
 * GraphClient and returns ONLY plain models / results
 * (GraphNode / GraphLink / MemoryItemDTO / { ok } / { error }). The JWT lives
 * only inside GraphClient and NEVER crosses the IPC bridge (Req 7.3).
 *
 * @module main/graph/graph-ipc
 * @see Requirements 7.1, 7.2, 7.3, 7.5, 8.1
 */

import { ipcMain } from 'electron';
import type { GraphClient } from './graph-client';
import type { GraphAgent } from './graph-agent';

/**
 * Register the `graph:*` and `memory:*` IPC handlers against a GraphClient.
 * Channels mirror the renderer feature-detect signatures of `Knowledge.tsx`
 * (`graph.list()`) and `ContextPanel.tsx` (`memory.list(agentId)`).
 */
export function registerGraphIpc(client: GraphClient): void {
  ipcMain.handle('graph:list', () => client.listNodes());
  ipcMain.handle('graph:universe', () => client.fetchUniverse());
  ipcMain.handle('graph:create', (_e, input) => client.createNode(input));
  ipcMain.handle('graph:update', (_e, id, patch) => client.updateNode(id, patch));
  ipcMain.handle('graph:remove', (_e, id) => client.removeNode(id));
  ipcMain.handle('graph:links', () => client.listLinks());
  ipcMain.handle('graph:createLink', (_e, sourceId, targetId, label, color) =>
    client.createLink(sourceId, targetId, label, color),
  );
  ipcMain.handle('graph:removeLink', (_e, id) => client.removeLink(id));
  // `_agentId` matches the renderer feature-detect signature `memory.list(agentId)`
  // (Req 7.5). The shared backend does not filter memory by agent yet, so the
  // parameter is currently advisory (unused) — kept to preserve the contract
  // for a future per-agent filter without reshaping the IPC surface.
  ipcMain.handle('memory:list', (_e, _agentId, limit) => client.listMemory(limit));
}

/**
 * Register the `graphAgent:chat` IPC handler against a GraphAgent. The Izzi API
 * key stays inside GraphAgent (main process) and NEVER crosses the bridge — the
 * renderer only ever receives `{ reply, classification }` (security-baseline A/B).
 */
export function registerGraphAgentIpc(agent: GraphAgent): void {
  ipcMain.handle('graphAgent:chat', (_e, payload) => agent.chat(payload));
}
