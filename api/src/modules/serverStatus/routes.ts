import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import {
  createMonitoredServer,
  deleteMonitoredServer,
  getMonitoredServer,
  listMonitoredServers,
  listHealthServers,
  listPublicServers,
  toAdminServer,
  updateMonitoredServer,
} from "./repo.js";
import {
  applyCollectionInterval,
  getRemnawaveGlobalStates,
  getRemnawaveNodes,
  getServerStatusMeta,
  getServerStatusSnapshot,
  probeNodeExporter,
  requestManualServerStatusRefresh,
  requestServerStatusRefresh,
  setMonitoringIncidentHandler,
  startServerStatusMonitor,
} from "./monitor.js";
import { aggregateHealthStatus, toPublicCheck } from "./health.js";
import { isServerStatusAdmin } from "./adminGuard.js";
import {
  createIntegration,
  deleteIntegration,
  getIntegration,
  getIntegrationCredentials,
  listPublicIntegrations,
  toPublicIntegration,
  updateIntegration,
} from "./integrationsRepo.js";
import { probeRemnawaveMetrics } from "./remnawaveMetrics.js";
import { getGlobalThresholds, setGlobalThresholds } from "./settingsRepo.js";
import { historyStats, querySeries } from "./historyRepo.js";
import { countActiveIncidents, listActiveIncidents, listRecentEvents, listRecentIncidents } from "./incidentsRepo.js";
import { deliverMonitoringIncidentEvents } from "./monitoringNotifications.js";

function int(v: unknown, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

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

export async function serverStatusRoutes(app: FastifyInstance) {
  startServerStatusMonitor(() => listMonitoredServers(), app.log);

  // Structured, secret-free logging for incident lifecycle events + delivery
  // through the existing admin notification stack (in-app bell, Web Push for
  // critical, Telegram admin chat for critical). The engine emits each
  // transition once, and deterministic event ids guarantee dedup.
  setMonitoringIncidentHandler((events, servers) => {
    for (const event of events) {
      const row = servers.get(event.serverId);
      app.log.info(
        {
          event: event.kind === "opened" ? "MONITOR_INCIDENT_OPEN" : event.kind === "resolved" ? "MONITOR_INCIDENT_RESOLVE" : "MONITOR_INCIDENT_UPDATE",
          serverId: event.serverId,
          title: row?.title ?? event.serverTitle,
          rule: event.ruleType,
          severity: event.severity,
          ts: event.ts,
        },
        "monitoring incident event",
      );
    }
    try {
      deliverMonitoringIncidentEvents(events, app.log);
    } catch (e) {
      app.log.warn({ err: e }, "MONITOR_NOTIFY_FAIL");
    }
  });

  // Minimal, public-safe status for the app header badge (visible pre-auth).
  // Aggregated only: no hostnames, IPs, exporter URLs, raw metrics, node
  // counts or topology. Hidden servers may influence the aggregate without
  // being revealed.
  app.get("/health", async (_req, reply) => {
    const rows = listHealthServers();
    const checks = getServerStatusSnapshot(rows);
    if (!getServerStatusMeta().updatedAt) void requestServerStatusRefresh(listMonitoredServers(), app.log);
    const meta = getServerStatusMeta();
    return reply.send({
      ok: true,
      status: aggregateHealthStatus(
        checks.map((c) => ({
          kind: c.kind,
          online: c.online,
          visibility: rows.find((r) => r.id === c.id)?.visibility,
          affectsPublicHealth: rows.find((r) => r.id === c.id)?.affects_public_health === 1,
        })),
      ),
      updatedAt: meta.updatedAt,
    });
  });

  // User-facing status page data. Public visibility only; sanitized projection.
  app.get("/server-status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const rows = listPublicServers();
    const checks = getServerStatusSnapshot(rows);
    if (!getServerStatusMeta().updatedAt) void requestServerStatusRefresh(listMonitoredServers(), app.log);
    const meta = getServerStatusMeta();
    const publicChecks = checks.map(toPublicCheck);
    return reply.send({
      ok: true,
      updatedAt: meta.updatedAt,
      refreshing: meta.refreshing,
      refreshIntervalMs: meta.refreshIntervalMs,
      vpn: publicChecks.filter((x) => x.kind === "vpn"),
      infra: publicChecks.filter((x) => x.kind !== "vpn"),
    });
  });

  // Manual refresh can trigger a full scrape cycle, so it is admin-only.
  app.post("/server-status/refresh", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
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

  /* ─ Admin: monitored servers ──────────────────────────────────────────── */

  app.get("/admin/monitored-servers", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const rows = listMonitoredServers({ includeInactive: true });
    // One request, one snapshot: every server carries its compact-safe current
    // status so the admin can read all nodes at a glance without expanding and
    // without an N-request fan-out.
    const snapshot = new Map(getServerStatusSnapshot(rows).map((c) => [c.id, c]));
    return reply.send({
      ok: true,
      updatedAt: getServerStatusMeta().updatedAt,
      items: rows.map((row) => ({ ...toAdminServer(row), current: snapshot.get(row.id) ?? null })),
    });
  });

  app.post("/admin/monitored-servers", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const result = createMonitoredServer((req.body ?? {}) as any);
    if (!result.ok) return reply.code(400).send({ ok: false, error: result.error });
    void requestServerStatusRefresh(listMonitoredServers(), app.log);
    return reply.send({ ok: true, item: toAdminServer(result.item) });
  });

  app.put("/admin/monitored-servers/:id", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = int((req.params as any)?.id);
    const result = updateMonitoredServer(id, (req.body ?? {}) as any);
    if (!result.ok) return reply.code(result.error === "not_found" ? 404 : 400).send({ ok: false, error: result.error });
    void requestServerStatusRefresh(listMonitoredServers(), app.log);
    return reply.send({ ok: true, item: toAdminServer(result.item) });
  });

  app.delete("/admin/monitored-servers/:id", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const item = getMonitoredServer(int((req.params as any)?.id));
    if (!item) return reply.code(404).send({ ok: false, error: "not_found" });
    const deleted = deleteMonitoredServer(item.id);
    void requestServerStatusRefresh(listMonitoredServers(), app.log);
    return reply.send({ ok: true, deleted });
  });

  app.post("/admin/monitored-servers/:id/test-node-exporter", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const row = getMonitoredServer(int((req.params as any)?.id));
    if (!row) return reply.code(404).send({ ok: false, error: "not_found" });
    if (Number(row.node_exporter_enabled) !== 1 || !row.exporter_url) {
      return reply.code(400).send({ ok: false, error: "node_exporter_disabled" });
    }
    const probe = await probeNodeExporter(row);
    return reply.send({ ok: true, probe });
  });

  /* ── Admin: integrations ───────────────────────────────────────────────── */

  app.get("/admin/monitoring/integrations", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return reply.send({ ok: true, items: listPublicIntegrations(), states: getRemnawaveGlobalStates() });
  });

  app.post("/admin/monitoring/integrations", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const result = createIntegration((req.body ?? {}) as any);
    if (!result.ok) return reply.code(400).send({ ok: false, error: result.error });
    return reply.send({ ok: true, item: toPublicIntegration(result.item) });
  });

  app.put("/admin/monitoring/integrations/:id", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const result = updateIntegration(int((req.params as any)?.id), (req.body ?? {}) as any);
    if (!result.ok) return reply.code(result.error === "not_found" ? 404 : 400).send({ ok: false, error: result.error });
    return reply.send({ ok: true, item: toPublicIntegration(result.item) });
  });

  app.delete("/admin/monitoring/integrations/:id", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const deleted = deleteIntegration(int((req.params as any)?.id));
    return reply.send({ ok: true, deleted });
  });

  app.post("/admin/monitoring/integrations/:id/test", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const integration = getIntegration(int((req.params as any)?.id));
    if (!integration) return reply.code(404).send({ ok: false, error: "not_found" });

    const creds = getIntegrationCredentials(integration);
    const url = integration.metrics_url || integration.base_url;
    if (!url) return reply.send({ ok: true, probe: { reachable: false, authOk: false, metricsReceived: false, nodeMetricsFound: false, onlineUsersMetricPresent: false, nodeCount: 0, presentMetrics: [], errorCode: "metrics_url_missing" } });
    if (creds.passwordDecryptFailed || creds.apiTokenDecryptFailed) {
      return reply.send({ ok: true, probe: { ...emptyProbe(), errorCode: "credential_decrypt_failed" } });
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const headers: Record<string, string> = {};
      if (integration.username) {
        headers.Authorization = `Basic ${Buffer.from(`${integration.username}:${creds.password ?? ""}`).toString("base64")}`;
      }
      const res = await fetch(url, { signal: controller.signal, headers });
      if (!res.ok) {
        return reply.send({ ok: true, probe: { ...emptyProbe(), errorCode: `http_${res.status}`, reachable: true } });
      }
      const text = await res.text();
      return reply.send({ ok: true, probe: probeRemnawaveMetrics(text) });
    } catch (e: any) {
      const code = e?.name === "AbortError" ? "timeout" : /ENOTFOUND|getaddrinfo/i.test(String(e?.message)) ? "dns_failed" : "unreachable";
      return reply.send({ ok: true, probe: { ...emptyProbe(), errorCode: code } });
    } finally {
      clearTimeout(timer);
    }
  });

  app.get("/admin/monitoring/integrations/:id/nodes", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = int((req.params as any)?.id);
    const integration = getIntegration(id);
    if (!integration) return reply.code(404).send({ ok: false, error: "not_found" });
    return reply.send({ ok: true, nodes: getRemnawaveNodes(id) });
  });

  /* ── Admin: settings ──────────────────────────────────────────────────── */

  app.get("/admin/monitoring/settings", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    return reply.send({ ok: true, thresholds: getGlobalThresholds() });
  });

  app.put("/admin/monitoring/settings", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const { thresholds, ignoredKeys } = setGlobalThresholds((req.body ?? {}) as any);
    // Apply the new collection interval immediately (single timer, no restart).
    const timer = applyCollectionInterval(thresholds.collectionIntervalSec);
    return reply.send({ ok: true, thresholds, ignoredKeys, timer });
  });

  /* ── Admin: history / incidents / summary ──────────────────────────────── */

  app.get("/admin/monitoring/servers/:id/history", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = int((req.params as any)?.id);
    const row = getMonitoredServer(id);
    if (!row) return reply.code(404).send({ ok: false, error: "not_found" });
    const range = String((req.query as any)?.range ?? "1h");
    const rangeKey = range === "24h" || range === "7d" ? range : "1h";
    return reply.send({ ok: true, range: rangeKey, points: querySeries(id, rangeKey), stats: historyStats(id) });
  });

  app.get("/admin/monitoring/servers/:id/detail", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = int((req.params as any)?.id);
    const row = getMonitoredServer(id);
    if (!row) return reply.code(404).send({ ok: false, error: "not_found" });
    const current = getServerStatusSnapshot([row])[0] ?? null;
    return reply.send({
      ok: true,
      server: toAdminServer(row),
      current,
      activeIncidents: listActiveIncidents(id),
      recentIncidents: listRecentIncidents(20, id),
      historyStats: historyStats(id),
    });
  });

  app.get("/admin/monitoring/incidents", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const serverId = int((req.query as any)?.serverId);
    const limit = int((req.query as any)?.limit, 50);
    const active = serverId ? listActiveIncidents(serverId) : listActiveIncidents();
    return reply.send({
      ok: true,
      active,
      recent: listRecentIncidents(limit, serverId || undefined),
      events: listRecentEvents(30),
      counts: countActiveIncidents(),
    });
  });

  app.get("/admin/monitoring/summary", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const rows = listMonitoredServers({ includeInactive: true });
    const activeRows = rows.filter((r) => Number(r.active) === 1);
    const checks = getServerStatusSnapshot(activeRows);
    const counts = countActiveIncidents();
    const globalOnlineUsers = getRemnawaveGlobalStates().reduce<number | null>((acc, s) => {
      if (s.globalOnlineUsers == null) return acc;
      return acc == null ? s.globalOnlineUsers : Math.max(acc, s.globalOnlineUsers);
    }, null);

    return reply.send({
      ok: true,
      updatedAt: getServerStatusMeta().updatedAt,
      totals: {
        all: activeRows.length,
        online: checks.filter((c) => c.online === true).length,
        offline: checks.filter((c) => c.online === false).length,
        vpn: activeRows.filter((r) => r.kind === "vpn").length,
        gateway: activeRows.filter((r) => r.kind === "gateway").length,
        infra: activeRows.filter((r) => r.kind === "infra").length,
        public: activeRows.filter((r) => r.visibility === "public").length,
        adminOnly: activeRows.filter((r) => r.visibility === "admin_only").length,
      },
      incidents: counts,
      globalOnlineUsers,
      integrations: listPublicIntegrations(),
      remnawaveStates: getRemnawaveGlobalStates(),
    });
  });
}

function emptyProbe() {
  return {
    reachable: false,
    authOk: false,
    metricsReceived: false,
    nodeMetricsFound: false,
    onlineUsersMetricPresent: false,
    nodeCount: 0,
    presentMetrics: [] as string[],
    errorCode: null as string | null,
  };
}