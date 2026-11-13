// api/src/modules/gateway/routes.ts
//
// Phase 1 (READ-ONLY) admin routes for gateway HAProxy routing visibility.
// Lists gateways (from monitored_servers, kind=gateway) and returns a live
// backend/server topology read through the locked-down bridge. No mutations.

import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { isServerStatusAdmin } from "../serverStatus/adminGuard.js";
import { getMonitoredServer, listMonitoredServers } from "../serverStatus/repo.js";
import {
  gatewayShowStat,
  gatewaySetServerState,
  gatewaySetServerWeight,
  gatewayPersistState,
} from "../../shared/haproxy/bridgeClient.js";
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
 * Guardrail: refuse to take the last active (non-backup) UP server of a backend
 * out of rotation (maint/drain), which would blackhole that route — unless the
 * caller explicitly forces it.
 */
function wouldOrphanBackend(
  topology: ReturnType<typeof parseShowStat>,
  backend: string,
  server: string,
  nextState: ServerState,
): boolean {
  if (nextState === "ready") return false;
  const b = topology.backends.find((x) => x.name === backend);
  if (!b) return false;
  const activeUp = b.servers.filter((s) => s.status === "up" && !s.isBackup);
  if (activeUp.length !== 1) return false;
  return activeUp[0].name === server;
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
      return reply.code(502).send({ ok: false, error: "gateway_unreachable" });
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
      return reply.code(502).send({ ok: false, error: "gateway_unreachable" });
    }

    const current = findServer(topology, backend, server);
    if (!current) return reply.code(404).send({ ok: false, error: "server_not_found" });

    if (!force && wouldOrphanBackend(topology, backend, server, state)) {
      return reply.code(409).send({ ok: false, error: "last_active_server", backend });
    }

    try {
      const raw = await gatewaySetServerState(gw.host, backend, server, state);
      const res = interpretRuntimeReply(raw);
      if (!res.ok) {
        return reply.code(502).send({ ok: false, error: "runtime_rejected", message: res.message });
      }
    } catch (err) {
      req.log.warn({ err: String(err), gateway: gw.host }, "gateway_set_state_failed");
      return reply.code(502).send({ ok: false, error: "gateway_unreachable" });
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
    const weight = Number(body.weight);
    if (!isValidHaproxyName(backend) || !isValidHaproxyName(server)) {
      return reply.code(400).send({ ok: false, error: "invalid_name" });
    }
    if (!Number.isInteger(weight) || weight < WEIGHT_MIN || weight > WEIGHT_MAX) {
      return reply.code(400).send({ ok: false, error: "invalid_weight" });
    }

    let topology;
    try {
      topology = await loadTopology(gw.host);
    } catch (err) {
      req.log.warn({ err: String(err), gateway: gw.host }, "gateway_bridge_failed");
      return reply.code(502).send({ ok: false, error: "gateway_unreachable" });
    }
    const current = findServer(topology, backend, server);
    if (!current) return reply.code(404).send({ ok: false, error: "server_not_found" });

    try {
      const raw = await gatewaySetServerWeight(gw.host, backend, server, weight);
      const res = interpretRuntimeReply(raw);
      if (!res.ok) {
        return reply.code(502).send({ ok: false, error: "runtime_rejected", message: res.message });
      }
    } catch (err) {
      req.log.warn({ err: String(err), gateway: gw.host }, "gateway_set_weight_failed");
      return reply.code(502).send({ ok: false, error: "gateway_unreachable" });
    }

    recordGatewayChange({
      adminUserId: admin.userId,
      gatewayId: gw.id,
      gatewayHost: gw.host,
      backend,
      server,
      action: "weight",
      detail: { from: current.weight, to: weight },
    });
    void gatewayPersistState(gw.host).catch(() => {});

    return reply.send({ ok: true, backend, server, weight });
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
