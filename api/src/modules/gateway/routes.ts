// api/src/modules/gateway/routes.ts
//
// Admin routes for gateway HAProxy routing (all admin-gated, all audited):
//   - read: gateway inventory, live backend/server topology (`show stat`),
//     and the structural config model (frontends / SNI routes / backends /
//     servers / nodes) parsed from haproxy.cfg;
//   - runtime actions (instant, no reload): server state + weight;
//   - structural config edits (routes, servers, addresses, nodes, backends):
//     computed here as a surgical text edit, previewed as a diff (dryRun),
//     then validated (`haproxy -c`) and gracefully reloaded by the bridge's
//     privileged helper, which rolls back on failure.
// Config edits are serialized per gateway and guarded by an optimistic
// concurrency hash so two admins cannot silently overwrite each other.

import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { isServerStatusAdmin } from "../serverStatus/adminGuard.js";
import { getMonitoredServer, listMonitoredServers } from "../serverStatus/repo.js";
import {
  gatewayShowStat,
  gatewaySetServerState,
  gatewaySetServerWeight,
  gatewayPersistState,
  gatewayGetConfig,
  gatewayApplyConfig,
} from "../../shared/haproxy/bridgeClient.js";
import { parseRouteMap } from "../../shared/haproxy/configRouteMap.js";
import {
  applyEdit,
  configHash,
  diffConfigs,
  parseConfigModel,
  EDIT_OP_TYPES,
  type EditOp,
} from "../../shared/haproxy/configEditor.js";
import { parseShowStat, type GatewayServer } from "../../shared/haproxy/statParser.js";
import {
  isValidHaproxyName,
  isServerState,
  interpretRuntimeReply,
  WEIGHT_MIN,
  WEIGHT_MAX,
  type ServerState,
} from "../../shared/haproxy/runtimeCommands.js";
import { recordGatewayChange, listGatewayChanges } from "./auditRepo.js";

/**
 * Status for "the gateway (bridge / HAProxy) failed", as opposed to this API
 * failing. Deliberately not 5xx: proxies in front of the app (e.g. the
 * app.shpun.net mirror) replace upstream 5xx with their own stub page, which
 * would hide the error code and the `haproxy -c` output from the admin UI.
 * The client distinguishes cases by `error` (gateway_unreachable,
 * apply_rejected, apply_timeout, runtime_rejected, …), not by status.
 */
const GATEWAY_FAILED = 424;

type AdminSession = { shmSessionId: string; userId: number | null };

async function requireAdmin(req: any, reply: any): Promise<AdminSession | null> {
  const s = getSessionFromRequest(req) as any;
  if (!s?.shmSessionId) {
    reply.code(401).send({ ok: false, error: "unauthorized" });
    return null;
  }
  if (!(await isServerStatusAdmin(s.shmSessionId))) {
    reply.code(403).send({ ok: false, error: "not_admin" });
    return null;
  }
  const uid = Number(s.userId ?? s.shmUserId ?? 0);
  return { shmSessionId: s.shmSessionId, userId: Number.isFinite(uid) && uid > 0 ? uid : null };
}

/** Loads the gateway row (admin gateway only) or sends the error response. */
function loadGateway(req: any, reply: any): { id: number; title: string; host: string } | null {
  const id = Number((req.params as any)?.id);
  if (!Number.isFinite(id) || id <= 0) {
    reply.code(400).send({ ok: false, error: "invalid_id" });
    return null;
  }
  const row = getMonitoredServer(id);
  if (!row) {
    reply.code(404).send({ ok: false, error: "gateway_not_found" });
    return null;
  }
  if (row.kind !== "gateway") {
    reply.code(400).send({ ok: false, error: "not_a_gateway" });
    return null;
  }
  return { id: row.id, title: row.title, host: row.host };
}

async function loadTopology(host: string): Promise<ReturnType<typeof parseShowStat>> {
  return parseShowStat(await gatewayShowStat(host));
}

function findServer(
  topology: ReturnType<typeof parseShowStat>,
  backend: string,
  server: string,
): GatewayServer | null {
  const b = topology.backends.find((x) => x.name === backend);
  if (!b) return null;
  return b.servers.find((s) => s.name === server) ?? null;
}

/**
 * Guardrail: refuse to take the last server that actually carries traffic
 * (UP, non-backup, weight > 0) out of rotation — via maint/drain or via
 * weight 0, which is equivalent — since that would blackhole the route,
 * unless the caller explicitly forces it.
 */
function isCarryingTraffic(s: GatewayServer): boolean {
  return s.status === "up" && !s.isBackup && (s.weight == null || s.weight > 0);
}

function wouldOrphanBackend(
  topology: ReturnType<typeof parseShowStat>,
  backend: string,
  server: string,
  change: { state?: ServerState; weight?: number },
): boolean {
  if (change.state === "ready") return false;
  if (change.weight != null && change.weight > 0) return false;
  const b = topology.backends.find((x) => x.name === backend);
  if (!b) return false;
  const active = b.servers.filter(isCarryingTraffic);
  if (active.length !== 1) return false;
  return active[0].name === server;
}

/** Strict weight parsing: an integer (or integer string) within bounds. */
function parseWeight(v: unknown): number | null {
  if (typeof v === "number") return Number.isInteger(v) && v >= WEIGHT_MIN && v <= WEIGHT_MAX ? v : null;
  if (typeof v === "string" && /^\d{1,3}$/.test(v.trim())) {
    const n = Number(v.trim());
    return n >= WEIGHT_MIN && n <= WEIGHT_MAX ? n : null;
  }
  return null;
}

/* ─── Serialized, hash-guarded config edits ───────────────────────────────── */

const gatewayLocks = new Map<number, Promise<unknown>>();

/** Runs `fn` exclusively per gateway (config read → edit → apply). */
function withGatewayLock<T>(gatewayId: number, fn: () => Promise<T>): Promise<T> {
  const prev = gatewayLocks.get(gatewayId) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  gatewayLocks.set(gatewayId, tail);
  void tail.then(() => { if (gatewayLocks.get(gatewayId) === tail) gatewayLocks.delete(gatewayId); });
  return run;
}

const CONFLICT_ERRORS = new Set([
  "last_active_server",
  "backend_in_use",
  "backend_would_be_empty",
  "server_exists",
  "backend_exists",
  "acl_exists",
]);

type EditOutcome = { status: number; body: Record<string, unknown> };

async function runConfigEdit(
  gw: { id: number; title: string; host: string },
  op: EditOp,
  opts: { baseHash: string | null; dryRun: boolean; admin: AdminSession; log: any },
): Promise<EditOutcome> {
  return withGatewayLock(gw.id, async () => {
    let config: string;
    try {
      config = await gatewayGetConfig(gw.host);
    } catch (err) {
      opts.log.warn({ err: String(err), gateway: gw.host }, "gateway_get_config_failed");
      return { status: GATEWAY_FAILED, body: { ok: false, error: "gateway_unreachable" } };
    }
    const hash = configHash(config);
    if (opts.baseHash && opts.baseHash !== hash) {
      return { status: 409, body: { ok: false, error: "config_changed", configHash: hash } };
    }

    const edited = applyEdit(config, op);
    if (!edited.ok) {
      if (edited.error === "unchanged") {
        return { status: 200, body: { ok: true, unchanged: true, configHash: hash, diff: [] } };
      }
      const status = CONFLICT_ERRORS.has(edited.error) ? 409 : 400;
      return { status, body: { ok: false, error: edited.error, ...(edited.detail ?? {}) } };
    }

    const diff = diffConfigs(config, edited.config);
    if (opts.dryRun) {
      return { status: 200, body: { ok: true, dryRun: true, summary: edited.summary, diff, configHash: hash } };
    }

    // Best-effort: dump runtime server state first so runtime-only changes
    // (maint/drain/weight) survive the reload.
    await gatewayPersistState(gw.host).catch(() => "");

    let raw: string;
    try {
      raw = await gatewayApplyConfig(gw.host, edited.config);
    } catch (err) {
      opts.log.warn({ err: String(err), gateway: gw.host }, "gateway_apply_config_failed");
      // On a timeout the helper may still have applied (or rolled back) on the
      // gateway: the outcome is unknown, so the client must re-read the config.
      const timedOut = /haproxy_bridge_ssh_timeout/.test(String(err));
      return { status: GATEWAY_FAILED, body: { ok: false, error: timedOut ? "apply_timeout" : "apply_failed" } };
    }
    if (!/APPLIED/.test(raw)) {
      return { status: GATEWAY_FAILED, body: { ok: false, error: "apply_rejected", message: raw.slice(0, 2000) } };
    }

    recordGatewayChange({
      adminUserId: opts.admin.userId,
      gatewayId: gw.id,
      gatewayHost: gw.host,
      backend: edited.target.backend.slice(0, 256),
      server: edited.target.server.slice(0, 256),
      action: `config:${op.type}`,
      detail: { summary: edited.summary, op, from: hash.slice(0, 12), to: configHash(edited.config).slice(0, 12) },
    });

    return {
      status: 200,
      body: {
        ok: true,
        summary: edited.summary,
        diff,
        configHash: configHash(edited.config),
        ...(edited.from ? { from: edited.from } : {}),
      },
    };
  });
}

export async function gatewayRoutes(app: FastifyInstance) {
  // GET /api/admin/gateways — gateway inventory (kind=gateway).
  app.get("/admin/gateways", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const gateways = listMonitoredServers()
      .filter((s) => s.kind === "gateway")
      .map((s) => ({
        id: s.id,
        title: s.title,
        host: s.host,
        visibility: s.visibility,
      }));
    return reply.send({ ok: true, gateways });
  });

  // GET /api/admin/gateways/:id/routes — live backend/server topology.
  app.get("/admin/gateways/:id/routes", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const gw = loadGateway(req, reply);
    if (!gw) return;

    try {
      const topology = await loadTopology(gw.host);
      return reply.send({ ok: true, gateway: gw, topology });
    } catch (err) {
      req.log.warn({ err: String(err), gateway: gw.host }, "gateway_bridge_failed");
      return reply.code(GATEWAY_FAILED).send({ ok: false, error: "gateway_unreachable" });
    }
  });

  // POST /api/admin/gateways/:id/servers/state — enable/disable/drain a server.
  app.post("/admin/gateways/:id/servers/state", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const gw = loadGateway(req, reply);
    if (!gw) return;

    const body = (req.body ?? {}) as any;
    const backend = String(body.backend ?? "");
    const server = String(body.server ?? "");
    const state = body.state;
    const force = body.force === true;
    if (!isValidHaproxyName(backend) || !isValidHaproxyName(server)) {
      return reply.code(400).send({ ok: false, error: "invalid_name" });
    }
    if (!isServerState(state)) {
      return reply.code(400).send({ ok: false, error: "invalid_state" });
    }

    let topology;
    try {
      topology = await loadTopology(gw.host);
    } catch (err) {
      req.log.warn({ err: String(err), gateway: gw.host }, "gateway_bridge_failed");
      return reply.code(GATEWAY_FAILED).send({ ok: false, error: "gateway_unreachable" });
    }

    const current = findServer(topology, backend, server);
    if (!current) return reply.code(404).send({ ok: false, error: "server_not_found" });

    if (!force && wouldOrphanBackend(topology, backend, server, { state })) {
      return reply.code(409).send({ ok: false, error: "last_active_server", backend });
    }

    try {
      const raw = await gatewaySetServerState(gw.host, backend, server, state);
      const res = interpretRuntimeReply(raw);
      if (!res.ok) {
        return reply.code(GATEWAY_FAILED).send({ ok: false, error: "runtime_rejected", message: res.message });
      }
    } catch (err) {
      req.log.warn({ err: String(err), gateway: gw.host }, "gateway_set_state_failed");
      return reply.code(GATEWAY_FAILED).send({ ok: false, error: "gateway_unreachable" });
    }

    recordGatewayChange({
      adminUserId: admin.userId,
      gatewayId: gw.id,
      gatewayHost: gw.host,
      backend,
      server,
      action: `state:${state}`,
      detail: { from: current.statusRaw, to: state, force },
    });
    void gatewayPersistState(gw.host).catch(() => {});

    return reply.send({ ok: true, backend, server, state });
  });

  // POST /api/admin/gateways/:id/servers/weight — set absolute weight.
  app.post("/admin/gateways/:id/servers/weight", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const gw = loadGateway(req, reply);
    if (!gw) return;

    const body = (req.body ?? {}) as any;
    const backend = String(body.backend ?? "");
    const server = String(body.server ?? "");
    const weight = parseWeight(body.weight);
    const force = body.force === true;
    if (!isValidHaproxyName(backend) || !isValidHaproxyName(server)) {
      return reply.code(400).send({ ok: false, error: "invalid_name" });
    }
    if (weight == null) {
      return reply.code(400).send({ ok: false, error: "invalid_weight" });
    }

    let topology;
    try {
      topology = await loadTopology(gw.host);
    } catch (err) {
      req.log.warn({ err: String(err), gateway: gw.host }, "gateway_bridge_failed");
      return reply.code(GATEWAY_FAILED).send({ ok: false, error: "gateway_unreachable" });
    }
    const current = findServer(topology, backend, server);
    if (!current) return reply.code(404).send({ ok: false, error: "server_not_found" });

    // Weight 0 takes the server out of rotation just like maint/drain.
    if (!force && wouldOrphanBackend(topology, backend, server, { weight })) {
      return reply.code(409).send({ ok: false, error: "last_active_server", backend });
    }

    try {
      const raw = await gatewaySetServerWeight(gw.host, backend, server, weight);
      const res = interpretRuntimeReply(raw);
      if (!res.ok) {
        return reply.code(GATEWAY_FAILED).send({ ok: false, error: "runtime_rejected", message: res.message });
      }
    } catch (err) {
      req.log.warn({ err: String(err), gateway: gw.host }, "gateway_set_weight_failed");
      return reply.code(GATEWAY_FAILED).send({ ok: false, error: "gateway_unreachable" });
    }

    recordGatewayChange({
      adminUserId: admin.userId,
      gatewayId: gw.id,
      gatewayHost: gw.host,
      backend,
      server,
      action: "weight",
      detail: { from: current.weight, to: weight, force },
    });
    void gatewayPersistState(gw.host).catch(() => {});

    return reply.send({ ok: true, backend, server, weight });
  });

  // GET /api/admin/gateways/:id/route-map — editable SNI->country rules.
  app.get("/admin/gateways/:id/route-map", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const gw = loadGateway(req, reply);
    if (!gw) return;
    try {
      const config = await gatewayGetConfig(gw.host);
      const map = parseRouteMap(config);
      return reply.send({ ok: true, gateway: gw, configHash: configHash(config), backends: map.backends, rules: map.rules });
    } catch (err) {
      req.log.warn({ err: String(err), gateway: gw.host }, "gateway_get_config_failed");
      return reply.code(GATEWAY_FAILED).send({ ok: false, error: "gateway_unreachable" });
    }
  });

  // PUT /api/admin/gateways/:id/route-map — repoint one SNI rule to a backend.
  // Kept for compatibility; goes through the same serialized, hash-guarded
  // edit pipeline as /config/edit and, like it, requires baseHash (returned
  // by GET /route-map or GET /config) so a stale client cannot overwrite a
  // newer config.
  app.put("/admin/gateways/:id/route-map", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const gw = loadGateway(req, reply);
    if (!gw) return;

    const body = (req.body ?? {}) as any;
    const acl = String(body.acl ?? "");
    const backend = String(body.backend ?? "");
    const baseHash = typeof body.baseHash === "string" && /^[0-9a-f]{64}$/.test(body.baseHash) ? body.baseHash : null;
    if (!baseHash) return reply.code(400).send({ ok: false, error: "base_hash_required" });

    let frontend = typeof body.frontend === "string" ? body.frontend : "";
    if (!frontend) {
      try {
        const map = parseRouteMap(await gatewayGetConfig(gw.host));
        const rules = map.rules.filter((r) => r.acl === acl);
        if (rules.length === 0) return reply.code(404).send({ ok: false, error: "rule_not_found" });
        if (rules.length > 1) return reply.code(400).send({ ok: false, error: "ambiguous_rule" });
        frontend = rules[0].frontend;
      } catch (err) {
        req.log.warn({ err: String(err), gateway: gw.host }, "gateway_get_config_failed");
        return reply.code(GATEWAY_FAILED).send({ ok: false, error: "gateway_unreachable" });
      }
    }

    const res = await runConfigEdit(gw, { type: "route.repoint", frontend, acl, backend }, {
      baseHash, dryRun: false, admin, log: req.log,
    });
    if (res.body.error === "rule_not_found" || res.body.error === "frontend_not_found") {
      return reply.code(404).send(res.body);
    }
    return reply.code(res.status).send(res.body.ok ? { ...res.body, acl, backend } : res.body);
  });

  // GET /api/admin/gateways/:id/config — structural model + concurrency hash.
  app.get("/admin/gateways/:id/config", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const gw = loadGateway(req, reply);
    if (!gw) return;
    try {
      const config = await gatewayGetConfig(gw.host);
      return reply.send({ ok: true, gateway: gw, configHash: configHash(config), model: parseConfigModel(config) });
    } catch (err) {
      req.log.warn({ err: String(err), gateway: gw.host }, "gateway_get_config_failed");
      return reply.code(GATEWAY_FAILED).send({ ok: false, error: "gateway_unreachable" });
    }
  });

  // POST /api/admin/gateways/:id/config/edit — { op, baseHash, dryRun }.
  // dryRun returns the diff without touching the gateway; a real apply
  // requires baseHash (from GET /config or the dry run) to match.
  app.post("/admin/gateways/:id/config/edit", async (req, reply) => {
    const admin = await requireAdmin(req, reply);
    if (!admin) return;
    const gw = loadGateway(req, reply);
    if (!gw) return;

    const body = (req.body ?? {}) as any;
    const op = body.op as EditOp | undefined;
    if (!op || typeof op !== "object" || !(EDIT_OP_TYPES as readonly string[]).includes(String((op as any).type))) {
      return reply.code(400).send({ ok: false, error: "invalid_op" });
    }
    const dryRun = body.dryRun === true;
    const baseHash = typeof body.baseHash === "string" && /^[0-9a-f]{64}$/.test(body.baseHash) ? body.baseHash : null;
    if (!dryRun && !baseHash) return reply.code(400).send({ ok: false, error: "base_hash_required" });

    const res = await runConfigEdit(gw, op, { baseHash, dryRun, admin, log: req.log });
    return reply.code(res.status).send(res.body);
  });

  // GET /api/admin/gateways/:id/changes — recent audit log.
  app.get("/admin/gateways/:id/changes", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const gw = loadGateway(req, reply);
    if (!gw) return;
    const limit = Number((req.query as any)?.limit ?? 50);
    return reply.send({ ok: true, changes: listGatewayChanges(gw.id, limit) });
  });
}
