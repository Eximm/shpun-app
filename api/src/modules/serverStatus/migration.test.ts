// Migration regression: a legacy database (old monitored_servers schema) must
// upgrade in place, be idempotent, and create indexes only after columns exist.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-migration-"));
process.env.DATA_DIR = DATA_DIR;
process.env.NODE_ENV = "development";

const Database = (await import("better-sqlite3")).default;

// Build the legacy schema BEFORE the monitoring module is imported.
const legacy = new Database(path.join(DATA_DIR, "linkdb.sqlite"));
legacy.exec(`
CREATE TABLE monitored_servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  host TEXT NOT NULL DEFAULT '',
  exporter_url TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'vpn',
  country_code TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 100,
  uplink_mbps REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
INSERT INTO monitored_servers (title, host, exporter_url, kind, country_code, active)
VALUES ('Legacy Node', 'legacy.example', 'http://legacy.example:9100/metrics', 'vpn', 'SE', 1);
INSERT INTO monitored_servers (title, host, exporter_url, kind, country_code, active)
VALUES ('Legacy Core', 'core.example', 'http://core.example:9100/metrics', 'infra', 'DE', 1);
INSERT INTO monitored_servers (title, host, exporter_url, kind, country_code, active)
VALUES ('Legacy Gateway', 'gw.example', 'http://gw.example:9100/metrics', 'gateway', 'NL', 1);
`);
legacy.close();

const repo = await import("./repo.js");
// Importing the repositories triggers creation of the Monitoring 2.0 tables
// (the same modules are imported by the app at startup).
await import("./historyRepo.js");
await import("./incidentsRepo.js");
await import("./settingsRepo.js");
await import("./collectorLock.js");
const { aggregateHealthStatus } = await import("./health.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

function columns(table: string) {
  return new Set((linkDb.prepare(`PRAGMA table_info(${table})`).all() as any[]).map((c) => String(c.name)));
}

test("legacy rows survive the migration", () => {
  const row = repo.getMonitoredServer(1);
  assert.ok(row);
  assert.equal(row!.title, "Legacy Node");
  assert.equal(row!.host, "legacy.example");
  assert.equal(repo.listMonitoredServers().length, 3);
});

test("upgrade keeps legacy visibility public for every kind", () => {
  // Before Monitoring 2.0 the public /server-status showed VPN *and* infra.
  // The upgrade must not change that composition.
  for (const id of [1, 2, 3]) {
    assert.equal(repo.getMonitoredServer(id)!.visibility, "public");
    assert.equal(repo.getMonitoredServer(id)!.affects_public_health, 1);
  }
});

test("legacy infra remains visible in the public server list", () => {
  const publicTitles = repo.listPublicServers().map((s) => s.title).sort();
  assert.deepEqual(publicTitles, ["Legacy Core", "Legacy Gateway", "Legacy Node"]);
});

test("a new admin_only gateway is excluded from the public list", () => {
  const created = repo.createMonitoredServer({
    title: "Reality Gateway RU",
    host: "reality-gw.internal",
    kind: "gateway",
    visibility: "admin_only",
    affectsPublicHealth: true,
    nodeExporterEnabled: false,
  });
  assert.equal(created.ok, true);

  const publicTitles = repo.listPublicServers().map((s) => s.title);
  assert.equal(publicTitles.includes("Reality Gateway RU"), false);
  assert.equal(JSON.stringify(repo.listPublicServers()).includes("reality-gw.internal"), false);
});

test("admin_only gateway with affects=true changes aggregate health without leaking identity", () => {
  const health = repo.listHealthServers();
  assert.ok(health.some((s) => s.title === "Reality Gateway RU"), "hidden gateway must affect health");

  const status = aggregateHealthStatus(
    health.map((s) => ({
      kind: s.kind,
      online: s.title === "Reality Gateway RU" ? false : true,
      visibility: s.visibility,
      affectsPublicHealth: s.affects_public_health === 1,
    })),
  );
  assert.notEqual(status, "ok");

  // Public payload never contains the hidden host / count / details.
  const publicPayload = JSON.stringify(repo.listPublicServers());
  assert.equal(publicPayload.includes("Reality Gateway RU"), false);
  assert.equal(publicPayload.includes("reality-gw.internal"), false);
});

test("an explicitly chosen visibility is preserved across later operations", () => {
  const created = repo.createMonitoredServer({ title: "Flipper", host: "flipper.example", kind: "infra", nodeExporterEnabled: false });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;

  repo.updateMonitoredServer(id, { visibility: "admin_only" });
  assert.equal(repo.getMonitoredServer(id)!.visibility, "admin_only");

  // Any later repo activity (simulating the next startup / admin actions) must
  // not revert the explicit choice.
  repo.createMonitoredServer({ title: "Other", host: "other.example", nodeExporterEnabled: false });
  assert.equal(repo.getMonitoredServer(id)!.visibility, "admin_only");

  repo.updateMonitoredServer(id, { visibility: "public" });
  assert.equal(repo.getMonitoredServer(id)!.visibility, "public");
});

test("all Monitoring 2.0 columns are added", () => {
  const cols = columns("monitored_servers");
  for (const name of [
    "visibility",
    "affects_public_health",
    "node_exporter_enabled",
    "exporter_auth_type",
    "exporter_username",
    "exporter_password_encrypted",
    "remnawave_integration_id",
    "remnawave_node_uuid",
    "thresholds_json",
  ]) {
    assert.ok(cols.has(name), `missing column ${name}`);
  }
});

test("legacy rows get safe defaults (public, affects health, exporter enabled)", () => {
  const row = repo.getMonitoredServer(1)!;
  assert.equal(row.visibility, "public");
  assert.equal(row.affects_public_health, 1);
  assert.equal(row.node_exporter_enabled, 1);
  assert.equal(row.exporter_auth_type, "none");
});

test("new monitoring tables exist", () => {
  const tables = new Set(
    (linkDb.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as any[]).map((t) => String(t.name)),
  );
  for (const name of [
    "monitoring_samples",
    "monitoring_aggregates",
    "monitoring_incidents",
    "monitoring_events",
    "monitoring_settings",
    "monitoring_collector_lease",
  ]) {
    assert.ok(tables.has(name), `missing table ${name}`);
  }
});

test("indexes are created after the columns they reference", () => {
  const indexes = new Set(
    (linkDb.prepare(`SELECT name FROM sqlite_master WHERE type='index'`).all() as any[]).map((i) => String(i.name)),
  );
  assert.ok(indexes.has("idx_monitored_servers_visibility_active"));
  assert.ok(indexes.has("idx_monitored_servers_remnawave"));
});

test("re-running a migration column add is caught (idempotent)", () => {
  let threw = false;
  try {
    linkDb.exec(`ALTER TABLE monitored_servers ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public'`);
  } catch {
    threw = true;
  }
  assert.equal(threw, true, "duplicate ADD COLUMN should throw and be swallowed by addColumn()");
  // The database is still usable.
  assert.ok(repo.listMonitoredServers().length >= 3);
});

test("the upgrade contains no blanket visibility backfill (static guard)", async () => {
  const src = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("./repo.ts", import.meta.url), "utf8"),
  );
  assert.equal(src.includes("SET visibility = 'admin_only'"), false, "no blanket infra->admin_only migration allowed");
  assert.equal(src.includes("legacy_visibility_backfill"), false, "no legacy visibility backfill allowed");
});

test("new rows can be created with Monitoring 2.0 fields", () => {
  const created = repo.createMonitoredServer({
    title: "New",
    host: "new.example",
    kind: "gateway",
    visibility: "admin_only",
    affectsPublicHealth: true,
    nodeExporterEnabled: false,
  });
  assert.equal(created.ok, true);
  assert.equal(created.ok ? created.item.kind : "", "gateway");
  assert.equal(created.ok ? created.item.visibility : "", "admin_only");
});

test.after(() => {
  linkDb.close();
});