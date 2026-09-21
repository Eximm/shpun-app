// api/src/modules/serverStatus/historyRepo.ts
//
// Monitoring history storage: raw 1-minute samples + 5-minute and 1-hour
// aggregates for trends/graphs/incidents. Retention is bounded:
//   0–48h   raw 1m
//   2–14d   5m aggregates
//   14–90d  1h aggregates
//   >90d    deleted
//
// All operations are independent per statement so a failed history write can
// never destroy the current in-memory snapshot.

import { linkDb } from "../../shared/linkdb/db.js";
import type { MonitoringThresholds } from "./settingsRepo.js";

export type MonitoringSample = {
  online: boolean | null;
  latencyMs: number | null;
  cpuPct: number | null;
  iowaitPct: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  memoryUsedPct: number | null;
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
  remnawaveOnline: boolean | null;
  onlineUsers: number | null;
  /** Where the data came from: node_exporter, remnawave, both, none. */
  source: "node_exporter" | "remnawave" | "both" | "none";
};

linkDb.exec(`
CREATE TABLE IF NOT EXISTS monitoring_samples (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER NOT NULL,
  ts INTEGER NOT NULL,
  online INTEGER,
  latency_ms REAL,
  cpu_pct REAL,
  iowait_pct REAL,
  load1 REAL,
  load5 REAL,
  load15 REAL,
  memory_used_pct REAL,
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
  remnawave_online INTEGER,
  online_users INTEGER,
  source TEXT NOT NULL DEFAULT 'none',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_monitoring_samples_server_ts
  ON monitoring_samples(server_id, ts);

CREATE TABLE IF NOT EXISTS monitoring_aggregates (
  resolution TEXT NOT NULL,
  server_id INTEGER NOT NULL,
  bucket_ts INTEGER NOT NULL,
  sample_count INTEGER NOT NULL DEFAULT 0,
  cpu_avg REAL, cpu_min REAL, cpu_max REAL,
  mem_avg REAL, mem_min REAL, mem_max REAL,
  disk_avg REAL, disk_min REAL, disk_max REAL,
  rx_avg REAL, rx_min REAL, rx_max REAL,
  tx_avg REAL, tx_min REAL, tx_max REAL,
  load1_avg REAL, load1_min REAL, load1_max REAL,
  uplink_avg REAL, uplink_min REAL, uplink_max REAL,
  swap_avg REAL,
  inode_avg REAL,
  PRIMARY KEY (resolution, server_id, bucket_ts)
);

CREATE INDEX IF NOT EXISTS idx_monitoring_aggregates_lookup
  ON monitoring_aggregates(server_id, resolution, bucket_ts);
`);

const insertSampleStmt = linkDb.prepare(`
  INSERT INTO monitoring_samples
    (server_id, ts, online, latency_ms, cpu_pct, iowait_pct, load1, load5, load15,
     memory_used_pct, swap_used_pct, disk_used_pct, disk_free_bytes, inode_used_pct,
     rx_bps, tx_bps, uplink_used_pct, rx_drops_delta, tx_drops_delta,
     rx_errors_delta, tx_errors_delta, system_uptime_sec, reboot_detected,
     remnawave_online, online_users, source)
  VALUES
    (@server_id, @ts, @online, @latency_ms, @cpu_pct, @iowait_pct, @load1, @load5, @load15,
     @memory_used_pct, @swap_used_pct, @disk_used_pct, @disk_free_bytes, @inode_used_pct,
     @rx_bps, @tx_bps, @uplink_used_pct, @rx_drops_delta, @tx_drops_delta,
     @rx_errors_delta, @tx_errors_delta, @system_uptime_sec, @reboot_detected,
     @remnawave_online, @online_users, @source)
`);

function boolOrNull(v: boolean | null): number | null {
  return v == null ? null : v ? 1 : 0;
}

function num(v: number | null): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

export function insertSample(serverId: number, ts: number, sample: MonitoringSample) {
  insertSampleStmt.run({
    server_id: serverId,
    ts: Math.trunc(ts),
    online: boolOrNull(sample.online),
    latency_ms: num(sample.latencyMs),
    cpu_pct: num(sample.cpuPct),
    iowait_pct: num(sample.iowaitPct),
    load1: num(sample.load1),
    load5: num(sample.load5),
    load15: num(sample.load15),
    memory_used_pct: num(sample.memoryUsedPct),
    swap_used_pct: num(sample.swapUsedPct),
    disk_used_pct: num(sample.diskUsedPct),
    disk_free_bytes: num(sample.diskFreeBytes),
    inode_used_pct: num(sample.inodeUsedPct),
    rx_bps: num(sample.rxBps),
    tx_bps: num(sample.txBps),
    uplink_used_pct: num(sample.uplinkUsedPct),
    rx_drops_delta: num(sample.rxDropsDelta),
    tx_drops_delta: num(sample.txDropsDelta),
    rx_errors_delta: num(sample.rxErrorsDelta),
    tx_errors_delta: num(sample.txErrorsDelta),
    system_uptime_sec: num(sample.systemUptimeSec),
    reboot_detected: sample.rebootDetected ? 1 : 0,
    remnawave_online: boolOrNull(sample.remnawaveOnline),
    online_users: num(sample.onlineUsers),
    source: sample.source,
  });
}

export type HistoryPoint = {
  ts: number;
  cpuAvg: number | null;
  cpuMin: number | null;
  cpuMax: number | null;
  memAvg: number | null;
  memMin: number | null;
  memMax: number | null;
  diskAvg: number | null;
  diskMin: number | null;
  diskMax: number | null;
  rxAvg: number | null;
  rxMin: number | null;
  rxMax: number | null;
  txAvg: number | null;
  txMin: number | null;
  txMax: number | null;
  load1Avg: number | null;
  uplinkAvg: number | null;
  uplinkMin: number | null;
  uplinkMax: number | null;
};

export type HistoryResolution = "raw" | "5m" | "1h";

export type HistorySeries = { points: HistoryPoint[]; resolution: HistoryResolution };

function rowsToSeries(rows: any[]): HistoryPoint[] {
  return rows.map((r) => ({
    ts: Number(r.ts),
    cpuAvg: nullable(r.cpu_avg),
    cpuMin: nullable(r.cpu_min ?? r.cpu_avg),
    cpuMax: nullable(r.cpu_max ?? r.cpu_avg),
    memAvg: nullable(r.mem_avg),
    memMin: nullable(r.mem_min ?? r.mem_avg),
    memMax: nullable(r.mem_max ?? r.mem_avg),
    diskAvg: nullable(r.disk_avg),
    diskMin: nullable(r.disk_min ?? r.disk_avg),
    diskMax: nullable(r.disk_max ?? r.disk_avg),
    rxAvg: nullable(r.rx_avg),
    rxMin: nullable(r.rx_min ?? r.rx_avg),
    rxMax: nullable(r.rx_max ?? r.rx_avg),
    txAvg: nullable(r.tx_avg),
    txMin: nullable(r.tx_min ?? r.tx_avg),
    txMax: nullable(r.tx_max ?? r.tx_avg),
    load1Avg: nullable(r.load1_avg),
    uplinkAvg: nullable(r.uplink_avg),
    uplinkMin: nullable(r.uplink_min ?? r.uplink_avg),
    uplinkMax: nullable(r.uplink_max ?? r.uplink_avg),
  }));
}

function nullable(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const RAW_SQL = `
  SELECT ts,
         cpu_pct AS cpu_avg, cpu_pct AS cpu_min, cpu_pct AS cpu_max,
         memory_used_pct AS mem_avg, memory_used_pct AS mem_min, memory_used_pct AS mem_max,
         disk_used_pct AS disk_avg, disk_used_pct AS disk_min, disk_used_pct AS disk_max,
         rx_bps AS rx_avg, rx_bps AS rx_min, rx_bps AS rx_max,
         tx_bps AS tx_avg, tx_bps AS tx_min, tx_bps AS tx_max,
         load1 AS load1_avg,
         uplink_used_pct AS uplink_avg, uplink_used_pct AS uplink_min, uplink_used_pct AS uplink_max
  FROM monitoring_samples
  WHERE server_id = ? AND ts >= ?
  ORDER BY ts ASC
`;

const AGG_SQL = `
  SELECT bucket_ts AS ts, sample_count,
         cpu_avg, cpu_min, cpu_max, mem_avg, mem_min, mem_max,
         disk_avg, disk_min, disk_max, rx_avg, rx_min, rx_max,
         tx_avg, tx_min, tx_max, load1_avg, uplink_avg, uplink_min, uplink_max
  FROM monitoring_aggregates
  WHERE server_id = ? AND resolution = ? AND bucket_ts >= ?
  ORDER BY bucket_ts ASC
`;

/**
 * Query a compact time series with the resolution actually used.
 *   "1h"  -> raw 1m samples.
 *   "24h" -> 5m aggregates (fallback to raw while the downsampler catches up).
 *   "7d"  -> 1h aggregates (fallback to 5m).
 */
export function querySeriesMeta(serverId: number, rangeKey: "1h" | "24h" | "7d"): HistorySeries {
  const now = Math.floor(Date.now() / 1000);
  const spec = {
    "1h": { from: now - 3600, resolution: "raw" as const },
    "24h": { from: now - 86400, resolution: "5m" as const },
    "7d": { from: now - 7 * 86400, resolution: "1h" as const },
  }[rangeKey];

  if (spec.resolution === "raw") {
    const rows = linkDb.prepare(RAW_SQL).all(serverId, spec.from) as any[];
    return { points: rowsToSeries(rows), resolution: "raw" };
  }

  const primary = linkDb.prepare(AGG_SQL).all(serverId, spec.resolution, spec.from) as any[];
  if (primary.length > 0) return { points: rowsToSeries(primary), resolution: spec.resolution };

  const fallback = spec.resolution === "5m" ? "1h" : "5m";
  if (fallback === "1h") return querySeriesMeta(serverId, "1h");
  const rows = linkDb.prepare(AGG_SQL).all(serverId, fallback, spec.from) as any[];
  return { points: rowsToSeries(rows), resolution: "5m" };
}

export function querySeries(serverId: number, rangeKey: "1h" | "24h" | "7d") {
  return querySeriesMeta(serverId, rangeKey).points;
}

/**
 * Build 5-minute and 1-hour aggregates from raw samples. Idempotent per bucket
 * (INSERT OR REPLACE), so running it repeatedly never duplicates data.
 */
export function runDownsampling() {
  const now = Math.floor(Date.now() / 1000);

  // 5m aggregates from raw samples older than 5 minutes.
  const rawCutoff = now - 5 * 60;
  const fiveFrom = aggregateRaw("5m", 300, rawCutoff);
  const hourFrom = aggregateAggregates("1h", 3600, now - 2 * 3600);

  return { fiveFrom, hourFrom };
}

const FIVE_MIN_SQL = `
  INSERT OR REPLACE INTO monitoring_aggregates
    (resolution, server_id, bucket_ts, sample_count,
     cpu_avg, cpu_min, cpu_max, mem_avg, mem_min, mem_max,
     disk_avg, disk_min, disk_max, rx_avg, rx_min, rx_max,
     tx_avg, tx_min, tx_max, load1_avg, load1_min, load1_max,
     uplink_avg, uplink_min, uplink_max, swap_avg, inode_avg)
  SELECT '5m', server_id, CAST(ts / 300 AS INTEGER) * 300, COUNT(*),
     AVG(cpu_pct), MIN(cpu_pct), MAX(cpu_pct),
     AVG(memory_used_pct), MIN(memory_used_pct), MAX(memory_used_pct),
     AVG(disk_used_pct), MIN(disk_used_pct), MAX(disk_used_pct),
     AVG(rx_bps), MIN(rx_bps), MAX(rx_bps),
     AVG(tx_bps), MIN(tx_bps), MAX(tx_bps),
     AVG(load1), MIN(load1), MAX(load1),
     AVG(uplink_used_pct), MIN(uplink_used_pct), MAX(uplink_used_pct),
     AVG(swap_used_pct), AVG(inode_used_pct)
  FROM monitoring_samples
  WHERE ts < ?
  GROUP BY server_id, CAST(ts / 300 AS INTEGER)
`;

const HOUR_SQL = `
  INSERT OR REPLACE INTO monitoring_aggregates
    (resolution, server_id, bucket_ts, sample_count,
     cpu_avg, cpu_min, cpu_max, mem_avg, mem_min, mem_max,
     disk_avg, disk_min, disk_max, rx_avg, rx_min, rx_max,
     tx_avg, tx_min, tx_max, load1_avg, load1_min, load1_max,
     uplink_avg, uplink_min, uplink_max, swap_avg, inode_avg)
  SELECT '1h', server_id, CAST(bucket_ts / 3600 AS INTEGER) * 3600, SUM(sample_count),
     AVG(cpu_avg), MIN(cpu_min), MAX(cpu_max),
     AVG(mem_avg), MIN(mem_min), MAX(mem_max),
     AVG(disk_avg), MIN(disk_min), MAX(disk_max),
     AVG(rx_avg), MIN(rx_min), MAX(rx_max),
     AVG(tx_avg), MIN(tx_min), MAX(tx_max),
     AVG(load1_avg), MIN(load1_min), MAX(load1_max),
     AVG(uplink_avg), MIN(uplink_min), MAX(uplink_max),
     AVG(swap_avg), AVG(inode_avg)
  FROM monitoring_aggregates
  WHERE resolution = '5m' AND bucket_ts < ?
  GROUP BY server_id, CAST(bucket_ts / 3600 AS INTEGER)
`;

function aggregateRaw(_resolution: string, _bucket: number, before: number) {
  return linkDb.prepare(FIVE_MIN_SQL).run(before).changes;
}

function aggregateAggregates(_resolution: string, _bucket: number, before: number) {
  return linkDb.prepare(HOUR_SQL).run(before).changes;
}

/** Apply retention windows. Returns deleted row counts. */
export function runRetention(thresholds: MonitoringThresholds, now = Math.floor(Date.now() / 1000)) {
  const rawBefore = now - thresholds.retentionRawHours * 3600;
  const fiveBefore = now - thresholds.retentionFiveMinDays * 86400;
  const hourBefore = now - thresholds.retentionHourDays * 86400;

  const raw = linkDb.prepare(`DELETE FROM monitoring_samples WHERE ts < ?`).run(rawBefore).changes;
  const five = linkDb
    .prepare(`DELETE FROM monitoring_aggregates WHERE resolution = '5m' AND bucket_ts < ?`)
    .run(fiveBefore).changes;
  const hour = linkDb
    .prepare(`DELETE FROM monitoring_aggregates WHERE resolution = '1h' AND bucket_ts < ?`)
    .run(hourBefore).changes;

  return { raw, fiveMin: five, hour };
}

/** Recent samples for the anomaly engine (oldest -> newest, excludes current). */
export function recentSamples(serverId: number, limit = 30) {
  const rows = linkDb
    .prepare(`
      SELECT * FROM monitoring_samples
      WHERE server_id = ?
      ORDER BY ts DESC
      LIMIT ?
    `)
    .all(serverId, Math.max(1, Math.min(240, limit))) as any[];
  return rows.reverse();
}

export function historyStats(serverId?: number) {
  const where = serverId ? `WHERE server_id = ${Math.trunc(serverId)}` : "";
  const raw = linkDb.prepare(`SELECT COUNT(*) AS c FROM monitoring_samples ${where}`).get() as { c: number };
  const five = linkDb
    .prepare(`SELECT COUNT(*) AS c FROM monitoring_aggregates WHERE resolution = '5m' ${serverId ? `AND server_id = ${Math.trunc(serverId)}` : ""}`)
    .get() as { c: number };
  const hour = linkDb
    .prepare(`SELECT COUNT(*) AS c FROM monitoring_aggregates WHERE resolution = '1h' ${serverId ? `AND server_id = ${Math.trunc(serverId)}` : ""}`)
    .get() as { c: number };
  return { raw: raw.c, fiveMin: five.c, hour: hour.c };
}