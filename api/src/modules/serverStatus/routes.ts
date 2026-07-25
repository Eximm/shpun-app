import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { shmShpunAppAdminStatus } from "../../shared/shm/shmClient.js";
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
  requestServerStatusRefresh,
  startServerStatusMonitor,
} from "./monitor.js";

function int(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

async function isAdmin(s: any) {
  const sid = String(s?.shmSessionId ?? "").trim();
  if (!sid) return false;
  try {
    const r = await shmShpunAppAdminStatus(sid);
    return r.ok && (r.json?.is_admin === 1 || r.json?.is_admin === true);
  } catch {
    return false;
  }
}

export async function serverStatusRoutes(app: FastifyInstance) {
  startServerStatusMonitor(() => listMonitoredServers(), app.log);

  app.get("/server-status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const rows = listMonitoredServers();
    const checks = getServerStatusSnapshot(rows);
    void requestServerStatusRefresh(rows, app.log);
    const meta = getServerStatusMeta();
    return reply.send({
      ok: true,
      updatedAt: meta.updatedAt,
      refreshing: meta.refreshing,
      refreshIntervalMs: meta.refreshIntervalMs,
      vpn: checks.filter((x) => x.kind === "vpn"),
      infra: checks.filter((x) => x.kind === "infra"),
    });
  });

  app.get("/admin/monitored-servers", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await isAdmin(s))) return reply.code(403).send({ ok: false, error: "not_admin" });
    return reply.send({ ok: true, items: listMonitoredServers({ includeInactive: true }) });
  });

  app.post("/admin/monitored-servers", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await isAdmin(s))) return reply.code(403).send({ ok: false, error: "not_admin" });
    const result = createMonitoredServer((req.body ?? {}) as any);
    if (!result.ok) return reply.code(400).send({ ok: false, error: result.error });
    void requestServerStatusRefresh(listMonitoredServers(), app.log);
    return reply.send({ ok: true, item: result.item });
  });

  app.put("/admin/monitored-servers/:id", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await isAdmin(s))) return reply.code(403).send({ ok: false, error: "not_admin" });
    const id = int((req.params as any)?.id);
    const result = updateMonitoredServer(id, (req.body ?? {}) as any);
    if (!result.ok) return reply.code(result.error === "not_found" ? 404 : 400).send({ ok: false, error: result.error });
    void requestServerStatusRefresh(listMonitoredServers(), app.log);
    return reply.send({ ok: true, item: result.item });
  });

  app.delete("/admin/monitored-servers/:id", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });
    if (!(await isAdmin(s))) return reply.code(403).send({ ok: false, error: "not_admin" });
    const item = getMonitoredServer(int((req.params as any)?.id));
    if (!item) return reply.code(404).send({ ok: false, error: "not_found" });
    const deleted = deleteMonitoredServer(item.id);
    void requestServerStatusRefresh(listMonitoredServers(), app.log);
    return reply.send({ ok: true, deleted });
  });
}
