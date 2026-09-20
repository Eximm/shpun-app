// Bell/attention regression for Monitoring 2.0.
//
// Verifies the real chain:
//   active monitoring incident -> countActiveIncidents -> attention.monitoring
//   -> attention.total -> SupportBell badge (data.attention.total).
// Also guards against counting an incident once per affected node and confirms
// that resolving an incident decreases attention.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

/* ── SHM stub (admin.status only) ────────────────────────────────────────── */
const shm = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const params = new URLSearchParams(body);
    const action = params.get("action");
    const sessionId = params.get("session_id");
    res.setHeader("content-type", "application/json");
    if (action === "admin.status") {
      return res.end(JSON.stringify({ is_admin: sessionId === "shm-admin" ? 1 : 0 }));
    }
    return res.end(JSON.stringify({ ok: 1 }));
  });
});
await new Promise<void>((resolve) => shm.listen(0, "127.0.0.1", resolve));
const shmPort = (shm.address() as { port: number }).port;

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-bell-"));
process.env.SHM_BASE = `http://127.0.0.1:${shmPort}/shm/`;
process.env.NODE_ENV = "development";

const Fastify = (await import("fastify")).default;
const { adminRoutes } = await import("./routes.js");
const { putSession } = await import("../../shared/session/sessionStore.js");
const { evaluateServerIncidents } = await import("../serverStatus/incidents.js");
const { resolveIncident, countActiveIncidents, findActiveIncident } = await import("../serverStatus/incidentsRepo.js");
const { DEFAULT_THRESHOLDS } = await import("../serverStatus/settingsRepo.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 900, login: "admin", createdAt: Date.now() });

const app = Fastify();
await app.register(async (api) => { await adminRoutes(api); }, { prefix: "/api" });

function get() {
  return app.inject({ method: "GET", url: "/api/admin/overview", headers: { "x-app-sid": "sid-admin" } });
}

const thresholds = { ...DEFAULT_THRESHOLDS, recoveryChecks: 1, reminderSec: 3600 };
const T0 = 1_700_000_000;

// Two separate servers, one confirmed warning incident each.
for (const serverId of [7001, 7002]) {
  evaluateServerIncidents({
    serverId,
    serverTitle: `node-${serverId}`,
    ts: T0,
    thresholds,
    rules: [
      { ruleType: "offline", severity: "warning", active: true, hold: true, value: null, threshold: 1, confirmAfterChecks: 1, message: "down" },
    ],
  });
}

test("two active incidents produce attention.monitoring = 2 (one per incident)", async () => {
  assert.equal(countActiveIncidents().total, 2);
  const res = await get();
  assert.equal(res.statusCode, 200);
  const json = res.json();
  assert.equal(json.attention.monitoring, 2);
  assert.ok(json.attention.total >= 2, "monitoring must be part of the bell total");
  assert.equal(json.system.incidents, 2);
});

test("resolving an incident decreases attention", async () => {
  const active = findActiveIncident(7001, "offline")!;
  resolveIncident(active.id, T0 + 60);

  assert.equal(countActiveIncidents().total, 1);
  const res = await get();
  const json = res.json();
  assert.equal(json.attention.monitoring, 1);
  assert.equal(json.system.incidents, 1);
});

test("bell count does not multiply by affected node count", async () => {
  // 7002 still has a single active incident.
  assert.equal(countActiveIncidents().total, 1);
  const res = await get();
  assert.equal(res.json().attention.monitoring, 1);
});

test("SupportBell badge is wired to attention.total (static check)", () => {
  const src = readFileSync(path.join(process.cwd(), "..", "web", "src", "app", "layout", "SupportBell.tsx"), "utf8");
  assert.ok(src.includes("const count = data.attention.total"), "SupportBell must read attention.total");
});

test("adminOverview parses attention.monitoring from the API", () => {
  const src = readFileSync(path.join(process.cwd(), "..", "web", "src", "app", "notifications", "adminOverview.ts"), "utf8");
  assert.ok(src.includes("monitoring: toCount(response?.attention?.monitoring)"), "adminOverview must parse attention.monitoring");
});

test.after(async () => {
  await app.close();
  await new Promise<void>((resolve) => shm.close(() => resolve()));
  linkDb.close();
});