// Visibility + admin-only security regression tests for Monitoring 2.0.

import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-visibility-"));
process.env.NODE_ENV = "development";
process.env.SHPUN_CREDENTIALS_MASTER_KEY = "visibility-test-master-key";

const Fastify = (await import("fastify")).default;
const { serverStatusRoutes } = await import("./routes.js");
const { setServerStatusAdminChecker } = await import("./adminGuard.js");
const { createMonitoredServer, listPublicServers, listHealthServers } = await import("./repo.js");
const { aggregateHealthStatus } = await import("./health.js");
const { putSession } = await import("../../shared/session/sessionStore.js");

putSession("sid-user", { shmSessionId: "shm-user", shmUserId: 301, login: "user301", createdAt: Date.now() });
putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 901, login: "admin", createdAt: Date.now() });
setServerStatusAdminChecker(async (shmSessionId) => shmSessionId === "shm-admin");

const app = Fastify();
await app.register(async (api) => { await serverStatusRoutes(api); }, { prefix: "/api" });

function headers(sid: string) {
  return { "x-app-sid": sid };
}

// Public VPN node.
const publicVpn = createMonitoredServer({
  title: "Public VPN",
  host: "public.example",
  kind: "vpn",
  countryCode: "FI",
  visibility: "public",
  nodeExporterEnabled: false,
  active: true,
});
// Hidden gateway that still affects public health.
const hiddenGateway = createMonitoredServer({
  title: "Reality Gateway",
  host: "gateway.internal",
  kind: "gateway",
  visibility: "admin_only",
  affectsPublicHealth: true,
  nodeExporterEnabled: false,
  active: true,
});
// Hidden internal utility that must NOT affect health.
const hiddenInfra = createMonitoredServer({
  title: "Internal Metrics",
  host: "metrics.internal",
  kind: "infra",
  visibility: "admin_only",
  affectsPublicHealth: false,
  nodeExporterEnabled: false,
  active: true,
});

assert.equal(publicVpn.ok && hiddenGateway.ok && hiddenInfra.ok, true);

test("public server list excludes admin_only servers", () => {
  const titles = listPublicServers().map((s) => s.title);
  assert.deepEqual(titles, ["Public VPN"]);
});

test("health servers include public + hidden that affect health only", () => {
  const titles = listHealthServers().map((s) => s.title).sort();
  assert.deepEqual(titles, ["Public VPN", "Reality Gateway"]);
});

test("hidden servers never appear in the user server-status payload", async () => {
  const res = await app.inject({ method: "GET", url: "/api/server-status", headers: headers("sid-user") });
  assert.equal(res.statusCode, 200);
  const body = res.json();
  const serialized = JSON.stringify(body);
  assert.equal(serialized.includes("Reality Gateway"), false);
  assert.equal(serialized.includes("Internal Metrics"), false);
  assert.equal(serialized.includes("gateway.internal"), false);
  assert.equal(serialized.includes("metrics.internal"), false);
  const all = [...body.vpn, ...body.infra];
  assert.equal(all.length, 1);
});

test("public counts exclude hidden nodes (13/13 not 13/15)", async () => {
  const res = await app.inject({ method: "GET", url: "/api/server-status", headers: headers("sid-user") });
  const body = res.json();
  assert.equal(body.vpn.length + body.infra.length, listPublicServers().length);
});

test("hidden critical server can affect aggregate health without leaking identity", () => {
  const status = aggregateHealthStatus([
    { kind: "vpn", online: true, visibility: "public", affectsPublicHealth: true },
    { kind: "gateway", online: false, visibility: "admin_only", affectsPublicHealth: true },
  ]);
  // The only critical server is offline -> the aggregate goes down, but the
  // payload still exposes only the aggregate, never the hidden identity.
  assert.equal(status, "down");

  const degraded = aggregateHealthStatus([
    { kind: "gateway", online: true, visibility: "admin_only", affectsPublicHealth: true },
    { kind: "infra", online: false, visibility: "admin_only", affectsPublicHealth: true },
  ]);
  assert.equal(degraded, "degraded");

  // A hidden server with affectsPublicHealth=false is ignored.
  const ignored = aggregateHealthStatus([
    { kind: "vpn", online: true, visibility: "public" },
    { kind: "infra", online: false, visibility: "admin_only", affectsPublicHealth: false },
  ]);
  assert.equal(ignored, "ok");
});

test("public /health payload never reveals hidden topology", async () => {
  const res = await app.inject({ method: "GET", url: "/api/health" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(Object.keys(res.json()).sort(), ["ok", "status", "updatedAt"]);
});

test("admin monitored-servers includes all and never returns secrets", async () => {
  const res = await app.inject({ method: "GET", url: "/api/admin/monitored-servers", headers: headers("sid-admin") });
  assert.equal(res.statusCode, 200);
  const items = res.json().items;
  assert.equal(items.length, 3);
  const serialized = JSON.stringify(items);
  assert.equal(serialized.includes("exporter_password_encrypted"), false);
  assert.ok(items.every((i: any) => typeof i.hasExporterPassword === "boolean"));
});

test("non-admin cannot reach monitoring admin endpoints", async () => {
  for (const url of [
    "/api/admin/monitoring/summary",
    "/api/admin/monitoring/settings",
    "/api/admin/monitoring/incidents",
  ]) {
    const res = await app.inject({ method: "GET", url, headers: headers("sid-user") });
    assert.equal(res.statusCode, 403, `${url} must be admin-only`);
  }
});

test.after(async () => {
  await app.close();
});