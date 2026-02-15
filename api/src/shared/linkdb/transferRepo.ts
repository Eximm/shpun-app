// api/src/shared/linkdb/transferRepo.ts
import Database from "better-sqlite3";
import crypto from "crypto";

const DB_PATH =
  process.env.LINKDB_PATH ||
  process.env.LINK_DB_PATH ||
  "./data/linkdb.sqlite";

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

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

function genCode(): string {
  // 32 hex = 128-bit
  return crypto.randomBytes(16).toString("hex");
}

export type TransferError = "code_not_found" | "code_already_used" | "code_expired";

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

export function createTransfer({
  shmUserId,
  shmSessionId,
  ttlSeconds = 60,
  ip = "",
  ua = "",
}: CreateTransferArgs): CreateTransferResult {
  const now = Date.now();
  const expiresAt = now + ttlSeconds * 1000;

  // На всякий случай избегаем коллизий
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    try {
      db.prepare(
        `INSERT INTO auth_transfer(code, shm_user_id, shm_session_id, created_at, expires_at, ip, ua)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      ).run(code, shmUserId, shmSessionId, now, expiresAt, ip, ua);

      return { code, expiresAt };
    } catch {
      // collision -> retry
    }
  }

  throw new Error("transfer_code_generation_failed");
}

export function consumeTransfer(code: string): ConsumeTransferResult {
  const now = Date.now();

  const tx = db.transaction((c: string): ConsumeTransferResult => {
    const row = db
      .prepare(
        `SELECT code, shm_user_id, shm_session_id, expires_at, used_at
         FROM auth_transfer
         WHERE code = ?`
      )
      .get(c) as
      | {
          code: string;
          shm_user_id: number;
          shm_session_id: string;
          expires_at: number;
          used_at: number | null;
        }
      | undefined;

    if (!row) return { ok: false, error: "code_not_found" };
    if (row.used_at) return { ok: false, error: "code_already_used" };
    if (Number(row.expires_at) < now) return { ok: false, error: "code_expired" };

    db.prepare(`UPDATE auth_transfer SET used_at = ? WHERE code = ?`).run(now, c);

    return {
      ok: true,
      shmUserId: Number(row.shm_user_id),
      shmSessionId: String(row.shm_session_id),
    };
  });

  return tx(code);
}

// опционально: чистка протухшего мусора (можно дергать при старте/по крону)
export function cleanupTransfers(): void {
  const now = Date.now();
  db.prepare(
    `DELETE FROM auth_transfer
     WHERE expires_at < ? OR used_at IS NOT NULL`
  ).run(now - 24 * 3600 * 1000);
}
