import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-server-status-"));

const Fastify = (await import("fastify")).default;
const { serverStatusRoutes } = await import("./routes.js");
const { setServerStatusAdminChecker } = await import("./adminGuard.js");
const { createMonitoredServer } = await import("./repo.js");
const { putSession } = await import("../../shared/session/sessionStore.js");

putSession("sid-user", { shmSessionId: "shm-user", shmUserId: 301, login: "user301", createdAt: Date.now() });
putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 901, login: "admin", createdAt: Date.now() });

setServerStatusAdminChecker(async (shmSessionId) => shmSessionId === "shm-admin");

const app = Fastify();
await app.register(
  async (api) => {
    await serverStatusRoutes(api);
  },
  { prefix: "/api" }
);

function headers(sid: string) {
  return { "x-app-sid": sid };
}

test("public health is reachable without a session", async () => {
  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 200);
});

test("public health returns an aggregated safe status", async () => {
  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  // No servers configured yet -> honest unknown, never a hardcoded green.
  assert.equal(body.status, "unknown");
  // Strict allowlist: nothing but the aggregate may be exposed publicly.
  assert.deepEqual(Object.keys(body).sort(), ["ok", "status", "updatedAt"]);
  assert.ok(["ok", "degraded", "down", "unknown"].includes(body.status));
  assert.ok(body.updatedAt === null || typeof body.updatedAt === "string");
});

test("public health never contains raw server fields", async () => {
  const created = createMonitoredServer({
    title: "Sensitive node",
    host: "internal-10-0-0-5.local",
    exporterUrl: "http://internal-10-0-0-5.local:9100/metrics",
    kind: "infra",
    countryCode: "DE",
  });
  assert.equal(created.ok, true);

  const response = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(response.statusCode, 200);
  const serialized = JSON.stringify(response.json());
  for (const forbidden of ["host", "exporter", "internal", "10.0.0.5", "metrics", "cpu", "ram", "memory"]) {
    assert.equal(serialized.toLowerCase().includes(forbidden.toLowerCase()), false, `health payload must not expose ${forbidden}`);
  }
});

test("user server-status payload is sanitized", async () => {
  const created = createMonitoredServer({
    title: "Test node",
    host: "127.0.0.1",
    exporterUrl: "http://127.0.0.1:9/metrics",
    kind: "vpn",
    countryCode: "PL",
  });
  assert.equal(created.ok, true);

  const response = await app.inject({ method: "GET", url: "/api/server-status", headers: headers("sid-user") });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.vpn));
  const item = body.vpn[0];
  assert.ok(item, "expected a public vpn item");
  assert.equal(item.title, "Test node");
  assert.equal(item.kind, "vpn");
  for (const forbidden of ["host", "exporter_url", "exporterUrl", "cpuLoadPct", "uplinkLoadPct", "memoryLoadPct", "rxMbps", "txMbps", "latencyMs", "uptimeSeconds"]) {
    assert.equal(Object.prototype.hasOwnProperty.call(item, forbidden), false, `payload must not expose ${forbidden}`);
  }
});

test("admin monitored-servers requires admin", async () => {
  const anon = await app.inject({ method: "GET", url: "/api/admin/monitored-servers" });
  assert.equal(anon.statusCode, 401);

  const nonAdmin = await app.inject({ method: "GET", url: "/api/admin/monitored-servers", headers: headers("sid-user") });
  assert.equal(nonAdmin.statusCode, 403);

  const admin = await app.inject({ method: "GET", url: "/api/admin/monitored-servers", headers: headers("sid-admin") });
  assert.equal(admin.statusCode, 200);
  assert.ok(admin.json().items.length >= 1);
  // Admin keeps the full diagnostic row (this is the admin-only source of truth).
  assert.equal(typeof admin.json().items[0].exporter_url, "string");
});

test("manual server-status refresh is admin-only", async () => {
  const nonAdmin = await app.inject({ method: "POST", url: "/api/server-status/refresh", headers: headers("sid-user") });
  assert.equal(nonAdmin.statusCode, 403);

  const admin = await app.inject({ method: "POST", url: "/api/server-status/refresh", headers: headers("sid-admin") });
  assert.equal(admin.statusCode, 200);
  assert.equal(admin.json().ok, true);
});

test.after(async () => {
  await app.close();
});

test("persisted redundancy config drives the header without exposing topology", async () => {
  const { linkDb } = await import("../../shared/linkdb/db.js");
  const { updateMonitoredServer, getMonitoredServer } = await import("./repo.js");
  linkDb.prepare("UPDATE monitored_servers SET affects_public_health = 0").run();
  const ids: number[] = [];
  for (const city of ["SPB", "MSK"]) {
    const created = createMonitoredServer({ host: `${city}.internal`, kind: "gateway", visibility: "admin_only", healthGroup: "app-mirrors" });
    assert.ok(created.ok);
    ids.push(created.item.id);
  }
  const now = Math.floor(Date.now() / 1000);
  for (const [i, id] of ids.entries()) {
    linkDb.prepare(`INSERT INTO monitoring_current (server_id, updated_at, last_attempt_at, state, online)
      VALUES (?, ?, ?, ?, ?)`).run(id, now, now, i ? "fresh" : "offline", i);
  }
  const health = async () => (await app.inject({ method: "GET", url: "/api/health" })).json();
  assert.equal((await health()).status, "ok");
  assert.deepEqual(Object.keys(await health()).sort(), ["ok", "status", "updatedAt"]);
  assert.ok(updateMonitoredServer(ids[1], { title: "Moscow renamed" }).ok);
  assert.equal(getMonitoredServer(ids[1])?.health_group, "app-mirrors");
  linkDb.prepare("UPDATE monitoring_current SET state = 'offline', online = 0 WHERE server_id = ?").run(ids[1]);
  assert.equal((await health()).status, "down");
  linkDb.prepare("UPDATE monitoring_current SET state = 'fresh', online = 1, last_attempt_at = ? WHERE server_id = ?").run(now - 86400, ids[1]);
  assert.equal((await health()).status, "unknown");
  assert.ok(updateMonitoredServer(ids[1], { healthGroup: "" }).ok);
  assert.equal(getMonitoredServer(ids[1])?.health_group, null);
});
