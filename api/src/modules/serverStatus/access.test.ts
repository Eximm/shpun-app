import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-monitoring-access-"));
process.env.NODE_ENV = "development";
const { prepareMonitoringAccess, setMonitoringAccessTransport } = await import("./access.js");
const { createMonitoredServer, getMonitoredServer } = await import("./repo.js");
const { setServerStatusAdminChecker } = await import("./adminGuard.js");
const { putSession } = await import("../../shared/session/sessionStore.js");
const { serverStatusRoutes } = await import("./routes.js");
const Fastify = (await import("fastify")).default;
const app = Fastify();
setServerStatusAdminChecker(async (sid) => sid === "admin");
putSession("access-admin", { shmSessionId: "admin", createdAt: Date.now() });
putSession("access-user", { shmSessionId: "user", createdAt: Date.now() });
await app.register(serverStatusRoutes, { prefix: "/api" });
const originalFetch = globalThis.fetch;
const headers = { "x-app-sid": "access-admin" };

test.after(async () => {
  globalThis.fetch = originalFetch;
  setMonitoringAccessTransport(null);
  await app.close();
});

test("adding a server prepares access and verifies exporter from the collector", async () => {
  const calls: number[] = [];
  setMonitoringAccessTransport(async (id) => { calls.push(id); return { ok: true, error: null }; });
  globalThis.fetch = async () => new Response('node_memory_MemTotal_bytes 100\nnode_boot_time_seconds 1\n');
  const response = await app.inject({
    method: "POST", url: "/api/admin/monitored-servers", headers,
    payload: { title: "New node", host: "new.example" },
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.deepEqual(calls, [body.item.id]);
  assert.deepEqual(body.access, { ok: true, error: null });
});

test("failed setup keeps the saved server and can be retried", async () => {
  setMonitoringAccessTransport(async () => ({ ok: false, error: "ssh_failed" }));
  const response = await app.inject({
    method: "POST", url: "/api/admin/monitored-servers", headers,
    payload: { title: "Retry node", host: "retry.example" },
  });
  assert.equal(response.statusCode, 200);
  const id = response.json().item.id;
  assert.equal(response.json().access.error, "ssh_failed");
  assert.ok(getMonitoredServer(id));
  setMonitoringAccessTransport(async () => ({ ok: true, error: null }));
  globalThis.fetch = async () => { throw new Error("network unavailable"); };
  const retry = await app.inject({
    method: "POST", url: `/api/admin/monitored-servers/${id}/prepare-monitoring`, headers,
  });
  assert.equal(retry.statusCode, 200);
  assert.deepEqual(retry.json().access, { ok: false, error: "probe_failed" });
  globalThis.fetch = async () => new Response("node_memory_MemTotal_bytes 100\n");
});

test("prepare is admin-only, deduplicates concurrent requests and hides raw errors", async () => {
  const row = createMonitoredServer({ host: "concurrent.example" });
  assert.ok(row.ok);
  let calls = 0;
  let done!: () => void;
  const gate = new Promise<void>((resolve) => { done = resolve; });
  setMonitoringAccessTransport(async () => {
    calls++;
    await gate;
    return { ok: false, error: "private ssh output" };
  });
  for (const sid of [undefined, "access-user"]) {
    const response: { statusCode: number } = await app.inject({
      method: "POST", url: `/api/admin/monitored-servers/${row.item.id}/prepare-monitoring`,
      headers: sid ? { "x-app-sid": sid } : {},
    });
    assert.equal(response.statusCode, sid ? 403 : 401);
  }
  assert.equal(calls, 0);
  const first = prepareMonitoringAccess(row.item);
  const second = prepareMonitoringAccess(row.item);
  assert.equal(first, second);
  done();
  assert.deepEqual(await first, { ok: false, error: "apply_failed" });
  assert.equal(calls, 1);
});

test("disabled exporters skip preparation and metadata edits do not restart metrics", async () => {
  let calls = 0;
  setMonitoringAccessTransport(async () => { calls++; return { ok: true, error: null }; });
  const response = await app.inject({
    method: "POST", url: "/api/admin/monitored-servers", headers,
    payload: { host: "disabled.example", nodeExporterEnabled: false },
  });
  assert.equal(response.json().access, null);
  assert.equal(calls, 0);
  const row = createMonitoredServer({ host: "metadata.example" });
  assert.ok(row.ok);
  await app.inject({
    method: "PUT", url: `/api/admin/monitored-servers/${row.item.id}`, headers,
    payload: { title: "Renamed node" },
  });
  assert.equal(calls, 0);
  await app.inject({
    method: "PUT", url: `/api/admin/monitored-servers/${row.item.id}`, headers,
    payload: { host: "updated.example" },
  });
  assert.equal(calls, 1);
});
