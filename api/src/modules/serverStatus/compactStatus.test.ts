// Compact-row regression: the admin monitored-servers response must carry the
// current normalized snapshot for every server in ONE request, so CPU/RAM/Disk/
// load/network are visible without expanding. Zero is a real value (not "—");
// a missing metric stays null.

import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-compact-"));
process.env.NODE_ENV = "development";

/* ── Fake Node Exporter ─────────────────────────────────────────────────── */
let tick = 0;
function metricsText() {
  tick += 1;
  const idle = 1000 + tick * 10;
  const user = 100 + tick * 10;
  const rx = 5_000_000 + tick * 1_000_000;
  const tx = 2_000_000 + tick * 1_000_000;
  return `
node_time_seconds ${1700000000 + tick}
node_boot_time_seconds 1699000000
node_cpu_seconds_total{cpu="0",mode="idle"} ${idle}
node_cpu_seconds_total{cpu="0",mode="user"} ${user}
node_cpu_seconds_total{cpu="0",mode="iowait"} 50
node_cpu_seconds_total{cpu="0",mode="system"} 100
node_load1 0.5
node_load5 0.4
node_load15 0.3
node_memory_MemTotal_bytes 1000
node_memory_MemAvailable_bytes 500
node_memory_SwapTotal_bytes 1000
node_memory_SwapFree_bytes 1000
node_filesystem_size_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"} 1000
node_filesystem_avail_bytes{device="/dev/sda1",fstype="ext4",mountpoint="/"} 500
node_filesystem_files{device="/dev/sda1",fstype="ext4",mountpoint="/"} 1000
node_filesystem_files_free{device="/dev/sda1",fstype="ext4",mountpoint="/"} 400
node_network_receive_bytes_total{device="eth0"} ${rx}
node_network_transmit_bytes_total{device="eth0"} ${tx}
node_network_speed_bytes{device="eth0"} 125000000
`;
}
const exporter = http.createServer((_req, res) => {
  res.setHeader("content-type", "text/plain");
  res.end(metricsText());
});
await new Promise<void>((resolve) => exporter.listen(0, "127.0.0.1", resolve));
const exporterPort = (exporter.address() as { port: number }).port;

const Fastify = (await import("fastify")).default;
const { serverStatusRoutes } = await import("./routes.js");
const { setServerStatusAdminChecker } = await import("./adminGuard.js");
const { createMonitoredServer } = await import("./repo.js");
const { requestManualServerStatusRefresh } = await import("./monitor.js");
const { listMonitoredServers } = await import("./repo.js");
const { putSession } = await import("../../shared/session/sessionStore.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 901, login: "admin", createdAt: Date.now() });
setServerStatusAdminChecker(async (shmSessionId) => shmSessionId === "shm-admin");

const created = createMonitoredServer({
  title: "Compact Node",
  host: "127.0.0.1",
  exporterUrl: `http://127.0.0.1:${exporterPort}/metrics`,
  kind: "vpn",
  countryCode: "PL",
  uplinkMbps: 1000,
});
assert.equal(created.ok, true);

// Two cycles so CPU busy / network rate have a previous sample.
await requestManualServerStatusRefresh(listMonitoredServers());
await requestManualServerStatusRefresh(listMonitoredServers());

const app = Fastify();
await app.register(async (api) => { await serverStatusRoutes(api); }, { prefix: "/api" });

async function list() {
  const res = await app.inject({ method: "GET", url: "/api/admin/monitored-servers", headers: { "x-app-sid": "sid-admin" } });
  assert.equal(res.statusCode, 200);
  return res.json();
}

test("admin list returns current metrics for every server without expansion", async () => {
  const body = await list();
  const item = body.items.find((i: any) => i.title === "Compact Node");
  assert.ok(item, "server present");
  assert.ok(item.current, "current snapshot must be present without expansion");
  assert.equal(item.current.online, true);
});

test("compact metrics are populated from the current snapshot", async () => {
  const item = (await list()).items.find((i: any) => i.title === "Compact Node");
  const c = item.current;
  assert.equal(typeof c.cpuLoadPct, "number");
  assert.equal(c.memoryLoadPct, 50);
  assert.equal(c.diskLoadPct, 50);
  assert.equal(c.load1, 0.5);
  assert.equal(typeof c.rxMbps, "number");
  assert.ok(c.rxMbps >= 0);
  assert.equal(typeof c.txMbps, "number");
  assert.equal(typeof c.uptimeSeconds, "number");
  assert.ok(typeof c.checkedAt === "string" && c.checkedAt.length > 0);
});

test("a real zero metric is preserved as 0 (not null / missing)", async () => {
  const item = (await list()).items.find((i: any) => i.title === "Compact Node");
  // swap free == total -> 0% used
  assert.equal(item.current.swapLoadPct, 0);
});

test("metrics absent from the exporter stay null", async () => {
  const item = (await list()).items.find((i: any) => i.title === "Compact Node");
  // no node_filefd_allocated in the payload
  assert.equal(item.current.fileDescriptors, null);
});

test("one request carries all servers (no per-server fan-out)", async () => {
  createMonitoredServer({ title: "No Exporter", host: "no-exporter.example", kind: "gateway", visibility: "admin_only", nodeExporterEnabled: false });
  const res = await app.inject({ method: "GET", url: "/api/admin/monitored-servers", headers: { "x-app-sid": "sid-admin" } });
  const body = res.json();
  assert.equal(body.items.length, 2);
  assert.ok(body.items.every((i: any) => "current" in i));
});

test.after(async () => {
  await app.close();
  await new Promise<void>((resolve) => exporter.close(() => resolve()));
  linkDb.close();
});