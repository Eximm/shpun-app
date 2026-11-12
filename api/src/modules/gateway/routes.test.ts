import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-gateway-"));

const Fastify = (await import("fastify")).default;
const { gatewayRoutes } = await import("./routes.js");
const { setServerStatusAdminChecker } = await import("../serverStatus/adminGuard.js");
const { createMonitoredServer } = await import("../serverStatus/repo.js");
const { setGatewayBridgeTransport } = await import("../../shared/haproxy/bridgeClient.js");
const { putSession } = await import("../../shared/session/sessionStore.js");

putSession("sid-user", { shmSessionId: "shm-user", shmUserId: 10, login: "u", createdAt: Date.now() });
putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 90, login: "a", createdAt: Date.now() });
setServerStatusAdminChecker(async (sid) => sid === "shm-admin");

const gw = createMonitoredServer({ title: "REALITY GW", host: "ruin.example", kind: "gateway", visibility: "admin_only" });
assert.equal(gw.ok, true);
const gatewayId = gw.ok ? gw.item.id : 0;
const vpn = createMonitoredServer({ title: "Helsinki", host: "fi.example", kind: "vpn" });
const vpnId = vpn.ok ? vpn.item.id : 0;

const SAMPLE_CSV = [
  "# pxname,svname,status,weight,act,bck,scur,lastchg,check_status,addr",
  "reality_fi,FRONTEND,OPEN,,,,,,,",
  "reality_fi,fi_real_v4,UP,4,1,0,7,100,L4OK,194.48.143.19:8443",
  "reality_fi,BACKEND,UP,4,,,,,,",
].join("\n");

setGatewayBridgeTransport(async (_host, payload) => {
  assert.equal(payload.action, "show-stat");
  return { ok: true, raw: SAMPLE_CSV };
});

const app = Fastify({ logger: false });
await app.register(async (api) => { await gatewayRoutes(api); }, { prefix: "/api" });

const hdr = (sid: string) => ({ "x-app-sid": sid });

test("gateways list requires a session", async () => {
  const r = await app.inject({ method: "GET", url: "/api/admin/gateways" });
  assert.equal(r.statusCode, 401);
});

test("gateways list rejects non-admin", async () => {
  const r = await app.inject({ method: "GET", url: "/api/admin/gateways", headers: hdr("sid-user") });
  assert.equal(r.statusCode, 403);
});

test("admin sees only gateways", async () => {
  const r = await app.inject({ method: "GET", url: "/api/admin/gateways", headers: hdr("sid-admin") });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.ok, true);
  assert.equal(body.gateways.length, 1);
  assert.equal(body.gateways[0].host, "ruin.example");
});

test("routes endpoint returns parsed topology for a gateway", async () => {
  const r = await app.inject({ method: "GET", url: `/api/admin/gateways/${gatewayId}/routes`, headers: hdr("sid-admin") });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.gateway.host, "ruin.example");
  assert.equal(body.topology.backends.length, 1);
  assert.equal(body.topology.backends[0].servers[0].status, "up");
  assert.equal(body.topology.backends[0].servers[0].weight, 4);
});

test("routes endpoint rejects a non-gateway server", async () => {
  const r = await app.inject({ method: "GET", url: `/api/admin/gateways/${vpnId}/routes`, headers: hdr("sid-admin") });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, "not_a_gateway");
});

test("routes endpoint returns 404 for unknown id", async () => {
  const r = await app.inject({ method: "GET", url: "/api/admin/gateways/999999/routes", headers: hdr("sid-admin") });
  assert.equal(r.statusCode, 404);
});

test("bridge failure surfaces as 502", async () => {
  setGatewayBridgeTransport(async () => { throw new Error("boom"); });
  const r = await app.inject({ method: "GET", url: `/api/admin/gateways/${gatewayId}/routes`, headers: hdr("sid-admin") });
  assert.equal(r.statusCode, 502);
  assert.equal(r.json().error, "gateway_unreachable");
});
