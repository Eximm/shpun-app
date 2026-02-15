// api/src/shared/linkdb/transferRepo.ts
import Database from "better-sqlite3";
import crypto from "crypto";

export const LINKDB_PATH =
  process.env.LINKDB_PATH ||
  process.env.LINK_DB_PATH ||
  "./data/linkdb.sqlite";

const db = new Database(LINKDB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

function ensureSchema(): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS auth_transfer (
    code TEXT PRIMARY KEY,
    shm_user_id INTEGER NOT NULL,
    shm_session_id TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at INTEGER,
    ip TEXT,
    ua TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_auth_transfer_expires ON auth_transfer(expires_at);
  CREATE INDEX IF NOT EXISTS idx_auth_transfer_user ON auth_transfer(shm_user_id);
  `);
}

ensureSchema();

function genCode(): string {
  // 32 hex = 128-bit
  return crypto.randomBytes(16).toString("hex");
}

export type TransferError =
  | "code_not_found"
  | "code_already_used"
  | "code_expired";

export type CreateTransferArgs = {
  shmUserId: number;
  shmSessionId: string;
  ttlSeconds?: number;
  ip?: string;
  ua?: string;
};

export type CreateTransferResult = {
  code: string;
  expiresAt: number;
};

export type ConsumeTransferResult =
  | { ok: false; error: TransferError }
  | { ok: true; shmUserId: number; shmSessionId: string };

type AuthTransferRow = {
  code: string;
  shm_user_id: number;
  shm_session_id: string;
  expires_at: number;
  used_at: number | null;
};

function clampTtlSeconds(ttlSeconds: number): number {
  // Защита от “вечных” кодов или отрицательных значений.
  // Можно менять лимиты, но для transfer-login TTL 60s — идеал.
  const min = 10;
  const max = 5 * 60;
  if (!Number.isFinite(ttlSeconds)) return 60;
  return Math.max(min, Math.min(max, Math.floor(ttlSeconds)));
}

export function createTransfer({
  shmUserId,
  shmSessionId,
  ttlSeconds = 60,
  ip = "",
  ua = "",
}: CreateTransferArgs): CreateTransferResult {
  const now = Date.now();
  const ttl = clampTtlSeconds(ttlSeconds);
  const expiresAt = now + ttl * 1000;

  const stmt = db.prepare(
    `INSERT INTO auth_transfer(code, shm_user_id, shm_session_id, created_at, expires_at, ip, ua)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );

  // На всякий случай избегаем коллизий
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    try {
      stmt.run(code, shmUserId, shmSessionId, now, expiresAt, ip, ua);
      return { code, expiresAt };
    } catch (err: unknown) {
      // collision -> retry (или любой другой constraint issue)
      // Если хочешь — можем добавить проверку err instanceof Error && /UNIQUE/.test(err.message)
    }
  }

  throw new Error("transfer_code_generation_failed");
}

export function consumeTransfer(code: string): ConsumeTransferResult {
  const now = Date.now();

  const selectStmt = db.prepare(
    `SELECT code, shm_user_id, shm_session_id, expires_at, used_at
     FROM auth_transfer
     WHERE code = ?`
  );

  const markUsedStmt = db.prepare(
    `UPDATE auth_transfer
     SET used_at = ?
     WHERE code = ? AND used_at IS NULL`
  );

  const tx = db.transaction((c: string): ConsumeTransferResult => {
    const row = selectStmt.get(c) as AuthTransferRow | undefined;

    if (!row) return { ok: false, error: "code_not_found" };
    if (row.used_at) return { ok: false, error: "code_already_used" };
    if (Number(row.expires_at) < now) return { ok: false, error: "code_expired" };

    const res = markUsedStmt.run(now, c);
    // Если вдруг параллельно кто-то успел использовать — корректно вернём used.
    if (res.changes !== 1) return { ok: false, error: "code_already_used" };

    return {
      ok: true,
      shmUserId: Number(row.shm_user_id),
      shmSessionId: String(row.shm_session_id),
    };
  });

  return tx(code);
}

/**
 * Чистка мусора:
 * - used-коды держим сутки для диагностики (можно 0)
 * - expired-коды можно чистить сразу
 */
export function cleanupTransfers(opts?: {
  keepUsedMs?: number;
  deleteExpiredOlderThanMs?: number;
}): void {
  const now = Date.now();
  const keepUsedMs = opts?.keepUsedMs ?? 24 * 3600 * 1000; // 24h
  const deleteExpiredOlderThanMs = opts?.deleteExpiredOlderThanMs ?? 0;

  db.prepare(
    `DELETE FROM auth_transfer
     WHERE used_at IS NOT NULL AND used_at < ?`
  ).run(now - keepUsedMs);

  db.prepare(
    `DELETE FROM auth_transfer
     WHERE used_at IS NULL AND expires_at < ?`
  ).run(now - deleteExpiredOlderThanMs);
}
