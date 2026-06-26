import type Database from 'better-sqlite3';

function getTableColumns(db: Database.Database, tableName: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  return new Set(rows.map((row) => row.name));
}

function ensureColumn(
  db: Database.Database,
  tableName: string,
  columnName: string,
  definition: string,
): void {
  const columns = getTableColumns(db, tableName);
  if (!columns.has(columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  }
}

export function ensureSqliteSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_data (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      data TEXT NOT NULL,
      synced_at TEXT NOT NULL,
      is_dirty INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS installed_extensions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT,
      version TEXT NOT NULL,
      description TEXT,
      author TEXT,
      icon_path TEXT,
      install_path TEXT NOT NULL,
      is_enabled INTEGER NOT NULL DEFAULT 1,
      license_key TEXT,
      installed_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS extension_settings (
      extension_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (extension_id, key),
      FOREIGN KEY (extension_id) REFERENCES installed_extensions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      entity_type TEXT,
      entity_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS diagnostic_events (
      id TEXT PRIMARY KEY,
      timestamp TEXT NOT NULL,
      type TEXT NOT NULL,
      status TEXT NOT NULL,
      detail TEXT NOT NULL,
      meta TEXT
    );

    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      provider TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      state TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      request_id TEXT,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS agent_state (
      session_id TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      last_error TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      title TEXT NOT NULL,
      status TEXT NOT NULL,
      summary TEXT,
      source_message_id TEXT,
      payload TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS agent_memories (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      kind TEXT NOT NULL,
      content TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      source_message_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (session_id) REFERENCES chat_sessions(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS offline_queue (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      op_type TEXT NOT NULL,
      target TEXT NOT NULL,
      local_id TEXT,
      backend_id TEXT,
      base_updated_at TEXT,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_user_data_type ON user_data(type);
    CREATE INDEX IF NOT EXISTS idx_installed_extensions_display_name ON installed_extensions(display_name);
    CREATE INDEX IF NOT EXISTS idx_diagnostic_events_timestamp ON diagnostic_events(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_sessions_updated_at ON chat_sessions(updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created_at ON chat_messages(session_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_request_id ON chat_messages(request_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_session_id ON agent_tasks(session_id);
    CREATE INDEX IF NOT EXISTS idx_agent_tasks_status ON agent_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_agent_memories_session_id ON agent_memories(session_id);
    CREATE INDEX IF NOT EXISTS idx_agent_memories_pinned ON agent_memories(pinned);
    CREATE INDEX IF NOT EXISTS idx_offline_queue_seq ON offline_queue(seq ASC);
  `);

  ensureColumn(db, 'agent_tasks', 'summary', 'TEXT');
  ensureColumn(db, 'agent_tasks', 'source_message_id', 'TEXT');
  ensureColumn(db, 'agent_memories', 'pinned', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(db, 'agent_memories', 'source_message_id', 'TEXT');
}
