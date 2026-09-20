// api/src/modules/serverStatus/incidentsRepo.ts
//
// Incident storage + lifecycle persistence.
//
// Lifecycle: NORMAL -> PENDING -> ALERTING -> RECOVERING -> RESOLVED
// One active (unresolved) incident per (server_id, rule_type). Pending rows are
// persisted so streak counters survive restarts. No raw telemetry is stored in
// the incident context — only the metric value/threshold and a short message.

import { linkDb } from "../../shared/linkdb/db.js";

export type IncidentSeverity = "info" | "warning" | "critical";
export type IncidentState = "pending" | "alerting" | "recovering" | "resolved";

export type MonitoringIncidentRow = {
  id: number;
  server_id: number;
  rule_type: string;
  severity: IncidentSeverity;
  state: IncidentState;
  opened_at: number;
  confirmed_at: number | null;
  resolved_at: number | null;
  last_seen_at: number;
  value: number | null;
  threshold: number | null;
  message: string;
  context_json: string | null;
  streak: number;
  recover_streak: number;
  notification_state: string;
  notify_count: number;
  last_notified_at: number | null;
};

linkDb.exec(`
CREATE TABLE IF NOT EXISTS monitoring_incidents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  rule_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'warning',
  state TEXT NOT NULL DEFAULT 'pending',
  opened_at INTEGER NOT NULL,
  confirmed_at INTEGER,
  resolved_at INTEGER,
  last_seen_at INTEGER NOT NULL,
  value REAL,
  threshold REAL,
  message TEXT NOT NULL DEFAULT '',
  context_json TEXT,
  streak INTEGER NOT NULL DEFAULT 0,
  recover_streak INTEGER NOT NULL DEFAULT 0,
  notification_state TEXT NOT NULL DEFAULT 'none',
  notify_count INTEGER NOT NULL DEFAULT 0,
  last_notified_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_monitoring_incidents_active
  ON monitoring_incidents(server_id, rule_type, resolved_at);
CREATE INDEX IF NOT EXISTS idx_monitoring_incidents_state
  ON monitoring_incidents(state, severity, last_seen_at);

CREATE TABLE IF NOT EXISTS monitoring_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  ts INTEGER NOT NULL,
  message TEXT NOT NULL DEFAULT '',
  context_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monitoring_events_ts
  ON monitoring_events(ts);
`);

export function findActiveIncident(serverId: number, ruleType: string) {
  return linkDb
    .prepare(`
      SELECT * FROM monitoring_incidents
      WHERE server_id = ? AND rule_type = ? AND resolved_at IS NULL
      ORDER BY id DESC
      LIMIT 1
    `)
    .get(serverId, ruleType) as MonitoringIncidentRow | undefined;
}

export function createPendingIncident(input: {
  serverId: number;
  ruleType: string;
  severity: IncidentSeverity;
  ts: number;
  value: number | null;
  threshold: number | null;
  message: string;
  context?: Record<string, unknown>;
}) {
  const info = linkDb
    .prepare(`
      INSERT INTO monitoring_incidents
        (server_id, rule_type, severity, state, opened_at, last_seen_at, value, threshold, message, context_json, streak, recover_streak)
      VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, 1, 0)
    `)
    .run(
      input.serverId,
      input.ruleType,
      input.severity,
      input.ts,
      input.ts,
      input.value,
      input.threshold,
      input.message.slice(0, 300),
      input.context ? JSON.stringify(input.context).slice(0, 2000) : null,
    );
  return findActiveIncident(input.serverId, input.ruleType) ??
    (linkDb.prepare(`SELECT * FROM monitoring_incidents WHERE id = ?`).get(Number(info.lastInsertRowid)) as MonitoringIncidentRow);
}

export function markIncidentSeen(
  id: number,
  input: { ts: number; value: number | null; severity?: IncidentSeverity; message?: string; context?: Record<string, unknown> },
) {
  linkDb
    .prepare(`
      UPDATE monitoring_incidents
      SET last_seen_at = ?,
          value = ?,
          severity = COALESCE(?, severity),
          message = COALESCE(?, message),
          context_json = COALESCE(?, context_json),
          streak = streak + 1,
          recover_streak = 0
      WHERE id = ?
    `)
    .run(
      input.ts,
      input.value,
      input.severity ?? null,
      input.message ? input.message.slice(0, 300) : null,
      input.context ? JSON.stringify(input.context).slice(0, 2000) : null,
      id,
    );
}

export function confirmIncident(id: number, ts: number) {
  linkDb
    .prepare(`
      UPDATE monitoring_incidents
      SET state = 'alerting', confirmed_at = ?, last_seen_at = ?, notification_state = 'pending'
      WHERE id = ? AND state = 'pending'
    `)
    .run(ts, ts, id);
}

export function setAlerting(id: number, ts: number) {
  linkDb
    .prepare(`UPDATE monitoring_incidents SET state = 'alerting', recover_streak = 0, last_seen_at = ? WHERE id = ? AND resolved_at IS NULL`)
    .run(ts, id);
}

export function escalateIncident(id: number, severity: IncidentSeverity, message: string) {
  linkDb
    .prepare(`UPDATE monitoring_incidents SET severity = ?, message = ? WHERE id = ? AND resolved_at IS NULL`)
    .run(severity, message.slice(0, 300), id);
}

export function markRecovering(id: number, ts: number) {
  linkDb
    .prepare(`
      UPDATE monitoring_incidents
      SET state = 'recovering', recover_streak = recover_streak + 1, last_seen_at = ?
      WHERE id = ? AND resolved_at IS NULL
    `)
    .run(ts, id);
}

export function markIncidentNotified(id: number, ts: number, state: string, notifyCount: number) {
  linkDb
    .prepare(`
      UPDATE monitoring_incidents
      SET notification_state = ?, notify_count = ?, last_notified_at = ?
      WHERE id = ?
    `)
    .run(state, notifyCount, ts, id);
}

export function resolveIncident(id: number, ts: number) {
  linkDb
    .prepare(`
      UPDATE monitoring_incidents
      SET state = 'resolved', resolved_at = ?, last_seen_at = ?, notification_state = 'resolved'
      WHERE id = ?
    `)
    .run(ts, ts, id);
}

export function dropPendingIncident(id: number) {
  linkDb.prepare(`DELETE FROM monitoring_incidents WHERE id = ?`).run(id);
}

export function getIncident(id: number) {
  return linkDb.prepare(`SELECT * FROM monitoring_incidents WHERE id = ?`).get(id) as
    | MonitoringIncidentRow
    | undefined;
}

export function listActiveIncidents(serverId?: number) {
  const sql = `
    SELECT * FROM monitoring_incidents
    WHERE resolved_at IS NULL AND state IN ('pending', 'alerting', 'recovering')
    ${serverId ? "AND server_id = ?" : ""}
    ORDER BY CASE severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, last_seen_at DESC
  `;
  return (serverId ? linkDb.prepare(sql).all(serverId) : linkDb.prepare(sql).all()) as MonitoringIncidentRow[];
}

export function listRecentIncidents(limit = 50, serverId?: number) {
  const sql = `
    SELECT * FROM monitoring_incidents
    ${serverId ? "WHERE server_id = ?" : ""}
    ORDER BY COALESCE(resolved_at, last_seen_at) DESC, id DESC
    LIMIT ?
  `;
  const n = Math.max(1, Math.min(200, limit));
  return (serverId ? linkDb.prepare(sql).all(serverId, n) : linkDb.prepare(sql).all(n)) as MonitoringIncidentRow[];
}

export type MonitoringEventRow = {
  id: number;
  server_id: number;
  type: string;
  ts: number;
  message: string;
  context_json: string | null;
};

export function insertEvent(input: {
  serverId: number;
  type: string;
  ts: number;
  message: string;
  context?: Record<string, unknown>;
}) {
  linkDb
    .prepare(`INSERT INTO monitoring_events (server_id, type, ts, message, context_json) VALUES (?, ?, ?, ?, ?)`)
    .run(input.serverId, input.type, input.ts, input.message.slice(0, 300), input.context ? JSON.stringify(input.context).slice(0, 1000) : null);
}

export function listRecentEvents(limit = 20) {
  return linkDb
    .prepare(`SELECT * FROM monitoring_events ORDER BY ts DESC, id DESC LIMIT ?`)
    .all(Math.max(1, Math.min(100, limit))) as MonitoringEventRow[];
}

export function countActiveIncidents() {
  const row = linkDb
    .prepare(`
      SELECT
        SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) AS critical,
        SUM(CASE WHEN severity = 'warning' THEN 1 ELSE 0 END) AS warning,
        COUNT(*) AS total
      FROM monitoring_incidents
      WHERE resolved_at IS NULL AND state IN ('alerting', 'recovering')
    `)
    .get() as { critical: number | null; warning: number | null; total: number | null };
  return {
    critical: Number(row?.critical ?? 0),
    warning: Number(row?.warning ?? 0),
    total: Number(row?.total ?? 0),
  };
}

/** Resolve stale incidents for servers that were removed/disabled. */
export function resolveIncidentsForMissingServers(activeServerIds: number[], ts: number) {
  const ids = new Set(activeServerIds);
  const rows = listActiveIncidents();
  let resolved = 0;
  for (const row of rows) {
    if (!ids.has(row.server_id)) {
      resolveIncident(row.id, ts);
      resolved += 1;
    }
  }
  return resolved;
}