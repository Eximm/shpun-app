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
  getCollectorObservability,
  getServerStatusMeta,
  getServerStatusSnapshot,
  probeNodeExporter,
  requestForcedCollection,
  setMonitoringIncidentHandler,
  startServerStatusMonitor,
} from "./monitor.js";
import { deleteCurrent, getCurrent } from "./currentRepo.js";
import { aggregateHealthStatus, toPublicCheck } from "./health.js";
import { isServerStatusAdmin } from "./adminGuard.js";
import { getGlobalThresholds, resolveThresholds, setGlobalThresholds } from "./settingsRepo.js";
import { historyStats, querySeries, querySeriesMeta } from "./historyRepo.js";
import {
  countActiveIncidents,
  countIncidents,
  listActiveIncidents,
  listIncidentsInRange,
  listRecentEvents,
  listRecentIncidents,
  queryIncidents,
  type MonitoringIncidentRow,
} from "./incidentsRepo.js";
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

const RANGE_SECONDS = { "1h": 3600, "24h": 86400, "7d": 7 * 86400, "30d": 30 * 86400 } as const;
type RangeKey = keyof typeof RANGE_SECONDS;

function parseRange(v: unknown): RangeKey {
  const s = String(v ?? "").trim();
  return s === "1h" || s === "24h" || s === "7d" || s === "30d" ? s : "24h";
}

/** UI-oriented incident projection (admin-only, no raw context). */
function toIncidentDto(row: MonitoringIncidentRow, fallbackTitle?: string | null) {
  return {
    id: row.id,
    serverId: row.server_id,
    serverTitle: row.server_title || fallbackTitle || `#${row.server_id}`,
    serverKind: row.server_kind ?? null,
    ruleType: row.rule_type,
    severity: row.severity,
    state: row.state,
    openedAt: row.opened_at,
    confirmedAt: row.confirmed_at,
    resolvedAt: row.resolved_at,
    lastSeenAt: row.last_seen_at,
    value: row.value,
    triggerValue: row.trigger_value ?? null,
    peakValue: row.peak_value ?? row.value ?? null,
    threshold: row.threshold,
    message: row.message,
    context: safeUplinkContext(row),
    durationSec: Math.max(0, (row.resolved_at ?? Math.floor(Date.now() / 1000)) - row.opened_at),
  };
}

/** Whitelisted, safe diagnostic context for uplink incidents only. */
function safeUplinkContext(row: MonitoringIncidentRow) {
  if (row.rule_type !== "uplink_saturation" || !row.context_json) return null;
  try {
    const c = JSON.parse(row.context_json) as Record<string, unknown>;
    const num = (v: unknown) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const source = String(c.capacitySource ?? "unknown");
    return {
      rxBps: num(c.rxBps),
      txBps: num(c.txBps),
      capacityBps: num(c.capacityBps),
      capacitySource: source === "configured" || source === "detected" ? source : "unknown",
      calculatedPct: num(c.calculatedPct),
      threshold: num(c.threshold),
    };
  } catch {
    return null;
  }
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
    const byId = new Map(rows.map((r) => [r.id, r]));
    const checks = getServerStatusSnapshot(rows);
    const meta = getServerStatusMeta();
    return reply.send({
      ok: true,
      status: aggregateHealthStatus(
        checks.map((c) => ({
          kind: c.kind,
          online: c.online,
          visibility: byId.get(c.id)?.visibility,
          affectsPublicHealth: byId.get(c.id)?.affects_public_health === 1,
        })),
      ),
      updatedAt: meta.updatedAt,
    });
  });

  // User-facing status page data. Public visibility only; sanitized projection.
  // Pure DB read — never triggers a scrape.
  app.get("/server-status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const rows = listPublicServers();
    const checks = getServerStatusSnapshot(rows);
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

  // Read-only "re-read latest state". Kept for backward compatibility with any
  // client that used to trigger a scrape here; it no longer touches the network.
  app.post("/server-status/refresh", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const meta = getServerStatusMeta();
    return reply.send({
      ok: true,
      refresh: { started: false, reason: "read_only" },
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
    // No scrape here: the background collector picks up the new server on the
    // next cycle (current may be null until then).
    return reply.send({ ok: true, item: toAdminServer(result.item) });
  });

  app.put("/admin/monitored-servers/:id", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = int((req.params as any)?.id);
    const result = updateMonitoredServer(id, (req.body ?? {}) as any);
    if (!result.ok) return reply.code(result.error === "not_found" ? 404 : 400).send({ ok: false, error: result.error });
    // Config-only mutation: existing monitoring_current for this and every
    // other server is preserved; the collector refreshes it on the next cycle.
    return reply.send({ ok: true, item: toAdminServer(result.item) });
  });

  app.delete("/admin/monitored-servers/:id", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const item = getMonitoredServer(int((req.params as any)?.id));
    if (!item) return reply.code(404).send({ ok: false, error: "not_found" });
    const deleted = deleteMonitoredServer(item.id);
    // Remove only this server's current row; history/incidents stay for
    // retention/evidence.
    deleteCurrent(item.id);
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
    const rangeKey = parseRange((req.query as any)?.range);
    const series = querySeriesMeta(id, rangeKey === "30d" ? "7d" : rangeKey);
    const thresholds = resolveThresholds(row.thresholds_json);
    const now = Math.floor(Date.now() / 1000);
    const from = now - RANGE_SECONDS[rangeKey];
    const currentRow = getCurrent(id);
    return reply.send({
      ok: true,
      range: rangeKey,
      resolution: series.resolution,
      points: series.points,
      stats: historyStats(id),
      meta: {
        // Source of truth: the same resolveThresholds the incident engine uses.
        effectiveThresholds: {
          cpuPct: thresholds.cpuPct,
          memoryWarnPct: thresholds.memoryWarnPct,
          memoryCritPct: thresholds.memoryCritPct,
          diskWarnPct: thresholds.diskWarnPct,
          diskCritPct: thresholds.diskCritPct,
          inodeWarnPct: thresholds.inodeWarnPct,
          uplinkWarnPct: thresholds.uplinkWarnPct,
        },
        uplinkMbps: row.uplink_mbps,
        uplinkCapacityBps: currentRow?.uplinkCapacityBps ?? null,
        uplinkCapacitySource: currentRow?.uplinkCapacitySource ?? "unknown",
      },
      incidents: listIncidentsInRange(id, from, now).map((inc) => toIncidentDto(inc, row.title)),
    });
  });

  app.get("/admin/monitoring/servers/:id/detail", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const id = int((req.params as any)?.id);
    const row = getMonitoredServer(id);
    if (!row) return reply.code(404).send({ ok: false, error: "not_found" });
    const current = getServerStatusSnapshot([row])[0] ?? null;
    const thresholds = resolveThresholds(row.thresholds_json);
    return reply.send({
      ok: true,
      server: toAdminServer(row),
      current,
      effectiveThresholds: {
        cpuPct: thresholds.cpuPct,
        memoryWarnPct: thresholds.memoryWarnPct,
        memoryCritPct: thresholds.memoryCritPct,
        diskWarnPct: thresholds.diskWarnPct,
        diskCritPct: thresholds.diskCritPct,
        inodeWarnPct: thresholds.inodeWarnPct,
        uplinkWarnPct: thresholds.uplinkWarnPct,
      },
      activeIncidents: listActiveIncidents(id).map((inc) => toIncidentDto(inc, row.title)),
      recentIncidents: listRecentIncidents(20, id).map((inc) => toIncidentDto(inc, row.title)),
      historyStats: historyStats(id),
    });
  });

  app.get("/admin/monitoring/incidents", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const q = (req.query ?? {}) as any;
    const serverId = int(q.serverId);
    const statusRaw = String(q.status ?? q.state ?? "").trim();
    const status = statusRaw === "resolved" || statusRaw === "all" ? statusRaw : "active";
    const severityRaw = String(q.severity ?? "").trim();
    const severity = severityRaw === "critical" || severityRaw === "warning" || severityRaw === "info" ? severityRaw : undefined;
    const rangeKey = parseRange(q.range ?? "7d");
    const fromTs = status === "active" ? undefined : Math.floor(Date.now() / 1000) - RANGE_SECONDS[rangeKey];
    const limit = Math.min(200, Math.max(1, int(q.limit, 50)));
    const offset = Math.max(0, int(q.offset, 0));

    const servers = listMonitoredServers({ includeInactive: true });
    const titleById = new Map(servers.map((s) => [s.id, s.title]));
    const dto = (inc: MonitoringIncidentRow) => toIncidentDto(inc, titleById.get(inc.server_id) ?? null);

    const active = queryIncidents({ serverId: serverId || undefined, status: "active", severity, limit, offset });
    const history = queryIncidents({ serverId: serverId || undefined, status: "resolved", severity, fromTs, limit, offset });
    const totalHistory = countIncidents({ serverId: serverId || undefined, status: "resolved", severity, fromTs });

    return reply.send({
      ok: true,
      status,
      severity: severity ?? null,
      range: rangeKey,
      counts: countActiveIncidents(),
      total: totalHistory,
      active: active.map(dto),
      history: history.map(dto),
      // Backward-compatible aliases for existing consumers.
      recent: history.map(dto),
      events: listRecentEvents(30),
    });
  });

  // Explicit admin "check now". Rate-limited, admin-only, respects the
  // single-collector lease and the in-flight guard. Never used by normal UI
  // refresh (which only re-reads persisted state).
  app.post("/admin/monitoring/collect-now", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const result = await requestForcedCollection(listMonitoredServers(), app.log);
    return reply.send({ ok: true, collect: result, collector: getCollectorObservability() });
  });

  app.get("/admin/monitoring/summary", async (req, reply) => {
    if (!(await requireAdmin(req, reply))) return;
    const rows = listMonitoredServers({ includeInactive: true });
    const activeRows = rows.filter((r) => Number(r.active) === 1);
    const checks = getServerStatusSnapshot(activeRows);
    const counts = countActiveIncidents();

    return reply.send({
      ok: true,
      updatedAt: getServerStatusMeta().updatedAt,
      totals: {
        all: activeRows.length,
        online: checks.filter((c) => c.online === true).length,
        offline: checks.filter((c) => c.online === false).length,
        stale: checks.filter((c) => c.state === "stale").length,
        noData: checks.filter((c) => c.state === "no_data").length,
        vpn: activeRows.filter((r) => r.kind === "vpn").length,
        gateway: activeRows.filter((r) => r.kind === "gateway").length,
        infra: activeRows.filter((r) => r.kind === "infra").length,
        public: activeRows.filter((r) => r.visibility === "public").length,
        adminOnly: activeRows.filter((r) => r.visibility === "admin_only").length,
      },
      incidents: counts,
      collector: getCollectorObservability(),
    });
  });
}
