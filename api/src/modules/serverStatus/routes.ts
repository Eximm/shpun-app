import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import {
  createMonitoredServer,
  deleteMonitoredServer,
  getMonitoredServer,
  listMonitoredServers,
  updateMonitoredServer,
} from "./repo.js";
import {
  getServerStatusMeta,
  getServerStatusSnapshot,
  requestManualServerStatusRefresh,
  requestServerStatusRefresh,
  startServerStatusMonitor,
} from "./monitor.js";
import { aggregateHealthStatus, toPublicCheck } from "./health.js";
import { isServerStatusAdmin } from "./adminGuard.js";

function int(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export async function serverStatusRoutes(app: FastifyInstance) {
  startServerStatusMonitor(() => listMonitoredServers(), app.log);

  // Minimal, public-safe status for the app header badge. Aggregated only:
  // no hostnames, IPs, exporter URLs, raw metrics or node topology.
  app.get("/health", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const rows = listMonitoredServers();
    const checks = getServerStatusSnapshot(rows);
    if (!getServerStatusMeta().updatedAt) void requestServerStatusRefresh(rows, app.log);
    const meta = getServerStatusMeta();
    return reply.send({
      ok: true,
      status: aggregateHealthStatus(checks),
      updatedAt: meta.updatedAt,
    });
  });

  // User-facing status page data. Sanitized projection: display labels and
  // derived status only. Internal `host`, exporter URLs and raw Node Exporter
  // metrics stay behind the admin API.
  app.get("/server-status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const rows = listMonitoredServers();
    const checks = getServerStatusSnapshot(rows);
    if (!getServerStatusMeta().updatedAt) void requestServerStatusRefresh(rows, app.log);
    const meta = getServerStatusMeta();
    const publicChecks = checks.map(toPublicCheck);
    return reply.send({
      ok: true,
      updatedAt: meta.updatedAt,
      refreshing: meta.refreshing,
      refreshIntervalMs: meta.refreshIntervalMs,
      vpn: publicChecks.filter((x) => x.kind === "vpn"),
      infra: publicChecks.filter((x) => x.kind === "infra"),
    });
  });

  // Manual refresh can trigger a full scrape cycle, so it is admin-only.
  app.post("/server-status/refresh", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false, error: "unauthorized" });
    if (!(await isServerStatusAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });

    const result = await requestManualServerStatusRefresh(listMonitoredServers(), app.log);
    const meta = getServerStatusMeta();
    return reply.send({
      ok: true,
      refresh: result,
      updatedAt: meta.updatedAt,
      refreshing: meta.refreshing,
      refreshIntervalMs: meta.refreshIntervalMs,
      manualCooldownMs: meta.manualCooldownMs,
    });
  });

  app.get("/admin/monitored-servers", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await isServerStatusAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });
    return reply.send({ ok: true, items: listMonitoredServers({ includeInactive: true }) });
  });

  app.post("/admin/monitored-servers", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await isServerStatusAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });
    const result = createMonitoredServer((req.body ?? {}) as any);
    if (!result.ok) return reply.code(400).send({ ok: false, error: result.error });
    void requestServerStatusRefresh(listMonitoredServers(), app.log);
    return reply.send({ ok: true, item: result.item });
  });

  app.put("/admin/monitored-servers/:id", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await isServerStatusAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });
    const id = int((req.params as any)?.id);
    const result = updateMonitoredServer(id, (req.body ?? {}) as any);
    if (!result.ok) return reply.code(result.error === "not_found" ? 404 : 400).send({ ok: false, error: result.error });
    void requestServerStatusRefresh(listMonitoredServers(), app.log);
    return reply.send({ ok: true, item: result.item });
  });

  app.delete("/admin/monitored-servers/:id", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await isServerStatusAdmin(s.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });
    const item = getMonitoredServer(int((req.params as any)?.id));
    if (!item) return reply.code(404).send({ ok: false, error: "not_found" });
    const deleted = deleteMonitoredServer(item.id);
    void requestServerStatusRefresh(listMonitoredServers(), app.log);
    return reply.send({ ok: true, deleted });
  });
}