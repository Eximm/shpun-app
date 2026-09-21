// Monitoring 2.0 stabilization regression:
//   - only the background collector scrapes; GET endpoints are pure DB reads;
//   - monitoring_current is canonical and survives a "restart" (no memory);
//   - transient scrape failures keep last-known metrics, stale then offline;
//   - collector lease blocks a second scraper.

import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-lifecycle-"));
process.env.NODE_ENV = "development";
process.env.SHPUN_CREDENTIALS_MASTER_KEY = "lifecycle-test-master-key";

/* ── SHM stub for ensureAdmin ───────────────────────────────────────────── */
const shm = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const params = new URLSearchParams(body);
    res.setHeader("content-type", "application/json");
    if (params.get("action") === "admin.status") {
      return res.end(JSON.stringify({ is_admin: params.get("session_id") === "shm-admin" ? 1 : 0 }));
    }
    return res.end(JSON.stringify({ ok: 1 }));
  });
});
await new Promise<void>((resolve) => shm.listen(0, "127.0.0.1", resolve));
process.env.SHM_BASE = `http://127.0.0.1:${(shm.address() as { port: number }).port}/shm/`;

/* ── Fake Node Exporter with request counter + controllable failure ─────── */
let exporterRequests = 0;
let exporterHealthy = true;
function metricsText() {
  return `
node_time_seconds 1700000000
node_boot_time_seconds 1699000000
node_cpu_seconds_total{cpu="0",mode="idle"} 1000
node_cpu_seconds_total{cpu="0",mode="user"} 200
node_cpu_seconds_total{cpu="0",mode="iowait"} 50
node_cpu_seconds_total{cpu="0",mode="system"} 100
node_load1 0.5
node_memory_MemTotal_bytes 1000
node_memory_MemAvailable_bytes 500
node_filesystem_size_bytes{fstype="ext4",mountpoint="/"} 1000
node_filesystem_avail_bytes{fstype="ext4",mountpoint="/"} 500
node_network_receive_bytes_total{device="eth0"} 5000000
node_network_transmit_bytes_total{device="eth0"} 2000000
`;
}
const exporter = http.createServer((_req, res) => {
  exporterRequests += 1;
  if (!exporterHealthy) {
    // Emulate an unreachable exporter without waiting on a real timeout.
    res.destroy();
    return;
  }
  res.setHeader("content-type", "text/plain");
  res.end(metricsText());
});
await new Promise<void>((resolve) => exporter.listen(0, "127.0.0.1", resolve));
const exporterUrl = `http://127.0.0.1:${(exporter.address() as { port: number }).port}/metrics`;

/* ── App ─────────────────────────────────────────────────────────────────── */
const Fastify = (await import("fastify")).default;
const { serverStatusRoutes } = await import("./routes.js");
const { adminRoutes } = await import("../admin/routes.js");
const { setServerStatusAdminChecker } = await import("./adminGuard.js");
const { createMonitoredServer, listMonitoredServers, getMonitoredServer } = await import("./repo.js");
const { requestServerStatusRefresh, getServerStatusSnapshot, getCollectorObservability, stopServerStatusMonitor } = await import("./monitor.js");
const { upsertCurrent, getCurrent } = await import("./currentRepo.js");
const { acquireCollectorLease, collectorLeaseOwner } = await import("./collectorLock.js");
const { putSession } = await import("../../shared/session/sessionStore.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 901, login: "admin", createdAt: Date.now() });
setServerStatusAdminChecker(async (shmSessionId) => shmSessionId === "shm-admin");

async function waitCollectorIdle(timeoutMs = 8000) {
  const start = Date.now();
  while (getCollectorObservability().collectorRunning) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 20));
  }
}

test("only the collector scrapes; GET endpoints are pure DB reads", async () => {
  const created = createMonitoredServer({
    title: "Idle Node",
    host: "127.0.0.1",
    exporterUrl,
    kind: "vpn",
    countryCode: "PL",
    uplinkMbps: 1000,
  });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;

  const app = Fastify();
  await app.register(async (api) => { await serverStatusRoutes(api); await adminRoutes(api); }, { prefix: "/api" });

  // Startup must run an immediate cycle, then go idle.
  await waitCollectorIdle();
  const afterStartup = exporterRequests;
  assert.ok(afterStartup >= 1, "startup immediate cycle should scrape once");

  const baseline = exporterRequests;
  const h = { "x-app-sid": "sid-admin" };
  await app.inject({ method: "GET", url: "/api/health" });
  await app.inject({ method: "GET", url: "/api/server-status", headers: h });
  await app.inject({ method: "GET", url: "/api/admin/monitored-servers", headers: h });
  await app.inject({ method: "GET", url: `/api/admin/monitoring/servers/${id}/detail`, headers: h });
  await app.inject({ method: "GET", url: "/api/admin/overview", headers: h });
  await app.inject({ method: "GET", url: "/api/admin/monitoring/summary", headers: h });
  await new Promise((r) => setTimeout(r, 50));

  assert.equal(exporterRequests, baseline, "read-only endpoints must not scrape");

  // Config mutations must not scrape either.
  await app.inject({ method: "PUT", url: `/api/admin/monitored-servers/${id}`, headers: h, payload: { title: "Idle Node 2" } });
  await app.inject({ method: "POST", url: "/api/admin/monitored-servers", headers: h, payload: { title: "New", host: "127.0.0.1", kind: "vpn", nodeExporterEnabled: false } });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(exporterRequests, baseline, "create/edit must not scrape");
  const created2 = listMonitoredServers({ includeInactive: true }).find((s) => s.title === "New");
  if (created2) await app.inject({ method: "DELETE", url: `/api/admin/monitored-servers/${created2.id}`, headers: h });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(exporterRequests, baseline, "delete must not scrape");

  await app.close();
  stopServerStatusMonitor();
});

test("monitoring_current is canonical and survives a process restart (no memory)", () => {
  const row = listMonitoredServers().find((s) => s.title === "Idle Node 2");
  assert.ok(row);
  const prev = getCurrent(row!.id);
  assert.ok(prev, "collector should have persisted current");

  // Simulate a fresh process: no in-memory snapshot exists. Reads must come
  // from SQLite and still show the last known values + freshness.
  const check = getServerStatusSnapshot([row!])[0];
  assert.equal(check.online, true);
  assert.equal(check.memoryLoadPct, 50);
  assert.equal(typeof check.load1, "number");
  assert.equal(check.state, "fresh");
  assert.ok(check.checkedAt);
});

test("a manually seeded current row is served without any cycle", () => {
  const created = createMonitoredServer({ title: "Cold Start", host: "cold.example", kind: "vpn", nodeExporterEnabled: false });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;

  upsertCurrent({
    serverId: id, updatedAt: 1, lastAttemptAt: 1, lastSuccessAt: 1, state: "fresh", online: true, stale: false,
    consecutiveFailures: 0, lastErrorCode: null, cpuPct: 42, iowaitPct: null, load1: 0.1, load5: null, load15: null,
    cpuCores: 4, memoryUsedPct: 33, memoryTotalBytes: null, memoryAvailableBytes: null, swapUsedPct: 0,
    diskUsedPct: 12, diskFreeBytes: null, inodeUsedPct: null, rxBps: null, txBps: null, uplinkUsedPct: null,
    uplinkCapacityBps: null, uplinkCapacitySource: "unknown",
    rxDropsDelta: null, txDropsDelta: null, rxErrorsDelta: null, txErrorsDelta: null, systemUptimeSec: 100,
    rebootDetected: false, nodeExporterStatus: "disabled", nodeExporterLatencyMs: null, remnawaveStatus: "disabled",
    onlineUsers: null, fileDescriptors: null, sockets: null, source: "none", checkedAt: "2024-01-01T00:00:00.000Z",
  });

  const check = getServerStatusSnapshot([getMonitoredServer(id)!])[0];
  assert.equal(check.cpuLoadPct, 42);
  assert.equal(check.memoryLoadPct, 33);
  assert.equal(check.swapLoadPct, 0);
  assert.equal(check.state, "fresh");
});

test("transient failure keeps last-known metrics; confirmed offline after threshold", async () => {
  const created = createMonitoredServer({ title: "Flaky", host: "127.0.0.1", exporterUrl, kind: "vpn", nodeExporterEnabled: true });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;

  const rows = () => listMonitoredServers();

  // Success first.
  exporterHealthy = true;
  await requestServerStatusRefresh(rows(), undefined, { force: true });
  let check = getServerStatusSnapshot([getMonitoredServer(id)!])[0];
  assert.equal(check.state, "fresh");
  assert.equal(check.memoryLoadPct, 50);
  const memAfterSuccess = check.memoryLoadPct;

  // Failure 1 + 2: stale, still online, last-known metrics preserved.
  exporterHealthy = false;
  await requestServerStatusRefresh(rows(), undefined, { force: true });
  check = getServerStatusSnapshot([getMonitoredServer(id)!])[0];
  assert.equal(check.consecutiveFailures, 1);
  assert.equal(check.online, true);
  assert.equal(check.state, "stale");
  assert.equal(check.memoryLoadPct, memAfterSuccess, "last known metric preserved");

  await requestServerStatusRefresh(rows(), undefined, { force: true });
  check = getServerStatusSnapshot([getMonitoredServer(id)!])[0];
  assert.equal(check.consecutiveFailures, 2);
  assert.equal(check.online, true);
  assert.equal(check.state, "stale");

  // Failure 3 confirms offline (default offlineFailChecks = 3).
  await requestServerStatusRefresh(rows(), undefined, { force: true });
  check = getServerStatusSnapshot([getMonitoredServer(id)!])[0];
  assert.equal(check.consecutiveFailures, 3);
  assert.equal(check.online, false);
  assert.equal(check.state, "offline");
  assert.equal(check.memoryLoadPct, memAfterSuccess, "metrics still preserved while offline");

  // Recovery resets failures.
  exporterHealthy = true;
  await requestServerStatusRefresh(rows(), undefined, { force: true });
  check = getServerStatusSnapshot([getMonitoredServer(id)!])[0];
  assert.equal(check.consecutiveFailures, 0);
  assert.equal(check.online, true);
  assert.equal(check.state, "fresh");
  exporterHealthy = true;
});

test("collector lease blocks a second scraper while alive", () => {
  // This process owns the lease after the cycles above.
  const owner = collectorLeaseOwner();
  assert.ok(owner);
  linkDb
    .prepare(`UPDATE monitoring_collector_lease SET owner = 'another-instance', expires_at = ? WHERE id = 1`)
    .run(Math.floor(Date.now() / 1000) + 3600);
  assert.equal(acquireCollectorLease(60), false, "alive foreign lease must block acquisition");

  // Expired lease can be taken over.
  linkDb
    .prepare(`UPDATE monitoring_collector_lease SET owner = 'another-instance', expires_at = ? WHERE id = 1`)
    .run(Math.floor(Date.now() / 1000) - 1);
  assert.equal(acquireCollectorLease(60), true, "expired lease is recoverable");
});

test("one normalized snapshot feeds current, history and incidents", () => {
  const row = listMonitoredServers().find((s) => s.title === "Flaky");
  assert.ok(row);
  const samples = linkDb.prepare(`SELECT COUNT(*) AS c FROM monitoring_samples WHERE server_id = ?`).get(row!.id) as { c: number };
  assert.ok(samples.c >= 5, "history sample appended per cycle");
  const current = getCurrent(row!.id);
  assert.ok(current, "current persisted from the same snapshot");
});

test.after(async () => {
  stopServerStatusMonitor();
  linkDb.close();
  await new Promise<void>((resolve) => exporter.close(() => resolve()));
  await new Promise<void>((resolve) => shm.close(() => resolve()));
});