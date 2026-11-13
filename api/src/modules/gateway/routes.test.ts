import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-gateway-"));

const Fastify = (await import("fastify")).default;
const { gatewayRoutes } = await import("./routes.js");
const { setServerStatusAdminChecker } = await import("../serverStatus/adminGuard.js");
const { createMonitoredServer, updateMonitoredServer, deleteMonitoredServer } = await import("../serverStatus/repo.js");
const bridge = await import("../../shared/haproxy/bridgeClient.js");
const { putSession } = await import("../../shared/session/sessionStore.js");

putSession("sid-user", { shmSessionId: "shm-user", shmUserId: 10, login: "u", createdAt: Date.now() });
putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 90, login: "a", createdAt: Date.now() });
setServerStatusAdminChecker(async (sid) => sid === "shm-admin");

const gw = createMonitoredServer({ title: "REALITY GW", host: "ruin.example", kind: "gateway", visibility: "admin_only", haproxyRouting: true });
// An app mirror: kind=gateway for health, but not a HAProxy VPN gateway.
const mirror = createMonitoredServer({ title: "RU MIRROR MSK", host: "mirror.example", kind: "gateway", visibility: "admin_only" });
const mirrorId = mirror.ok ? mirror.item.id : 0;
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

const CONFIG = [
  "frontend rf_reality_canary_443",
  "    acl canary_rt1 req.ssl_sni -i rt1.shpyn.online img1.avito.ru",
  "    use_backend reality_fi    if canary_rt1",
  "    default_backend reality_fi",
  "backend reality_fi",
  "    server fi_real_v4 1.1.1.1:8443 check",
  "backend reality_de",
  "    server de_real 2.2.2.2:8443 check",
  "backend router_fi",
  "    server fi_router 1.1.1.1:2096 check",
  "",
].join("\n");

let applyReply = "APPLIED reloaded";
let lastAppliedConfig = "";
const calls: any[] = [];
const transport: Parameters<typeof bridge.setGatewayBridgeTransport>[0] = async (_host, payload) => {
  calls.push(payload);
  if (payload.action === "show-stat") return { ok: true, raw: SAMPLE_CSV };
  if (payload.action === "set-state" || payload.action === "set-weight") return { ok: true, raw: "" };
  if (payload.action === "persist-state") return { ok: true, raw: "" };
  if (payload.action === "get-config") return { ok: true, raw: CONFIG };
  if (payload.action === "apply-config") { lastAppliedConfig = String(payload.config ?? ""); return { ok: true, raw: applyReply }; }
  return { ok: false, error: "unexpected" };
};
bridge.setGatewayBridgeTransport(transport);

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

test("only HAProxy routing gateways are listed and accessible (mirrors are not)", async () => {
  const list = await app.inject({ method: "GET", url: "/api/admin/gateways", headers: hdr("sid-admin") });
  assert.equal(list.statusCode, 200);
  assert.deepEqual(list.json().gateways.map((g: any) => g.id), [gatewayId]);
  const before = calls.length;
  for (const p of ["routes", "config", "route-map", "changes"]) {
    const r = await app.inject({ method: "GET", url: `/api/admin/gateways/${mirrorId}/${p}`, headers: hdr("sid-admin") });
    assert.equal(r.statusCode, 400, p);
    assert.equal(r.json().error, "routing_not_enabled", p);
  }
  const w = await post(`/api/admin/gateways/${mirrorId}/servers/state`, "sid-admin", { backend: "b", server: "s", state: "maint" });
  assert.equal(w.json().error, "routing_not_enabled");
  // The bridge is never contacted for a mirror.
  assert.equal(calls.length, before);
});

test("haproxy routing flag: opt-in on update, cleared when kind is not gateway", () => {
  const s = createMonitoredServer({ title: "tmp", host: "tmp.example", kind: "gateway" });
  assert.ok(s.ok);
  if (!s.ok) return;
  assert.equal(s.item.haproxy_routing, 0);
  const on = updateMonitoredServer(s.item.id, { haproxyRouting: true });
  assert.ok(on.ok && on.item.haproxy_routing === 1);
  const keep = updateMonitoredServer(s.item.id, { title: "tmp2" });
  assert.ok(keep.ok && keep.item.haproxy_routing === 1);
  const vpnKind = updateMonitoredServer(s.item.id, { kind: "vpn" });
  assert.ok(vpnKind.ok && vpnKind.item.haproxy_routing === 0);
  const ignored = createMonitoredServer({ title: "v", host: "v.example", kind: "vpn", haproxyRouting: true });
  assert.ok(ignored.ok && ignored.item.haproxy_routing === 0);
  deleteMonitoredServer(s.item.id);
  if (ignored.ok) deleteMonitoredServer(ignored.item.id);
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

const getRouteMap = () =>
  app.inject({ method: "GET", url: `/api/admin/gateways/${gatewayId}/route-map`, headers: hdr("sid-admin") });
// Supplies the current config hash unless the test sets baseHash itself.
const put = async (url: string, sid: string, body: any) =>
  app.inject({
    method: "PUT",
    url,
    headers: hdr(sid),
    payload: "baseHash" in body ? body : { ...body, baseHash: (await getRouteMap()).json().configHash },
  });

test("route-map lists editable SNI rules and backends", async () => {
  const r = await getRouteMap();
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.match(body.configHash, /^[0-9a-f]{64}$/);
  assert.ok(body.backends.includes("reality_de"));
  assert.equal(body.rules.find((x: any) => x.acl === "canary_rt1").backend, "reality_fi");
});

test("repoint applies a validated config and records audit", async () => {
  applyReply = "APPLIED reloaded";
  const r = await put(`/api/admin/gateways/${gatewayId}/route-map`, "sid-admin", { acl: "canary_rt1", backend: "reality_de" });
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().from, "reality_fi");
  assert.match(lastAppliedConfig, /use_backend reality_de\s+if canary_rt1/);
  const changes = (await app.inject({ method: "GET", url: `/api/admin/gateways/${gatewayId}/changes`, headers: hdr("sid-admin") })).json().changes as any[];
  assert.ok(changes.some((c) => c.action === "config:route.repoint"));
});

test("repoint requires a matching base hash", async () => {
  lastAppliedConfig = "";
  const missing = await put(`/api/admin/gateways/${gatewayId}/route-map`, "sid-admin", { acl: "canary_rt1", backend: "reality_de", baseHash: undefined });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error, "base_hash_required");
  const stale = await put(`/api/admin/gateways/${gatewayId}/route-map`, "sid-admin", { acl: "canary_rt1", backend: "reality_de", baseHash: "0".repeat(64) });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error, "config_changed");
  assert.equal(lastAppliedConfig, "");
});

test("apply timeout is reported as an unknown outcome (424 apply_timeout)", async () => {
  const { configHash } = (await getRouteMap()).json();
  bridge.setGatewayBridgeTransport(async (_host, payload) => {
    if (payload.action === "get-config") return { ok: true, raw: CONFIG };
    if (payload.action === "persist-state") return { ok: true, raw: "" };
    if (payload.action === "apply-config") throw new Error("haproxy_bridge_ssh_timeout");
    return { ok: false, error: "unexpected" };
  });
  try {
    const r = await put(`/api/admin/gateways/${gatewayId}/route-map`, "sid-admin", { acl: "canary_rt1", backend: "reality_de", baseHash: configHash });
    assert.equal(r.statusCode, 424);
    assert.equal(r.json().error, "apply_timeout");
  } finally {
    bridge.setGatewayBridgeTransport(transport);
  }
});

test("apply-config gets a longer SSH timeout than reads", () => {
  assert.equal(bridge.bridgeTimeoutMs("show-stat"), 15_000);
  assert.ok(bridge.bridgeTimeoutMs("apply-config") >= 60_000);
});

test("repoint rejects cross-family backend", async () => {
  const r = await put(`/api/admin/gateways/${gatewayId}/route-map`, "sid-admin", { acl: "canary_rt1", backend: "router_fi" });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, "family_mismatch");
});

test("repoint rejects unknown backend and rule", async () => {
  const r1 = await put(`/api/admin/gateways/${gatewayId}/route-map`, "sid-admin", { acl: "canary_rt1", backend: "reality_zz" });
  assert.equal(r1.statusCode, 400);
  assert.equal(r1.json().error, "backend_not_found");
  const r2 = await put(`/api/admin/gateways/${gatewayId}/route-map`, "sid-admin", { acl: "canary_rt9", backend: "reality_de" });
  assert.equal(r2.statusCode, 404);
});

test("repoint surfaces a rejected apply (validation/reload failure)", async () => {
  applyReply = "ERROR: config test failed";
  const r = await put(`/api/admin/gateways/${gatewayId}/route-map`, "sid-admin", { acl: "canary_rt1", backend: "reality_de" });
  assert.equal(r.statusCode, 424);
  assert.equal(r.json().error, "apply_rejected");
  applyReply = "APPLIED reloaded";
});

test("non-admin cannot repoint", async () => {
  const r = await put(`/api/admin/gateways/${gatewayId}/route-map`, "sid-user", { acl: "canary_rt1", backend: "reality_de" });
  assert.equal(r.statusCode, 403);
});

test("mutation on a non-gateway is rejected", async () => {
  const r = await post(`/api/admin/gateways/${vpnId}/servers/state`, "sid-admin", { backend: "b", server: "s", state: "maint" });
  assert.equal(r.statusCode, 400);
  assert.equal(r.json().error, "not_a_gateway");
});

test("weight 0 on the last carrying server is guardrailed like maint", async () => {
  const r = await post(`/api/admin/gateways/${gatewayId}/servers/weight`, "sid-admin", { backend: "reality_fi", server: "fi_real_v4", weight: 0 });
  assert.equal(r.statusCode, 409);
  assert.equal(r.json().error, "last_active_server");
  const forced = await post(`/api/admin/gateways/${gatewayId}/servers/weight`, "sid-admin", { backend: "reality_fi", server: "fi_real_v4", weight: 0, force: true });
  assert.equal(forced.statusCode, 200);
  const other = await post(`/api/admin/gateways/${gatewayId}/servers/weight`, "sid-admin", { backend: "reality_de", server: "de_v4", weight: 0 });
  assert.equal(other.statusCode, 200);
});

test("weight must be an explicit integer (null / empty / float rejected)", async () => {
  for (const weight of [null, "", 1.5, "1e2", true]) {
    const r = await post(`/api/admin/gateways/${gatewayId}/servers/weight`, "sid-admin", { backend: "reality_de", server: "de_v4", weight });
    assert.equal(r.statusCode, 400, `weight=${JSON.stringify(weight)}`);
  }
  const s = await post(`/api/admin/gateways/${gatewayId}/servers/weight`, "sid-admin", { backend: "reality_de", server: "de_v4", weight: "5" });
  assert.equal(s.statusCode, 200);
});

const getConfig = () => app.inject({ method: "GET", url: `/api/admin/gateways/${gatewayId}/config`, headers: hdr("sid-admin") });

test("config model exposes frontends, backends, nodes and a hash", async () => {
  const r = await getConfig();
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.match(body.configHash, /^[0-9a-f]{64}$/);
  assert.equal(body.model.frontends[0].name, "rf_reality_canary_443");
  assert.ok(body.model.backends.some((b: any) => b.name === "router_fi"));
  assert.ok(body.model.nodes.some((n: any) => n.host === "1.1.1.1" && n.members.length === 2));
  const denied = await app.inject({ method: "GET", url: `/api/admin/gateways/${gatewayId}/config`, headers: hdr("sid-user") });
  assert.equal(denied.statusCode, 403);
});

test("config edit: dry run returns a diff and applies nothing", async () => {
  const { configHash } = (await getConfig()).json();
  lastAppliedConfig = "";
  const r = await post(`/api/admin/gateways/${gatewayId}/config/edit`, "sid-admin", {
    dryRun: true,
    op: { type: "server.add", backend: "reality_de", name: "de2", addr: "3.3.3.3:8443" },
  });
  assert.equal(r.statusCode, 200);
  const body = r.json();
  assert.equal(body.dryRun, true);
  assert.equal(body.configHash, configHash);
  assert.ok(body.diff.some((d: any) => d.kind === "add" && /server de2 3\.3\.3\.3:8443 check/.test(d.text)));
  assert.equal(lastAppliedConfig, "");
});

test("config edit: apply requires a matching base hash", async () => {
  const op = { type: "server.update", backend: "reality_de", server: "de_real", addr: "4.4.4.4:8443" };
  const missing = await post(`/api/admin/gateways/${gatewayId}/config/edit`, "sid-admin", { op });
  assert.equal(missing.statusCode, 400);
  assert.equal(missing.json().error, "base_hash_required");
  const stale = await post(`/api/admin/gateways/${gatewayId}/config/edit`, "sid-admin", { op, baseHash: "0".repeat(64) });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error, "config_changed");

  const { configHash } = (await getConfig()).json();
  const r = await post(`/api/admin/gateways/${gatewayId}/config/edit`, "sid-admin", { op, baseHash: configHash });
  assert.equal(r.statusCode, 200);
  assert.match(lastAppliedConfig, /server de_real 4\.4\.4\.4:8443 check/);
  const changes = (await app.inject({ method: "GET", url: `/api/admin/gateways/${gatewayId}/changes`, headers: hdr("sid-admin") })).json().changes as any[];
  assert.equal(changes[0].action, "config:server.update");
  assert.equal(changes[0].server, "de_real");
});

test("config edit: guardrail conflicts map to 409, bad input to 400", async () => {
  const { configHash } = (await getConfig()).json();
  const empty = await post(`/api/admin/gateways/${gatewayId}/config/edit`, "sid-admin", {
    baseHash: configHash, op: { type: "server.remove", backend: "reality_fi", server: "fi_real_v4" },
  });
  assert.equal(empty.statusCode, 409);
  assert.equal(empty.json().error, "backend_would_be_empty");
  const inUse = await post(`/api/admin/gateways/${gatewayId}/config/edit`, "sid-admin", {
    baseHash: configHash, op: { type: "backend.remove", name: "reality_fi" },
  });
  assert.equal(inUse.statusCode, 409);
  const bad = await post(`/api/admin/gateways/${gatewayId}/config/edit`, "sid-admin", {
    baseHash: configHash, op: { type: "server.add", backend: "reality_de", name: "x", addr: "1.1.1.1:1\nglobal" },
  });
  assert.equal(bad.statusCode, 400);
  assert.equal(bad.json().error, "invalid_addr");
  const unknown = await post(`/api/admin/gateways/${gatewayId}/config/edit`, "sid-admin", { baseHash: configHash, op: { type: "rm -rf" } });
  assert.equal(unknown.statusCode, 400);
  const user = await post(`/api/admin/gateways/${gatewayId}/config/edit`, "sid-user", { dryRun: true, op: { type: "backend.remove", name: "router_fi" } });
  assert.equal(user.statusCode, 403);
});

test("config edits on one gateway are serialized", async () => {
  const { configHash } = (await getConfig()).json();
  const op = (addr: string) => ({ type: "server.update", backend: "reality_de", server: "de_real", addr });
  const [a, b] = await Promise.all([
    post(`/api/admin/gateways/${gatewayId}/config/edit`, "sid-admin", { op: op("5.5.5.5:8443"), baseHash: configHash }),
    post(`/api/admin/gateways/${gatewayId}/config/edit`, "sid-admin", { op: op("6.6.6.6:8443"), baseHash: configHash }),
  ]);
  // The fake gateway keeps returning the same config, so both see the same
  // hash; what matters is that the two read→apply sequences never interleave.
  assert.equal(a.statusCode, 200);
  assert.equal(b.statusCode, 200);
  const order = calls.filter((c) => c.action === "get-config" || c.action === "apply-config").slice(-4).map((c) => c.action);
  assert.deepEqual(order, ["get-config", "apply-config", "get-config", "apply-config"]);
});
