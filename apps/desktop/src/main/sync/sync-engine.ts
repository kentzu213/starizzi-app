import { AuthManager } from '../auth/auth-manager';
import { DatabaseManager } from '../db/database';
import { GraphClient, type NodeCreateInput } from '../graph/graph-client';
import { coalesceGroups, resolveConflict, type QueueOp } from '../../shared/offline-queue';
import type { GraphNode } from '../../shared/graph-types';
import { IZZI_API_BASE } from '../config/public-config';

export type SyncStatus = 'idle' | 'syncing' | 'error' | 'success';

interface SyncState {
  status: SyncStatus;
  lastSynced: string | null;
  error: string | null;
  progress: number;
}

export class SyncEngine {
  private auth: AuthManager;
  private db: DatabaseManager;
  private graphClient: GraphClient;
  private state: SyncState = {
    status: 'idle',
    lastSynced: null,
    error: null,
    progress: 0,
  };
  private syncInterval: NodeJS.Timeout | null = null;

  constructor(auth: AuthManager, db: DatabaseManager) {
    this.auth = auth;
    this.db = db;
    // Graph refresh reuses the same auth + db; the token stays in main (see graph-client.ts).
    this.graphClient = new GraphClient(auth, db);

    // Load last sync time
    const lastSynced = this.db.getSetting('last_synced');
    if (lastSynced) this.state.lastSynced = lastSynced;

    // Auto-sync every 5 minutes
    this.syncInterval = setInterval(() => {
      if (this.auth.isAuthenticated()) {
        this.startSync();
      }
    }, 5 * 60 * 1000);
  }

  async startSync(): Promise<SyncState> {
    if (!this.auth.isAuthenticated()) {
      return { ...this.state, status: 'error', error: 'Not authenticated' };
    }

    if (this.state.status === 'syncing') {
      return this.state;
    }

    this.state = { status: 'syncing', lastSynced: this.state.lastSynced, error: null, progress: 0 };

    try {
      const token = await this.auth.getAccessToken();
      if (!token) {
        throw new Error('No access token available');
      }

      const headers = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      };

      // 1. Sync user profile from izzi-backend /api/auth/me
      this.state.progress = 20;
      try {
        const profileRes = await fetch(`${IZZI_API_BASE}/api/auth/me`, { headers });
        if (profileRes.ok) {
          const profileData = await profileRes.json() as any;
          this.db.cacheUserData('profile', 'profile', profileData as object);
          console.log('[Sync] Profile synced:', profileData.email);
        }
      } catch (err: any) {
        console.warn('[Sync] Profile sync failed:', err.message);
      }

      // 2. Sync API keys from izzi-backend /api/keys
      this.state.progress = 40;
      try {
        const keysRes = await fetch(`${IZZI_API_BASE}/api/keys`, { headers });
        if (keysRes.ok) {
          const keysData = await keysRes.json() as any;
          this.db.cacheUserData('api_keys', 'api_keys', keysData as object);
          console.log('[Sync] API keys synced');
        }
      } catch (err: any) {
        console.warn('[Sync] API keys sync failed:', err.message);
      }

      // 3. Sync usage data from izzi-backend /api/usage
      this.state.progress = 60;
      try {
        const usageRes = await fetch(`${IZZI_API_BASE}/api/usage`, { headers });
        if (usageRes.ok) {
          const usageData = await usageRes.json() as any;
          this.db.cacheUserData('usage', 'usage', usageData as object);
          console.log('[Sync] Usage data synced');
        }
      } catch (err: any) {
        console.warn('[Sync] Usage sync failed:', err.message);
      }

      // 4. Sync billing from izzi-backend /api/billing
      this.state.progress = 80;
      try {
        const billingRes = await fetch(`${IZZI_API_BASE}/api/billing`, { headers });
        if (billingRes.ok) {
          const billingData = await billingRes.json() as any;
          this.db.cacheUserData('billing', 'billing', billingData as object);
          console.log('[Sync] Billing data synced');
        }
      } catch (err: any) {
        console.warn('[Sync] Billing sync failed:', err.message);
      }

      // 5. Sync graph nodes from izzi-backend /api/aibase/nodes (Knowledge/Graph surface)
      // Best-effort: a failure here must not break the existing sync steps (Req 10.3).
      this.state.progress = 90;
      let latestNodes: GraphNode[] = [];
      try {
        latestNodes = await this.graphClient.listNodes();
        this.db.cacheUserData('graph_nodes', 'graph_nodes', latestNodes as object);
        console.log('[Sync] Graph nodes synced:', latestNodes.length);
      } catch (err: any) {
        console.warn('[Sync] Graph sync failed:', err.message);
      }

      // 5b. Flush queued offline writes (Phase 2). Uses the fresh node list from
      // step 5 for last-write-wins. Best-effort; stops cleanly if still offline (Req 4.2-4.6).
      this.state.progress = 93;
      try {
        await this.flushOfflineQueue(latestNodes);
      } catch (err: any) {
        console.warn('[Sync] Offline queue flush failed:', err.message);
      }

      // 6. Refresh user profile in AuthManager
      this.state.progress = 95;
      await this.auth.refreshProfile();

      this.state = {
        status: 'success',
        lastSynced: new Date().toISOString(),
        error: null,
        progress: 100,
      };
      this.db.setSetting('last_synced', this.state.lastSynced || '');
      console.log('[Sync] Completed successfully');
    } catch (err: any) {
      this.state = {
        status: 'error',
        lastSynced: this.state.lastSynced,
        error: err.message,
        progress: 0,
      };
      console.error('[Sync] Failed:', err.message);
    }

    return this.state;
  }

  getStatus(): SyncState {
    return { ...this.state };
  }

  /**
   * Flush queued offline writes to the shared backend (Phase 2, Req 4.2-4.6).
   * Coalesces the queue, then sends each surviving group in FIFO order, dequeuing
   * every consumed row on success. Stops cleanly on a network failure (still
   * offline) leaving the rest queued — and because sent groups are dequeued
   * immediately, a later retry never re-sends them (no duplicates).
   *
   * `latestNodes` is the fresh list from sync step 5, used for last-write-wins:
   * an update is skipped if the backend copy is strictly newer than the version
   * the offline edit was based on (Req 4.5).
   */
  private async flushOfflineQueue(latestNodes: GraphNode[]): Promise<void> {
    const raw = this.db.peekQueue();
    if (raw.length === 0) return;

    const backendUpdatedAt = new Map<string, string>();
    for (const node of latestNodes) backendUpdatedAt.set(node.id, node.updatedAt);

    for (const group of coalesceGroups(raw)) {
      const { survivor, seqs } = group;

      // Cancelled group (create+delete offline) → nothing to send; just clear rows.
      if (survivor === null) {
        for (const seq of seqs) this.db.dequeueOp(seq);
        continue;
      }

      // Phase 1 has no link-write surface, so link ops are never enqueued; leave
      // any in place for a future link-write phase rather than dropping silently.
      if (survivor.target !== 'node') continue;

      const sent = await this.flushNodeOp(survivor, backendUpdatedAt);
      if (!sent) return; // still offline → stop; remaining rows stay queued

      for (const seq of seqs) this.db.dequeueOp(seq);
    }
  }

  /**
   * Send one coalesced node op with `queueOnOffline: false` (so a still-offline
   * send does NOT re-enqueue). Returns false ONLY on a network failure (caller
   * stops the flush); a backend rejection or a 404 on a since-deleted node is
   * treated as terminal (the op is consumed) to avoid a poison-pill loop (Req 4.6).
   */
  private async flushNodeOp(
    op: QueueOp,
    backendUpdatedAt: Map<string, string>,
  ): Promise<boolean> {
    if (op.opType === 'create') {
      const result = await this.graphClient.createNode(
        op.payload as unknown as NodeCreateInput,
        { queueOnOffline: false },
      );
      if ('error' in result) {
        if (result.error === 'network error') return false;
        this.logQueueDrop('create', result.error);
      }
      return true;
    }

    if (op.opType === 'update') {
      const id = op.backendId;
      if (!id) return true; // nothing to target → consume
      // Last-write-wins: defer to a strictly newer backend edit (Req 4.5).
      if (resolveConflict(op.baseUpdatedAt, backendUpdatedAt.get(id)) === 'backend') {
        this.logQueueDrop('update-conflict', `backend newer than base for ${id}`);
        return true;
      }
      const result = await this.graphClient.updateNode(
        id,
        op.payload as Partial<GraphNode> & { isPublic?: boolean },
        { queueOnOffline: false },
      );
      if ('error' in result) {
        if (result.error === 'network error') return false;
        this.logQueueDrop('update', result.error); // 404 / rejection → consume (Req 4.6)
      }
      return true;
    }

    // delete
    const id = op.backendId;
    if (!id) return true;
    const result = await this.graphClient.removeNode(id, { queueOnOffline: false });
    if (!result.ok && result.error === 'network error') return false;
    // success or 404 (already gone) → treat as done (Req 4.6)
    return true;
  }

  /** Record a dropped/skipped queued op (no token, no node content — Req 9.2). */
  private logQueueDrop(kind: string, reason: string): void {
    try {
      this.db.appendDiagnosticEvent({
        type: `graph.flush.${kind}`,
        status: 'info',
        detail: `dropped queued op: ${reason}`.slice(0, 200),
      });
    } catch {
      // diagnostics are best-effort
    }
  }

  destroy() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
  }
}
