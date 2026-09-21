// api/src/modules/serverStatus/currentRepo.ts
//
// `monitoring_current` — the canonical, persistent current state of every
// monitored server (one row per server). It is the single source of truth for
// all display reads (public, admin, dashboard). The in-memory collector is only
// a writer/cache; correctness never depends on process memory, so a restart
// immediately serves the last known snapshot.
//
// Also stores a single-row `monitoring_collector_state` with safe operational
// counters (no secrets, no exporter URLs) for observability.

import { linkDb } from "../../shared/linkdb/db.js";

export type CurrentState = "fresh" | "stale" | "offline" | "no_data";

export type CurrentRecord = {
  serverId: number;
  updatedAt: number;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  state: CurrentState;
  online: boolean | null;
  stale: boolean;
  consecutiveFailures: number;
  lastErrorCode: string | null;

  cpuPct: number | null;
  iowaitPct: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  cpuCores: number | null;

  memoryUsedPct: number | null;
  memoryTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  swapUsedPct: number | null;

  diskUsedPct: number | null;
  diskFreeBytes: number | null;
  inodeUsedPct: number | null;

  rxBps: number | null;
  txBps: number | null;
  uplinkUsedPct: number | null;
  rxDropsDelta: number | null;
  txDropsDelta: number | null;
  rxErrorsDelta: number | null;
  txErrorsDelta: number | null;

  systemUptimeSec: number | null;
  rebootDetected: boolean;

  nodeExporterStatus: string;
  nodeExporterLatencyMs: number | null;
  remnawaveStatus: string;
  onlineUsers: number | null;

  fileDescriptors: number | null;
  sockets: number | null;
  source: string;
  checkedAt: string | null;
};

export type CollectorState = {
  lastCycleAt: number | null;
  lastCycleStartedAt: number | null;
  lastCycleDurationMs: number | null;
  serversAttempted: number;
  serversSucceeded: number;
  serversFailed: number;
  remnawaveAttempted: number;
  remnawaveSucceeded: number;
  remnawaveFailed: number;
  collectorRunning: boolean;
  leaseOwner: string | null;
  leaseExpiresAt: number | null;
};

linkDb.exec(`
CREATE TABLE IF NOT EXISTS monitoring_current (
  server_id INTEGER PRIMARY KEY,
  updated_at INTEGER NOT NULL,
  last_attempt_at INTEGER,
  last_success_at INTEGER,
  state TEXT NOT NULL DEFAULT 'no_data',
  online INTEGER,
  stale INTEGER NOT NULL DEFAULT 0,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  last_error_code TEXT,

  cpu_pct REAL,
  iowait_pct REAL,
  load1 REAL,
  load5 REAL,
  load15 REAL,
  cpu_cores REAL,

  memory_used_pct REAL,
  memory_total_bytes REAL,
  memory_available_bytes REAL,
  swap_used_pct REAL,

  disk_used_pct REAL,
  disk_free_bytes REAL,
  inode_used_pct REAL,

  rx_bps REAL,
  tx_bps REAL,
  uplink_used_pct REAL,
  rx_drops_delta REAL,
  tx_drops_delta REAL,
  rx_errors_delta REAL,
  tx_errors_delta REAL,

  system_uptime_sec REAL,
  reboot_detected INTEGER NOT NULL DEFAULT 0,

  node_exporter_status TEXT NOT NULL DEFAULT 'unknown',
  node_exporter_latency_ms REAL,
  remnawave_status TEXT NOT NULL DEFAULT 'unknown',
  online_users INTEGER,

  file_descriptors REAL,
  sockets REAL,
  source TEXT NOT NULL DEFAULT 'none',
  checked_at TEXT
);

CREATE TABLE IF NOT EXISTS monitoring_collector_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_cycle_at INTEGER,
  last_cycle_started_at INTEGER,
  last_cycle_duration_ms INTEGER,
  servers_attempted INTEGER NOT NULL DEFAULT 0,
  servers_succeeded INTEGER NOT NULL DEFAULT 0,
  servers_failed INTEGER NOT NULL DEFAULT 0,
  remnawave_attempted INTEGER NOT NULL DEFAULT 0,
  remnawave_succeeded INTEGER NOT NULL DEFAULT 0,
  remnawave_failed INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

function num(v: number | null): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

export function computeState(online: boolean | null, stale: boolean): CurrentState {
  if (online == null) return "no_data";
  if (online === false) return "offline";
  return stale ? "stale" : "fresh";
}

const upsertStmt = linkDb.prepare(`
  INSERT INTO monitoring_current (
    server_id, updated_at, last_attempt_at, last_success_at, state, online, stale,
    consecutive_failures, last_error_code,
    cpu_pct, iowait_pct, load1, load5, load15, cpu_cores,
    memory_used_pct, memory_total_bytes, memory_available_bytes, swap_used_pct,
    disk_used_pct, disk_free_bytes, inode_used_pct,
    rx_bps, tx_bps, uplink_used_pct, rx_drops_delta, tx_drops_delta, rx_errors_delta, tx_errors_delta,
    system_uptime_sec, reboot_detected,
    node_exporter_status, node_exporter_latency_ms, remnawave_status, online_users,
    file_descriptors, sockets, source, checked_at
  ) VALUES (
    @server_id, @updated_at, @last_attempt_at, @last_success_at, @state, @online, @stale,
    @consecutive_failures, @last_error_code,
    @cpu_pct, @iowait_pct, @load1, @load5, @load15, @cpu_cores,
    @memory_used_pct, @memory_total_bytes, @memory_available_bytes, @swap_used_pct,
    @disk_used_pct, @disk_free_bytes, @inode_used_pct,
    @rx_bps, @tx_bps, @uplink_used_pct, @rx_drops_delta, @tx_drops_delta, @rx_errors_delta, @tx_errors_delta,
    @system_uptime_sec, @reboot_detected,
    @node_exporter_status, @node_exporter_latency_ms, @remnawave_status, @online_users,
    @file_descriptors, @sockets, @source, @checked_at
  )
  ON CONFLICT(server_id) DO UPDATE SET
    updated_at = excluded.updated_at,
    last_attempt_at = excluded.last_attempt_at,
    last_success_at = excluded.last_success_at,
    state = excluded.state,
    online = excluded.online,
    stale = excluded.stale,
    consecutive_failures = excluded.consecutive_failures,
    last_error_code = excluded.last_error_code,
    cpu_pct = excluded.cpu_pct, iowait_pct = excluded.iowait_pct,
    load1 = excluded.load1, load5 = excluded.load5, load15 = excluded.load15,
    cpu_cores = excluded.cpu_cores,
    memory_used_pct = excluded.memory_used_pct,
    memory_total_bytes = excluded.memory_total_bytes,
    memory_available_bytes = excluded.memory_available_bytes,
    swap_used_pct = excluded.swap_used_pct,
    disk_used_pct = excluded.disk_used_pct,
    disk_free_bytes = excluded.disk_free_bytes,
    inode_used_pct = excluded.inode_used_pct,
    rx_bps = excluded.rx_bps, tx_bps = excluded.tx_bps,
    uplink_used_pct = excluded.uplink_used_pct,
    rx_drops_delta = excluded.rx_drops_delta, tx_drops_delta = excluded.tx_drops_delta,
    rx_errors_delta = excluded.rx_errors_delta, tx_errors_delta = excluded.tx_errors_delta,
    system_uptime_sec = excluded.system_uptime_sec,
    reboot_detected = excluded.reboot_detected,
    node_exporter_status = excluded.node_exporter_status,
    node_exporter_latency_ms = excluded.node_exporter_latency_ms,
    remnawave_status = excluded.remnawave_status,
    online_users = excluded.online_users,
    file_descriptors = excluded.file_descriptors,
    sockets = excluded.sockets,
    source = excluded.source,
    checked_at = excluded.checked_at
`);

function boolOrNull(v: boolean | null): number | null {
  return v == null ? null : v ? 1 : 0;
}

export function upsertCurrent(record: CurrentRecord): void {
  upsertStmt.run({
    server_id: record.serverId,
    updated_at: Math.trunc(record.updatedAt),
    last_attempt_at: record.lastAttemptAt == null ? null : Math.trunc(record.lastAttemptAt),
    last_success_at: record.lastSuccessAt == null ? null : Math.trunc(record.lastSuccessAt),
    state: record.state,
    online: boolOrNull(record.online),
    stale: record.stale ? 1 : 0,
    consecutive_failures: Math.max(0, Math.trunc(record.consecutiveFailures)),
    last_error_code: record.lastErrorCode ? String(record.lastErrorCode).slice(0, 80) : null,
    cpu_pct: num(record.cpuPct),
    iowait_pct: num(record.iowaitPct),
    load1: num(record.load1),
    load5: num(record.load5),
    load15: num(record.load15),
    cpu_cores: num(record.cpuCores),
    memory_used_pct: num(record.memoryUsedPct),
    memory_total_bytes: num(record.memoryTotalBytes),
    memory_available_bytes: num(record.memoryAvailableBytes),
    swap_used_pct: num(record.swapUsedPct),
    disk_used_pct: num(record.diskUsedPct),
    disk_free_bytes: num(record.diskFreeBytes),
    inode_used_pct: num(record.inodeUsedPct),
    rx_bps: num(record.rxBps),
    tx_bps: num(record.txBps),
    uplink_used_pct: num(record.uplinkUsedPct),
    rx_drops_delta: num(record.rxDropsDelta),
    tx_drops_delta: num(record.txDropsDelta),
    rx_errors_delta: num(record.rxErrorsDelta),
    tx_errors_delta: num(record.txErrorsDelta),
    system_uptime_sec: num(record.systemUptimeSec),
    reboot_detected: record.rebootDetected ? 1 : 0,
    node_exporter_status: String(record.nodeExporterStatus || "unknown").slice(0, 40),
    node_exporter_latency_ms: num(record.nodeExporterLatencyMs),
    remnawave_status: String(record.remnawaveStatus || "unknown").slice(0, 40),
    online_users: record.onlineUsers == null ? null : Math.trunc(record.onlineUsers),
    file_descriptors: num(record.fileDescriptors),
    sockets: num(record.sockets),
    source: String(record.source || "none").slice(0, 40),
    checked_at: record.checkedAt ?? null,
  });
}

function rowToRecord(r: any): CurrentRecord {
  return {
    serverId: Number(r.server_id),
    updatedAt: Number(r.updated_at),
    lastAttemptAt: r.last_attempt_at == null ? null : Number(r.last_attempt_at),
    lastSuccessAt: r.last_success_at == null ? null : Number(r.last_success_at),
    state: (["fresh", "stale", "offline", "no_data"].includes(r.state) ? r.state : "no_data") as CurrentState,
    online: r.online == null ? null : Number(r.online) === 1,
    stale: Number(r.stale) === 1,
    consecutiveFailures: Number(r.consecutive_failures ?? 0),
    lastErrorCode: r.last_error_code ?? null,
    cpuPct: nullable(r.cpu_pct),
    iowaitPct: nullable(r.iowait_pct),
    load1: nullable(r.load1),
    load5: nullable(r.load5),
    load15: nullable(r.load15),
    cpuCores: nullable(r.cpu_cores),
    memoryUsedPct: nullable(r.memory_used_pct),
    memoryTotalBytes: nullable(r.memory_total_bytes),
    memoryAvailableBytes: nullable(r.memory_available_bytes),
    swapUsedPct: nullable(r.swap_used_pct),
    diskUsedPct: nullable(r.disk_used_pct),
    diskFreeBytes: nullable(r.disk_free_bytes),
    inodeUsedPct: nullable(r.inode_used_pct),
    rxBps: nullable(r.rx_bps),
    txBps: nullable(r.tx_bps),
    uplinkUsedPct: nullable(r.uplink_used_pct),
    rxDropsDelta: nullable(r.rx_drops_delta),
    txDropsDelta: nullable(r.tx_drops_delta),
    rxErrorsDelta: nullable(r.rx_errors_delta),
    txErrorsDelta: nullable(r.tx_errors_delta),
    systemUptimeSec: nullable(r.system_uptime_sec),
    rebootDetected: Number(r.reboot_detected) === 1,
    nodeExporterStatus: String(r.node_exporter_status ?? "unknown"),
    nodeExporterLatencyMs: nullable(r.node_exporter_latency_ms),
    remnawaveStatus: String(r.remnawave_status ?? "unknown"),
    onlineUsers: r.online_users == null ? null : Number(r.online_users),
    fileDescriptors: nullable(r.file_descriptors),
    sockets: nullable(r.sockets),
    source: String(r.source ?? "none"),
    checkedAt: r.checked_at ?? null,
  };
}

function nullable(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function getCurrent(serverId: number): CurrentRecord | null {
  const row = linkDb.prepare(`SELECT * FROM monitoring_current WHERE server_id = ?`).get(serverId) as any;
  return row ? rowToRecord(row) : null;
}

export function getCurrentMany(serverIds: number[]): Map<number, CurrentRecord> {
  const out = new Map<number, CurrentRecord>();
  if (serverIds.length === 0) return out;
  const placeholders = serverIds.map(() => "?").join(",");
  const rows = linkDb
    .prepare(`SELECT * FROM monitoring_current WHERE server_id IN (${placeholders})`)
    .all(...serverIds) as any[];
  for (const row of rows) {
    const rec = rowToRecord(row);
    out.set(rec.serverId, rec);
  }
  return out;
}

export function listCurrent(): CurrentRecord[] {
  return (linkDb.prepare(`SELECT * FROM monitoring_current`).all() as any[]).map(rowToRecord);
}

export function deleteCurrent(serverId: number): void {
  linkDb.prepare(`DELETE FROM monitoring_current WHERE server_id = ?`).run(serverId);
}

/** Remove current rows for servers that no longer exist. */
export function pruneCurrent(activeServerIds: number[]): number {
  const ids = listCurrent().map((r) => r.serverId);
  const active = new Set(activeServerIds);
  let removed = 0;
  for (const id of ids) {
    if (!active.has(id)) {
      deleteCurrent(id);
      removed += 1;
    }
  }
  return removed;
}

export function lastCurrentUpdatedAt(): number | null {
  const row = linkDb.prepare(`SELECT MAX(updated_at) AS ts FROM monitoring_current`).get() as { ts: number | null };
  return row?.ts ?? null;
}

/* ── Collector observability ────────────────────────────────────────────── */

export function getCollectorState(): CollectorState {
  const row = linkDb.prepare(`SELECT * FROM monitoring_collector_state WHERE id = 1`).get() as any;
  return {
    lastCycleAt: row?.last_cycle_at ?? null,
    lastCycleStartedAt: row?.last_cycle_started_at ?? null,
    lastCycleDurationMs: row?.last_cycle_duration_ms ?? null,
    serversAttempted: Number(row?.servers_attempted ?? 0),
    serversSucceeded: Number(row?.servers_succeeded ?? 0),
    serversFailed: Number(row?.servers_failed ?? 0),
    remnawaveAttempted: Number(row?.remnawave_attempted ?? 0),
    remnawaveSucceeded: Number(row?.remnawave_succeeded ?? 0),
    remnawaveFailed: Number(row?.remnawave_failed ?? 0),
    collectorRunning: false,
    leaseOwner: null,
    leaseExpiresAt: null,
  };
}

export function writeCollectorState(input: {
  lastCycleAt: number;
  lastCycleStartedAt: number | null;
  lastCycleDurationMs: number | null;
  serversAttempted: number;
  serversSucceeded: number;
  serversFailed: number;
  remnawaveAttempted: number;
  remnawaveSucceeded: number;
  remnawaveFailed: number;
}): void {
  linkDb.prepare(`
    INSERT INTO monitoring_collector_state
      (id, last_cycle_at, last_cycle_started_at, last_cycle_duration_ms,
       servers_attempted, servers_succeeded, servers_failed,
       remnawave_attempted, remnawave_succeeded, remnawave_failed, updated_at)
    VALUES (1, @last_cycle_at, @last_cycle_started_at, @last_cycle_duration_ms,
       @servers_attempted, @servers_succeeded, @servers_failed,
       @remnawave_attempted, @remnawave_succeeded, @remnawave_failed, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      last_cycle_at = excluded.last_cycle_at,
      last_cycle_started_at = excluded.last_cycle_started_at,
      last_cycle_duration_ms = excluded.last_cycle_duration_ms,
      servers_attempted = excluded.servers_attempted,
      servers_succeeded = excluded.servers_succeeded,
      servers_failed = excluded.servers_failed,
      remnawave_attempted = excluded.remnawave_attempted,
      remnawave_succeeded = excluded.remnawave_succeeded,
      remnawave_failed = excluded.remnawave_failed,
      updated_at = datetime('now')
  `).run({
    last_cycle_at: Math.trunc(input.lastCycleAt),
    last_cycle_started_at: input.lastCycleStartedAt == null ? null : Math.trunc(input.lastCycleStartedAt),
    last_cycle_duration_ms: input.lastCycleDurationMs == null ? null : Math.trunc(input.lastCycleDurationMs),
    servers_attempted: Math.trunc(input.serversAttempted),
    servers_succeeded: Math.trunc(input.serversSucceeded),
    servers_failed: Math.trunc(input.serversFailed),
    remnawave_attempted: Math.trunc(input.remnawaveAttempted),
    remnawave_succeeded: Math.trunc(input.remnawaveSucceeded),
    remnawave_failed: Math.trunc(input.remnawaveFailed),
  });
}