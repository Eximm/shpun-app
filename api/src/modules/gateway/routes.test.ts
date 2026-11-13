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
const bridge = await import("../../shared/haproxy/bridgeClient.js");
const { putSession } = await import("../../shared/session/sessionStore.js");

putSession("sid-user", { shmSessionId: "shm-user", shmUserId: 10, login: "u", createdAt: Date.now() });
putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 90, login: "a", createdAt: Date.now() });
setServerStatusAdminChecker(async (sid) => sid === "shm-admin");

const gw = createMonitoredServer({ title: "REALITY GW", host: "ruin.example", kind: "gateway", visibility: "admin_only" });
assert.equal(gw.ok, true);
const gatewayId = gw.ok ? gw.item.id : 0;
const vpn = createMonitoredServer({ title: "Helsinki", host: "fi.example", kind: "vpn" });
const vpnId = vpn.ok ? vpn.item.id : 0;

// reality_fi: single active UP server (guardrail fires on maint/drain).
// reality_de: two active UP servers (maint allowed).
const SAMPLE_CSV = [
  "# pxname,svname,status,weight,act,bck,scur,lastchg,check_status,addr",
  "reality_fi,FRONTEND,OPEN,,,,,,,",
  "reality_fi,fi_real_v4,UP,4,1,0,7,100,L4OK,194.48.143.19:8443",
  "reality_fi,fi_real_bk,no check,3,0,1,0,100,,10.0.0.1:8443",
  "reality_fi,BACKEND,UP,4,,,,,,",
  "reality_de,de_v4,UP,4,1,0,1,100,L4OK,185.1.1.1:8443",
  "reality_de,de_v6,UP,4,1,0,1,100,L4OK,[2a00::1]:8443",
  "reality_de,BACKEND,UP,8,,,,,,",
].join("\n");

const calls: any[] = [];
bridge.setGatewayBridgeTransport(async (_host, payload) => {
  calls.push(payload);
  if (payload.action === "show-stat") return { ok: true, raw: SAMPLE_CSV };
  if (payload.action === "set-state" || payload.action === "set-weight") return { ok: true, raw: "" };
  if (payload.action === "persist-state") return { ok: true, raw: "" };
  return { ok: false, error: "unexpected" };
});

const app = Fastify({ logger: false });
await app.register(async (api) => { await gatewayRoutes(api); }, { prefix: "/api" });

const hdr = (sid: string) => ({ "x-app-sid": sid });
const post = (url: string, sid: string, body: any) =>
  app.inject({ method: "POST", url, headers: hdr(sid), payload: body });

test("topology read returns parsed backends", async () => {
  const r = await app.inject({ method: "GET", url: `/api/admin/gateways/${gatewayId}/routes`, headers: hdr("sid-admin") });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().topology.backends.length, 2);
});

test("non-admin cannot mutate", async () => {
  const r = await post(`/api/admin/gateways/${gatewayId}/servers/state`, "sid-user", { backend: "reality_de", server: "de_v4", state: "maint" });
  assert.equal(r.statusCode, 403);
});

test("guardrail blocks taking the last active server to maint", async () => {
  const r = await post(`/api/admin/gateways/${gatewayId}/servers/state`, "sid-admin", { backend: "reality_fi", server: "fi_real_v4", state: "maint" });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error, "last_active_server");
});

test("force overrides the guardrail", async () => {
  const r = await post(`/api/admin/gateways/${gatewayId}/servers/state`, "sid-admin", { backend: "reality_fi", server: "fi_real_v4", state: "maint", force: true });
  assert.equal(r.statusCode, 200);
});

test("maint allowed when another active server remains", async () => {
  const r = await post(`/api/admin/gateways/${gatewayId}/servers/state`, "sid-admin", { backend: "reality_de", server: "de_v4", state: "maint" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().state, "maint");
});

test("ready (enable) is never guardrailed", async () => {
  const r = await post(`/api/admin/gateways/${gatewayId}/servers/state`, "sid-admin", { backend: "reality_fi", server: "fi_real_v4", state: "ready" });
  assert.equal(r.statusCode, 200);
});

test("invalid state and names are rejected", async () => {
  const r1 = await post(`/api/admin/gateways/${gatewayId}/servers/state`, "sid-admin", { backend: "reality_fi", server: "fi_real_v4", state: "running" });
  assert.equal(r1.statusCode, 400);
  const r2 = await post(`/api/admin/gateways/${gatewayId}/servers/state`, "sid-admin", { backend: "bad name", server: "x", state: "maint" });
  assert.equal(r2.statusCode, 400);
});

test("unknown server returns 404", async () => {
  const r = await post(`/api/admin/gateways/${gatewayId}/servers/state`, "sid-admin", { backend: "reality_de", server: "nope", state: "maint" });
  assert.equal(r.statusCode, 404);
});

test("weight accepts in-range and rejects out-of-range", async () => {
  const ok = await post(`/api/admin/gateways/${gatewayId}/servers/weight`, "sid-admin", { backend: "reality_de", server: "de_v4", weight: 3 });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.json().weight, 3);
  const bad = await post(`/api/admin/gateways/${gatewayId}/servers/weight`, "sid-admin", { backend: "reality_de", server: "de_v4", weight: 999 });
  assert.equal(bad.statusCode, 400);
});

test("mutations are recorded in the audit log", async () => {
  const r = await app.inject({ method: "GET", url: `/api/admin/gateways/${gatewayId}/changes`, headers: hdr("sid-admin") });
  assert.equal(r.statusCode, 200);
  const changes = r.json().changes as any[];
  assert.ok(changes.length >= 3);
  assert.equal(changes[0].admin_user_id, 90);
  assert.ok(changes.some((c) => c.action === "weight"));
  assert.ok(changes.some((c) => c.action.startsWith("state:")));
});

test("mutation on a non-gateway is rejected", async () => {
  const r = await post(`/api/admin/gateways/${vpnId}/servers/state`, "sid-admin", { backend: "b", server: "s", state: "maint" });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, "not_a_gateway");
});
