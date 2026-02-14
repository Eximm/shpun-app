import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
fs.mkdirSync(dataDir, { recursive: true });

export const linkDb = new Database(path.join(dataDir, "linkdb.sqlite"));
linkDb.pragma("journal_mode = WAL");
linkDb.pragma("synchronous = NORMAL");
linkDb.pragma("temp_store = MEMORY");
linkDb.pragma("busy_timeout = 5000");

linkDb.exec(`
CREATE TABLE IF NOT EXISTS account_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider TEXT NOT NULL,
  profile  TEXT NOT NULL,
  external_id TEXT NOT NULL,
  shm_user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at TEXT,
  meta_json TEXT,
  UNIQUE(provider, profile, external_id)
);

CREATE INDEX IF NOT EXISTS idx_account_links_user
  ON account_links(provider, profile, shm_user_id);
`);
