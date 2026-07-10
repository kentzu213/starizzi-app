import { app } from 'electron';
import Database from 'better-sqlite3';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type {
  AgentMemory,
  AgentMemoryKind,
  AgentRun,
  AgentRunEntry,
  AgentRunEntryKind,
  AgentRunStatus,
  AgentRuntimeState,
  AgentTask,
  AgentTaskStatus,
  ChatMessage,
  ChatMessageState,
  ChatSession,
  DiagnosticEvent,
} from '../agent/types';
import { runLegacyStoreMigration } from './migrations';
import { ensureSqliteSchema } from './sqlite-schema';
import type { QueueOp } from '../../shared/offline-queue';

type SqliteDatabase = Database.Database;

interface DatabaseSettingRow {
  key: string;
  value: string;
}

interface UserDataRow {
  id: string;
  type: string;
  data: string;
  synced_at: string;
  is_dirty: number;
}

interface AgentStateRow {
  session_id: string;
  state: AgentRuntimeState['state'];
  last_error: string | null;
  updated_at: string;
}

interface ChatSessionRow {
  id: string;
  title: string;
  provider: ChatSession['provider'];
  created_at: string;
  updated_at: string;
}

interface ChatMessageRow {
  id: string;
  session_id: string;
  role: ChatMessage['role'];
  content: string;
  state: ChatMessageState;
  created_at: string;
  request_id: string | null;
}

interface AgentTaskRow {
  id: string;
  session_id: string | null;
  title: string;
  status: AgentTaskStatus;
  summary: string | null;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

interface AgentRunRow {
  id: string;
  goal: string;
  stage: string;
  status: AgentRunStatus;
  created_at: string;
  updated_at: string;
}

interface AgentRunEntryRow {
  id: string;
  run_id: string;
  kind: AgentRunEntryKind;
  stage: string | null;
  agent_id: string | null;
  content: string;
  created_at: string;
}

interface AgentMemoryRow {
  id: string;
  session_id: string | null;
  kind: AgentMemoryKind;
  content: string;
  pinned: number;
  source_message_id: string | null;
  created_at: string;
  updated_at: string;
}

interface InstalledExtensionRow {
  id: string;
  name: string;
  display_name?: string;
  version: string;
  description?: string;
  author?: string;
  icon_path?: string;
  install_path: string;
  is_enabled: number;
  license_key?: string;
  installed_at: string;
  updated_at: string;
}

interface OfflineQueueRow {
  seq: number;
  op_type: QueueOp['opType'];
  target: QueueOp['target'];
  local_id: string | null;
  backend_id: string | null;
  base_updated_at: string | null;
  payload: string;
  created_at: string;
}

export class DatabaseManager {
  private db!: SqliteDatabase;
  private dbPath: string;
  private legacyStorePath: string;

  constructor() {
    const userDataPath = app.getPath('userData');
    const dbDir = path.join(userDataPath, 'data');
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    this.dbPath = path.join(dbDir, 'openclaw.db');
    this.legacyStorePath = path.join(dbDir, 'openclaw-store.json');
  }

  initialize() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    ensureSqliteSchema(this.db);
    runLegacyStoreMigration(this.db, this.legacyStorePath);

    console.log('[DB] Initialized SQLite store at:', this.dbPath);
  }

  getSetting(key: string): string | null {
    const row = this.db
      .prepare<[string], DatabaseSettingRow>('SELECT key, value FROM settings WHERE key = ?')
      .get(key);
    return row?.value ?? null;
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`,
      )
      .run(key, value, new Date().toISOString());
  }

  deleteSetting(key: string): void {
    this.db.prepare('DELETE FROM settings WHERE key = ?').run(key);
  }

  cacheUserData(id: string, type: string, data: object): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO user_data (id, type, data, synced_at, is_dirty)
         VALUES (?, ?, ?, ?, 0)
         ON CONFLICT(id) DO UPDATE SET
           type = excluded.type,
           data = excluded.data,
           synced_at = excluded.synced_at,
           is_dirty = excluded.is_dirty`,
      )
      .run(id, type, JSON.stringify(data), now);
  }

  getUserData(type: string): any[] {
    const rows = this.db
      .prepare<[string], Pick<UserDataRow, 'data'>>('SELECT data FROM user_data WHERE type = ? ORDER BY synced_at DESC')
      .all(type);
    return rows
      .map((row) => this.parseJsonValue(row.data))
      .filter((value) => value !== undefined);
  }

  deleteUserData(id: string): void {
    this.db.prepare('DELETE FROM user_data WHERE id = ?').run(id);
  }

  getDirtyData(): any[] {
    return this.db
      .prepare<[], UserDataRow>(
        'SELECT id, type, data, synced_at, is_dirty FROM user_data WHERE is_dirty = 1 ORDER BY synced_at DESC',
      )
      .all()
      .map((row) => ({
        ...row,
        data: this.parseJsonValue(row.data),
      }));
  }

  getInstalledExtensions(): InstalledExtensionRow[] {
    return this.db
      .prepare<[], InstalledExtensionRow>(
        `SELECT
           id,
           name,
           display_name,
           version,
           description,
           author,
           icon_path,
           install_path,
           is_enabled,
           license_key,
           installed_at,
           updated_at
         FROM installed_extensions
         ORDER BY COALESCE(display_name, name) COLLATE NOCASE ASC`,
      )
      .all();
  }

  addExtension(ext: {
    id: string;
    name: string;
    displayName: string;
    version: string;
    description?: string;
    author?: string;
    iconPath?: string;
    installPath: string;
    licenseKey?: string;
  }): void {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare<[string], { installed_at: string }>('SELECT installed_at FROM installed_extensions WHERE id = ?')
      .get(ext.id);

    this.db
      .prepare(
        `INSERT INTO installed_extensions (
           id, name, display_name, version, description, author, icon_path,
           install_path, is_enabled, license_key, installed_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           display_name = excluded.display_name,
           version = excluded.version,
           description = excluded.description,
           author = excluded.author,
           icon_path = excluded.icon_path,
           install_path = excluded.install_path,
           is_enabled = excluded.is_enabled,
           license_key = excluded.license_key,
           updated_at = excluded.updated_at`,
      )
      .run(
        ext.id,
        ext.name,
        ext.displayName,
        ext.version,
        ext.description ?? null,
        ext.author ?? null,
        ext.iconPath ?? null,
        ext.installPath,
        ext.licenseKey ?? null,
        existing?.installed_at ?? now,
        now,
      );
  }

  removeExtension(id: string): void {
    this.db.prepare('DELETE FROM extension_settings WHERE extension_id = ?').run(id);
    this.db.prepare('DELETE FROM installed_extensions WHERE id = ?').run(id);
  }

  appendDiagnosticEvent(event: {
    type: string;
    status: 'success' | 'error' | 'info';
    detail: string;
    meta?: Record<string, unknown>;
  }): void {
    this.db
      .prepare(
        `INSERT INTO diagnostic_events (id, timestamp, type, status, detail, meta)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        new Date().toISOString(),
        event.type,
        event.status,
        event.detail,
        event.meta ? JSON.stringify(event.meta) : null,
      );
  }

  getDiagnosticEvents(limit = 100): DiagnosticEvent[] {
    return this.db
      .prepare<[number], { id: string; timestamp: string; type: string; status: string; detail: string; meta: string | null }>(
        `SELECT id, timestamp, type, status, detail, meta
         FROM diagnostic_events
         ORDER BY timestamp DESC
         LIMIT ?`,
      )
      .all(limit)
      .map((row) => ({
        ...row,
        meta: row.meta ? this.parseJsonValue(row.meta) : undefined,
      })) as DiagnosticEvent[];
  }

  getChatSession(sessionId: string): ChatSession | null {
    const row = this.db
      .prepare<[string], ChatSessionRow>(
        'SELECT id, title, provider, created_at, updated_at FROM chat_sessions WHERE id = ?',
      )
      .get(sessionId);

    return row ? this.mapChatSession(row) : null;
  }

  getLatestChatSession(): ChatSession | null {
    const row = this.db
      .prepare<[], ChatSessionRow>(
        `SELECT id, title, provider, created_at, updated_at
         FROM chat_sessions
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get();

    return row ? this.mapChatSession(row) : null;
  }

  createChatSession(title = 'Cuoc tro chuyen moi', provider: ChatSession['provider'] = 'izziapi-managed'): ChatSession {
    const now = new Date().toISOString();
    const id = randomUUID();

    this.db
      .prepare(
        `INSERT INTO chat_sessions (id, title, provider, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(id, title, provider, now, now);

    return {
      id,
      title,
      provider,
      createdAt: now,
      updatedAt: now,
    };
  }

  renameChatSession(sessionId: string, title: string): ChatSession | null {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare('UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?')
      .run(title, updatedAt, sessionId);

    return this.getChatSession(sessionId);
  }

  listChatMessages(sessionId: string): ChatMessage[] {
    return this.db
      .prepare<[string], ChatMessageRow>(
        `SELECT id, session_id, role, content, state, created_at, request_id
         FROM chat_messages
         WHERE session_id = ?
         ORDER BY created_at ASC, id ASC`,
      )
      .all(sessionId)
      .map((row) => this.mapChatMessage(row));
  }

  insertChatMessage(message: {
    sessionId: string;
    role: ChatMessage['role'];
    content: string;
    state: ChatMessageState;
    requestId?: string;
    id?: string;
    createdAt?: string;
  }): ChatMessage {
    const id = message.id ?? randomUUID();
    const timestamp = message.createdAt ?? new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO chat_messages (id, session_id, role, content, state, created_at, updated_at, request_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        message.sessionId,
        message.role,
        message.content,
        message.state,
        timestamp,
        timestamp,
        message.requestId ?? null,
      );

    this.touchChatSession(message.sessionId, timestamp);

    return {
      id,
      sessionId: message.sessionId,
      role: message.role,
      content: message.content,
      state: message.state,
      createdAt: timestamp,
      requestId: message.requestId,
    };
  }

  appendAssistantDelta(messageId: string, delta: string): void {
    const row = this.db
      .prepare<[string], { session_id: string }>('SELECT session_id FROM chat_messages WHERE id = ?')
      .get(messageId);

    if (!row) return;

    const updatedAt = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE chat_messages
         SET content = COALESCE(content, '') || ?, state = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(delta, 'streaming', updatedAt, messageId);

    this.touchChatSession(row.session_id, updatedAt);
  }

  setMessageState(messageId: string, state: ChatMessageState): void {
    const row = this.db
      .prepare<[string], { session_id: string }>('SELECT session_id FROM chat_messages WHERE id = ?')
      .get(messageId);

    if (!row) return;

    const updatedAt = new Date().toISOString();
    this.db
      .prepare('UPDATE chat_messages SET state = ?, updated_at = ? WHERE id = ?')
      .run(state, updatedAt, messageId);

    this.touchChatSession(row.session_id, updatedAt);
  }

  getAgentState(sessionId?: string): AgentRuntimeState {
    const row = sessionId
      ? this.db
        .prepare<[string], AgentStateRow>(
          'SELECT session_id, state, last_error, updated_at FROM agent_state WHERE session_id = ?',
        )
        .get(sessionId)
      : this.db
        .prepare<[], AgentStateRow>(
          `SELECT session_id, state, last_error, updated_at
           FROM agent_state
           ORDER BY updated_at DESC
           LIMIT 1`,
        )
        .get();

    if (!row) {
      return {
        sessionId,
        state: 'idle',
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      sessionId: row.session_id === '__global__' ? undefined : row.session_id,
      state: row.state,
      lastError: row.last_error ?? undefined,
      updatedAt: row.updated_at,
    };
  }

  upsertAgentState(state: AgentRuntimeState): AgentRuntimeState {
    const sessionId = state.sessionId ?? '__global__';
    const updatedAt = state.updatedAt || new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO agent_state (session_id, state, last_error, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           state = excluded.state,
           last_error = excluded.last_error,
           updated_at = excluded.updated_at`,
      )
      .run(sessionId, state.state, state.lastError ?? null, updatedAt);

    return {
      sessionId: sessionId === '__global__' ? undefined : sessionId,
      state: state.state,
      lastError: state.lastError,
      updatedAt,
    };
  }

  listAgentTasks(sessionId?: string): AgentTask[] {
    const rows = sessionId
      ? this.db
        .prepare<[string], AgentTaskRow>(
          `SELECT id, session_id, title, status, summary, source_message_id, created_at, updated_at
           FROM agent_tasks
           WHERE session_id = ?
           ORDER BY updated_at DESC, created_at DESC`,
        )
        .all(sessionId)
      : this.db
        .prepare<[], AgentTaskRow>(
          `SELECT id, session_id, title, status, summary, source_message_id, created_at, updated_at
           FROM agent_tasks
           ORDER BY updated_at DESC, created_at DESC`,
        )
        .all();

    return rows.map((row) => this.mapAgentTask(row));
  }

  upsertAgentTask(task: AgentTask): AgentTask {
    const createdAt = task.createdAt || new Date().toISOString();
    const updatedAt = task.updatedAt || createdAt;

    this.db
      .prepare(
        `INSERT INTO agent_tasks (
           id, session_id, title, status, summary, source_message_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           session_id = excluded.session_id,
           title = excluded.title,
           status = excluded.status,
           summary = excluded.summary,
           source_message_id = excluded.source_message_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        task.id,
        task.sessionId ?? null,
        task.title,
        task.status,
        task.summary ?? null,
        task.sourceMessageId ?? null,
        createdAt,
        updatedAt,
      );

    return {
      ...task,
      createdAt,
      updatedAt,
    };
  }

  updateAgentTaskStatus(taskId: string, status: AgentTaskStatus): AgentTask | null {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare('UPDATE agent_tasks SET status = ?, updated_at = ? WHERE id = ?')
      .run(status, updatedAt, taskId);

    const row = this.db
      .prepare<[string], AgentTaskRow>(
        `SELECT id, session_id, title, status, summary, source_message_id, created_at, updated_at
         FROM agent_tasks
         WHERE id = ?`,
      )
      .get(taskId);

    return row ? this.mapAgentTask(row) : null;
  }

  // ── AI-company Run store (agent-company spec, Phase 1) ──

  createRun(goal: string, stage = 'idea'): AgentRun {
    const now = new Date().toISOString();
    const run: AgentRun = { id: `run-${randomUUID()}`, goal, stage, status: 'active', createdAt: now, updatedAt: now };
    this.db
      .prepare('INSERT INTO agent_runs (id, goal, stage, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(run.id, run.goal, run.stage, run.status, run.createdAt, run.updatedAt);
    return run;
  }

  listRuns(): AgentRun[] {
    const rows = this.db
      .prepare<[], AgentRunRow>(
        'SELECT id, goal, stage, status, created_at, updated_at FROM agent_runs ORDER BY updated_at DESC',
      )
      .all();
    return rows.map((r) => this.mapAgentRun(r));
  }

  getRun(id: string): AgentRun | null {
    const row = this.db
      .prepare<[string], AgentRunRow>(
        'SELECT id, goal, stage, status, created_at, updated_at FROM agent_runs WHERE id = ?',
      )
      .get(id);
    return row ? this.mapAgentRun(row) : null;
  }

  updateRun(id: string, patch: { goal?: string; stage?: string; status?: AgentRunStatus }): AgentRun | null {
    const existing = this.getRun(id);
    if (!existing) return null;
    const updatedAt = new Date().toISOString();
    const goal = patch.goal ?? existing.goal;
    const stage = patch.stage ?? existing.stage;
    const status = patch.status ?? existing.status;
    this.db
      .prepare('UPDATE agent_runs SET goal = ?, stage = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(goal, stage, status, updatedAt, id);
    return { ...existing, goal, stage, status, updatedAt };
  }

  /** Append a blackboard entry. Returns null if the run does not exist (no orphan entries). */
  appendRunEntry(entry: Omit<AgentRunEntry, 'id' | 'createdAt'>): AgentRunEntry | null {
    if (!this.getRun(entry.runId)) return null;
    const createdAt = new Date().toISOString();
    const full: AgentRunEntry = { ...entry, id: `rune-${randomUUID()}`, createdAt };
    this.db
      .prepare(
        'INSERT INTO agent_run_entries (id, run_id, kind, stage, agent_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(full.id, full.runId, full.kind, full.stage ?? null, full.agentId ?? null, full.content, createdAt);
    // Touch the run so it reflects activity + sorts to the top.
    this.db.prepare('UPDATE agent_runs SET updated_at = ? WHERE id = ?').run(createdAt, entry.runId);
    return full;
  }

  listRunEntries(runId: string): AgentRunEntry[] {
    const rows = this.db
      .prepare<[string], AgentRunEntryRow>(
        'SELECT id, run_id, kind, stage, agent_id, content, created_at FROM agent_run_entries WHERE run_id = ? ORDER BY created_at ASC',
      )
      .all(runId);
    return rows.map((r) => this.mapAgentRunEntry(r));
  }

  private mapAgentRun(row: AgentRunRow): AgentRun {
    return {
      id: row.id,
      goal: row.goal,
      stage: row.stage,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapAgentRunEntry(row: AgentRunEntryRow): AgentRunEntry {
    return {
      id: row.id,
      runId: row.run_id,
      kind: row.kind,
      stage: row.stage ?? undefined,
      agentId: row.agent_id ?? undefined,
      content: row.content,
      createdAt: row.created_at,
    };
  }

  listAgentMemories(sessionId?: string): AgentMemory[] {
    const rows = sessionId
      ? this.db
        .prepare<[string], AgentMemoryRow>(
          `SELECT id, session_id, kind, content, pinned, source_message_id, created_at, updated_at
           FROM agent_memories
           WHERE session_id = ?
           ORDER BY pinned DESC, updated_at DESC, created_at DESC`,
        )
        .all(sessionId)
      : this.db
        .prepare<[], AgentMemoryRow>(
          `SELECT id, session_id, kind, content, pinned, source_message_id, created_at, updated_at
           FROM agent_memories
           ORDER BY pinned DESC, updated_at DESC, created_at DESC`,
        )
        .all();

    return rows.map((row) => this.mapAgentMemory(row));
  }

  upsertAgentMemory(memory: AgentMemory): AgentMemory {
    const createdAt = memory.createdAt || new Date().toISOString();
    const updatedAt = memory.updatedAt || createdAt;

    this.db
      .prepare(
        `INSERT INTO agent_memories (
           id, session_id, kind, content, pinned, source_message_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           session_id = excluded.session_id,
           kind = excluded.kind,
           content = excluded.content,
           pinned = excluded.pinned,
           source_message_id = excluded.source_message_id,
           updated_at = excluded.updated_at`,
      )
      .run(
        memory.id,
        memory.sessionId ?? null,
        memory.kind,
        memory.content,
        memory.pinned ? 1 : 0,
        memory.sourceMessageId ?? null,
        createdAt,
        updatedAt,
      );

    return {
      ...memory,
      createdAt,
      updatedAt,
    };
  }

  pinAgentMemory(memoryId: string, pinned: boolean): AgentMemory | null {
    const updatedAt = new Date().toISOString();
    this.db
      .prepare('UPDATE agent_memories SET pinned = ?, updated_at = ? WHERE id = ?')
      .run(pinned ? 1 : 0, updatedAt, memoryId);

    const row = this.db
      .prepare<[string], AgentMemoryRow>(
        `SELECT id, session_id, kind, content, pinned, source_message_id, created_at, updated_at
         FROM agent_memories
         WHERE id = ?`,
      )
      .get(memoryId);

    return row ? this.mapAgentMemory(row) : null;
  }

  deleteAgentMemory(memoryId: string): void {
    this.db.prepare('DELETE FROM agent_memories WHERE id = ?').run(memoryId);
  }

  // ── Offline write queue (Phase 2 — desktop-graph-backend-sync) ──
  // Persists graph write operations made while the shared backend is unreachable.
  // The pure coalesce/no-orphan/LWW logic lives in `shared/offline-queue.ts`; this
  // layer is just FIFO persistence. No token is ever stored here (Req 9.2).

  /** Append a pending write op; returns the auto-assigned FIFO `seq` (Req 4.1). */
  enqueueOp(op: Omit<QueueOp, 'seq'>): number {
    const info = this.db
      .prepare(
        `INSERT INTO offline_queue (op_type, target, local_id, backend_id, base_updated_at, payload, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        op.opType,
        op.target,
        op.localId ?? null,
        op.backendId ?? null,
        op.baseUpdatedAt ?? null,
        JSON.stringify(op.payload ?? {}),
        op.createdAt || new Date().toISOString(),
      );
    return Number(info.lastInsertRowid);
  }

  /** Read all pending ops in FIFO order (oldest first). */
  peekQueue(): QueueOp[] {
    return this.db
      .prepare<[], OfflineQueueRow>(
        `SELECT seq, op_type, target, local_id, backend_id, base_updated_at, payload, created_at
         FROM offline_queue
         ORDER BY seq ASC`,
      )
      .all()
      .map((row) => this.mapQueueOp(row));
  }

  /** Remove a flushed op by its `seq`. */
  dequeueOp(seq: number): void {
    this.db.prepare('DELETE FROM offline_queue WHERE seq = ?').run(seq);
  }

  /** Replace the local id of a queued op with the resolved backend id (after a create syncs). */
  remapQueuedBackendId(seq: number, backendId: string): void {
    this.db
      .prepare('UPDATE offline_queue SET backend_id = ? WHERE seq = ?')
      .run(backendId, seq);
  }

  close() {
    if (this.db?.open) {
      this.db.close();
    }
  }

  private touchChatSession(sessionId: string, updatedAt = new Date().toISOString()) {
    this.db.prepare('UPDATE chat_sessions SET updated_at = ? WHERE id = ?').run(updatedAt, sessionId);
  }

  private mapChatSession(row: ChatSessionRow): ChatSession {
    return {
      id: row.id,
      title: row.title,
      provider: row.provider,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapChatMessage(row: ChatMessageRow): ChatMessage {
    return {
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      state: row.state,
      createdAt: row.created_at,
      requestId: row.request_id ?? undefined,
    };
  }

  private mapAgentTask(row: AgentTaskRow): AgentTask {
    return {
      id: row.id,
      sessionId: row.session_id ?? undefined,
      title: row.title,
      status: row.status,
      summary: row.summary ?? undefined,
      sourceMessageId: row.source_message_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapAgentMemory(row: AgentMemoryRow): AgentMemory {
    return {
      id: row.id,
      sessionId: row.session_id ?? undefined,
      kind: row.kind,
      content: row.content,
      pinned: row.pinned === 1,
      sourceMessageId: row.source_message_id ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapQueueOp(row: OfflineQueueRow): QueueOp {
    const op: QueueOp = {
      seq: row.seq,
      opType: row.op_type,
      target: row.target,
      payload: this.parseJsonValue(row.payload) as Record<string, unknown>,
      createdAt: row.created_at,
    };
    if (row.local_id !== null) op.localId = row.local_id;
    if (row.backend_id !== null) op.backendId = row.backend_id;
    if (row.base_updated_at !== null) op.baseUpdatedAt = row.base_updated_at;
    return op;
  }

  private parseJsonValue(value: string) {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
}
