// Admin incident API regression: active/history, filters, pagination, summary
// semantics, admin-only, and safe server-name snapshot for deleted servers.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-incident-api-"));
process.env.NODE_ENV = "development";

const Fastify = (await import("fastify")).default;
const { serverStatusRoutes } = await import("./routes.js");
const { setServerStatusAdminChecker } = await import("./adminGuard.js");
const { createMonitoredServer, deleteMonitoredServer } = await import("./repo.js");
const { evaluateServerIncidents } = await import("./incidents.js");
const { resolveIncident, findActiveIncident, countActiveIncidents } = await import("./incidentsRepo.js");
const { DEFAULT_THRESHOLDS } = await import("./settingsRepo.js");
const { putSession } = await import("../../shared/session/sessionStore.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 901, login: "admin", createdAt: Date.now() });
putSession("sid-user", { shmSessionId: "shm-user", shmUserId: 302, login: "user", createdAt: Date.now() });
setServerStatusAdminChecker(async (shmSessionId) => shmSessionId === "shm-admin");

const app = Fastify();
await app.register(async (api) => { await serverStatusRoutes(api); }, { prefix: "/api" });

const thresholds = { ...DEFAULT_THRESHOLDS, recoveryChecks: 1 };
const T0 = Math.floor(Date.now() / 1000) - 3600;

function headers(sid: string) {
  return { "x-app-sid": sid };
}

// Server A: warning incident, Server B: critical incident.
const a = createMonitoredServer({ title: "Frankfurt-2", host: "f2.example", kind: "vpn", nodeExporterEnabled: false });
const b = createMonitoredServer({ title: "Prague", host: "prg.example", kind: "vpn", nodeExporterEnabled: false });
assert.equal(a.ok && b.ok, true);
const aId = a.ok ? a.item.id : 0;
const bId = b.ok ? b.item.id : 0;

evaluateServerIncidents({
  serverId: aId, serverTitle: "Frankfurt-2", serverKind: "vpn", ts: T0, thresholds,
  rules: [{ ruleType: "uplink_saturation", severity: "warning", active: true, hold: true, value: 100, threshold: 90, confirmAfterChecks: 1, message: "Канал загружен", context: { rxBps: 100_000_000, txBps: 20_000_000, capacityBps: 125_000_000, capacitySource: "configured", calculatedPct: 100, threshold: 90 } }],
});
evaluateServerIncidents({
  serverId: bId, serverTitle: "Prague", serverKind: "vpn", ts: T0, thresholds,
  rules: [{ ruleType: "offline", severity: "critical", active: true, hold: true, value: null, threshold: 3, confirmAfterChecks: 1, message: "Недоступен" }],
});

async function incidents(query = "") {
  const res = await app.inject({ method: "GET", url: `/api/admin/monitoring/incidents${query}`, headers: headers("sid-admin") });
  assert.equal(res.statusCode, 200);
  return res.json();
}

test("incident endpoint is admin-only", async () => {
  const anon = await app.inject({ method: "GET", url: "/api/admin/monitoring/incidents" });
  assert.equal(anon.statusCode, 401);
  const user = await app.inject({ method: "GET", url: "/api/admin/monitoring/incidents", headers: headers("sid-user") });
  assert.equal(user.statusCode, 403);
});

test("active list matches summary counts and carries server snapshot", async () => {
  const body = await incidents("?status=active");
  assert.equal(body.active.length, 2);
  assert.equal(body.counts.total, 2);
  assert.equal(body.counts.total, body.active.length, "summary count must equal active list length");
  const f2 = body.active.find((i: any) => i.serverTitle === "Frankfurt-2");
  assert.ok(f2);
  assert.equal(f2.ruleType, "uplink_saturation");
  assert.equal(f2.severity, "warning");
  assert.equal(f2.value, 100);
  assert.equal(f2.threshold, 90);
  assert.equal(f2.state, "alerting");
  assert.equal(f2.context.capacitySource, "configured");
  assert.equal(f2.context.calculatedPct, 100);
  assert.equal(f2.context.capacityBps, 125_000_000);
  assert.equal(f2.triggerValue, 100);
  assert.equal(f2.peakValue, 100);
});

test("severity filter narrows the active list", async () => {
  const warn = await incidents("?status=active&severity=warning");
  assert.equal(warn.active.length, 1);
  assert.equal(warn.active[0].serverTitle, "Frankfurt-2");
  const crit = await incidents("?status=active&severity=critical");
  assert.equal(crit.active.length, 1);
  assert.equal(crit.active[0].serverTitle, "Prague");
});

test("resolved incidents move to history with duration", async () => {
  const active = findActiveIncident(aId, "uplink_saturation")!;
  resolveIncident(active.id, T0 + 300);

  const body = await incidents("?status=resolved");
  const row = body.history.find((i: any) => i.serverId === aId);
  assert.ok(row);
  assert.equal(row.resolvedAt, T0 + 300);
  assert.ok(row.durationSec >= 300);
  assert.equal(body.active.length, 1, "only Prague remains active");
  assert.equal(countActiveIncidents().total, 1);
});

test("pagination limit and offset are honored", async () => {
  const page1 = await incidents("?status=resolved&limit=1&offset=0");
  assert.equal(page1.history.length, 1);
  const page2 = await incidents("?status=resolved&limit=1&offset=1");
  assert.equal(page2.history.length, 0);
});

test("deleted server history keeps its name snapshot", async () => {
  assert.equal(deleteMonitoredServer(aId), true);
  const body = await incidents("?status=resolved");
  const row = body.history.find((i: any) => i.id != null && i.serverTitle === "Frankfurt-2");
  assert.ok(row, "history must survive server deletion with its name snapshot");
});

test.after(async () => {
  await app.close();
  linkDb.close();
});