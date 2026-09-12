import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

// ---------------------------------------------------------------------------
// Production upgrade-path regression test.
//
// The production bug: initialization created an index on support_tickets(kind)
// BEFORE the ALTER added the kind column. A legacy DB (created before
// TicketKind) therefore crashed with "no such column: kind".
//
// This test reproduces the legacy schema, then runs the SAME initialization
// used by the app (module import) and verifies the migration completes.
// ---------------------------------------------------------------------------

const dataDir = mkdtempSync(path.join(tmpdir(), "shpun-support-migration-"));
process.env.DATA_DIR = dataDir;

// 1. Simulate the legacy production DB: support_tickets WITHOUT `kind`.
const legacy = new Database(path.join(dataDir, "linkdb.sqlite"));
legacy.exec(`
CREATE TABLE support_tickets (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  public_no              TEXT NOT NULL UNIQUE,
  storage_provider       TEXT NOT NULL DEFAULT 'local',
  external_id            TEXT,
  migration_status       TEXT,
  migrated_at            TEXT,
  synced_at              TEXT,
  user_id                INTEGER NOT NULL,
  source                 TEXT NOT NULL DEFAULT 'app',
  category_key           TEXT NOT NULL,
  subject                TEXT,
  status                 TEXT NOT NULL DEFAULT 'open',
  priority               TEXT NOT NULL DEFAULT 'normal',
  assigned_to            INTEGER,
  service_id             INTEGER,
  user_service_id        INTEGER,
  service_category       TEXT,
  user_login_snapshot    TEXT,
  display_name_snapshot  TEXT,
  balance_snapshot       REAL,
  service_snapshot_json  TEXT,
  context_snapshot_json  TEXT,
  telegram_chat_id       INTEGER,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at        TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at              TEXT
);
INSERT INTO support_tickets(public_no, user_id, category_key, subject)
  VALUES ('1001', 4242, 'other', 'legacy ticket 1');
INSERT INTO support_tickets(public_no, user_id, category_key, subject)
  VALUES ('1002', 4242, 'other', 'legacy ticket 2');
`);
legacy.close();

// 2. Import the repository — this runs ensureSupportSchema() exactly like the app.
const repo = await import("./sqliteRepository.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

function ticketColumns(): string[] {
  return (linkDb.prepare(`PRAGMA table_info(support_tickets)`).all() as Array<{ name: string }>).map(
    (r) => String(r.name)
  );
}

function indexExists(name: string): boolean {
  const row = linkDb
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?`)
    .get(name);
  return Boolean(row);
}

test("legacy DB without kind migrates without crashing", () => {
  assert.ok(ticketColumns().includes("kind"), "kind column must be added");
  assert.ok(indexExists("idx_support_tickets_kind"), "kind index must exist after migration");
});

test("legacy rows are backfilled with kind='support'", () => {
  const rows = linkDb
    .prepare(`SELECT public_no, kind FROM support_tickets ORDER BY public_no`)
    .all() as Array<{ public_no: string; kind: string }>;

  assert.equal(rows.length, 2);
  assert.ok(rows.every((r) => r.kind === "support"), "existing tickets must become kind=support");
});

test("repository works after migration (read/create support+partnership)", () => {
  const legacyTicket = repo.sqliteTicketRepository.getTicketByPublicNo("1001");
  assert.ok(legacyTicket);
  assert.equal(legacyTicket!.kind, "support");

  const page = repo.sqliteTicketRepository.listUserTickets({ userId: 4242 });
  assert.equal(page.total, 2);

  const support = repo.sqliteTicketRepository.createTicket({
    userId: 4243,
    kind: "support",
    source: "app",
    categoryKey: "other",
  });
  assert.equal(support.kind, "support");
  assert.match(support.publicNo, /^\d+$/);

  const partnership = repo.sqliteTicketRepository.createTicket({
    userId: 4243,
    kind: "partnership",
    source: "app",
    categoryKey: "partnership",
  });
  assert.equal(partnership.kind, "partnership");
  assert.match(partnership.publicNo, /^P\d+$/);

  // Kind filter still works after migration.
  const proposals = repo.sqliteTicketRepository.listUserTickets({ userId: 4243, kind: "partnership" });
  assert.equal(proposals.total, 1);
});

test("re-running initialization (application restart) is idempotent", () => {
  repo.ensureSupportSchema();
  repo.ensureSupportSchema();

  const kindColumns = ticketColumns().filter((c) => c === "kind");
  assert.equal(kindColumns.length, 1, "no duplicate kind column");
  assert.ok(indexExists("idx_support_tickets_kind"));
});

test("second start on an already-migrated DB also passes", () => {
  // Simulate a process restart by re-running the full schema function again and
  // verifying reads/creates still work.
  repo.ensureSupportSchema();
  const ticket = repo.sqliteTicketRepository.createTicket({
    userId: 4244,
    kind: "support",
    source: "app",
    categoryKey: "other",
  });
  assert.ok(ticket.id > 0);
  assert.equal(repo.sqliteTicketRepository.getTicket(ticket.id)?.kind, "support");
});
