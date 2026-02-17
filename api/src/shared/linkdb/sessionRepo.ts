// api/src/shared/linkdb/sessionRepo.ts
import Database from "better-sqlite3";

export const LINKDB_PATH =
  process.env.LINKDB_PATH ||
  process.env.LINK_DB_PATH ||
  "./data/linkdb.sqlite";

const db = new Database(LINKDB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

function ensureSchema(): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS app_sessions (
    sid TEXT PRIMARY KEY,
    shm_user_id INTEGER NOT NULL,
    shm_session_id TEXT NOT NULL,
    telegram_init_data TEXT,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_app_sessions_user ON app_sessions(shm_user_id);
  CREATE INDEX IF NOT EXISTS idx_app_sessions_seen ON app_sessions(last_seen_at);
  `);

  // ---- schema upgrade: telegram_widget_payload ----
  // SQLite supports ADD COLUMN; ignore error if column already exists.
  try {
    db.exec(`ALTER TABLE app_sessions ADD COLUMN telegram_widget_payload TEXT;`);
  } catch {
    // column exists or sqlite limitation; ignore
  }
}
ensureSchema();

export type DbSession = {
  sid: string;
  shmUserId: number;
  shmSessionId: string;
  telegramInitData?: string;
  telegramWidgetPayload?: string; // JSON string
  createdAt: number;
  lastSeenAt: number;
};

type Row = {
  sid: string;
  shm_user_id: number;
  shm_session_id: string;
  telegram_init_data: string | null;
  telegram_widget_payload?: string | null;
  created_at: number;
  last_seen_at: number;
};

const stmtUpsert = db.prepare(`
INSERT INTO app_sessions (
  sid, shm_user_id, shm_session_id, telegram_init_data, telegram_widget_payload, created_at, last_seen_at
)
VALUES (
  @sid, @shm_user_id, @shm_session_id, @telegram_init_data, @telegram_widget_payload, @created_at, @last_seen_at
)
ON CONFLICT(sid) DO UPDATE SET
  shm_user_id = excluded.shm_user_id,
  shm_session_id = excluded.shm_session_id,
  telegram_init_data = excluded.telegram_init_data,
  telegram_widget_payload = excluded.telegram_widget_payload,
  last_seen_at = excluded.last_seen_at
`);

const stmtSelect = db.prepare(`
SELECT sid, shm_user_id, shm_session_id, telegram_init_data, telegram_widget_payload, created_at, last_seen_at
FROM app_sessions
WHERE sid = ?
`);

const stmtTouch = db.prepare(`
UPDATE app_sessions
SET last_seen_at = ?
WHERE sid = ?
`);

const stmtDelete = db.prepare(`
DELETE FROM app_sessions
WHERE sid = ?
`);

const stmtCleanupOld = db.prepare(`
DELETE FROM app_sessions
WHERE last_seen_at < ?
`);

export function upsertSession(s: DbSession): void {
  stmtUpsert.run({
    sid: s.sid,
    shm_user_id: s.shmUserId,
    shm_session_id: s.shmSessionId,
    telegram_init_data: s.telegramInitData ? String(s.telegramInitData).trim() : null,
    telegram_widget_payload: s.telegramWidgetPayload
      ? String(s.telegramWidgetPayload).trim()
      : null,
    created_at: s.createdAt,
    last_seen_at: s.lastSeenAt,
  });
}

export function getSession(sid: string): DbSession | null {
  const row = stmtSelect.get(sid) as Row | undefined;
  if (!row) return null;

  return {
    sid: String(row.sid),
    shmUserId: Number(row.shm_user_id) || 0,
    shmSessionId: String(row.shm_session_id || ""),
    telegramInitData: row.telegram_init_data ? String(row.telegram_init_data) : undefined,
    telegramWidgetPayload: row.telegram_widget_payload
      ? String(row.telegram_widget_payload)
      : undefined,
    createdAt: Number(row.created_at) || 0,
    lastSeenAt: Number(row.last_seen_at) || 0,
  };
}

export function touchSession(sid: string, lastSeenAt: number): void {
  stmtTouch.run(lastSeenAt, sid);
}

export function deleteSessionBySid(sid: string): void {
  stmtDelete.run(sid);
}

/**
 * Чистим всё, что не видели дольше ttlMs.
 * Вызывать лениво раз в минуту — ок.
 */
export function cleanupSessions(ttlMs: number): void {
  const now = Date.now();
  const threshold = now - Math.max(1, ttlMs);
  stmtCleanupOld.run(threshold);
}
