// api/src/modules/gateway/routes.ts
//
// Phase 1 (READ-ONLY) admin routes for gateway HAProxy routing visibility.
// Lists gateways (from monitored_servers, kind=gateway) and returns a live
// backend/server topology read through the locked-down bridge. No mutations.

import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { isServerStatusAdmin } from "../serverStatus/adminGuard.js";
import { getMonitoredServer, listMonitoredServers } from "../serverStatus/repo.js";
import { gatewayShowStat } from "../../shared/haproxy/bridgeClient.js";
import { parseShowStat } from "../../shared/haproxy/statParser.js";

async function requireAdmin(req: any, reply: any): Promise<boolean> {
  const s = getSessionFromRequest(req) as any;
  if (!s?.shmSessionId) {
    reply.code(401).send({ ok: false, error: "unauthorized" });
    return false;
  }
  if (!(await isServerStatusAdmin(s.shmSessionId))) {
    reply.code(403).send({ ok: false, error: "not_admin" });
    return false;
  }
  return true;
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

    const id = Number((req.params as any)?.id);
    if (!Number.isFinite(id) || id <= 0) {
      return reply.code(400).send({ ok: false, error: "invalid_id" });
    }

    const row = getMonitoredServer(id);
    if (!row) return reply.code(404).send({ ok: false, error: "gateway_not_found" });
    if (row.kind !== "gateway") {
      return reply.code(400).send({ ok: false, error: "not_a_gateway" });
    }

    let raw: string;
    try {
      raw = await gatewayShowStat(row.host);
    } catch (err) {
      req.log.warn({ err: String(err), gateway: row.host }, "gateway_bridge_failed");
      return reply.code(502).send({ ok: false, error: "gateway_unreachable" });
    }

    const topology = parseShowStat(raw);
    return reply.send({
      ok: true,
      gateway: { id: row.id, title: row.title, host: row.host },
      topology,
    });
  });
}
