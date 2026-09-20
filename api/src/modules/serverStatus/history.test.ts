import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-history-"));
process.env.NODE_ENV = "development";

const { insertSample, querySeries, runDownsampling, runRetention, historyStats } = await import("./historyRepo.js");
const { DEFAULT_THRESHOLDS } = await import("./settingsRepo.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

function sample(cpu: number, mem: number, rx: number) {
  return {
    online: true,
    latencyMs: 12,
    cpuPct: cpu,
    iowaitPct: 1,
    load1: 1,
    load5: 1,
    load15: 1,
    memoryUsedPct: mem,
    swapUsedPct: 0,
    diskUsedPct: 30,
    diskFreeBytes: 1000,
    inodeUsedPct: 10,
    rxBps: rx,
    txBps: rx,
    uplinkUsedPct: 5,
    rxDropsDelta: 0,
    txDropsDelta: 0,
    rxErrorsDelta: 0,
    txErrorsDelta: 0,
    systemUptimeSec: 1000,
    rebootDetected: false,
    remnawaveOnline: true,
    onlineUsers: 3,
    source: "both" as const,
  };
}

const now = Math.floor(Date.now() / 1000);
const SERVER = 5001;

test("insert + query recent raw samples (1h)", () => {
  for (let i = 0; i < 5; i++) {
    insertSample(SERVER, now - i * 60, sample(10 + i, 40 + i, 1000 + i));
  }
  const points = querySeries(SERVER, "1h");
  assert.equal(points.length, 5);
  assert.ok(points[0].cpuAvg !== null);
  // ascending by time
  for (let i = 1; i < points.length; i++) assert.ok(points[i].ts >= points[i - 1].ts);
});

test("downsampling builds 5m aggregates with avg/min/max", () => {
  const oldBase = now - 3600; // > 5 minutes ago
  for (let i = 0; i < 10; i++) {
    insertSample(SERVER, oldBase + i * 10, sample(i === 0 ? 100 : 20, 50, 2000));
  }
  const result = runDownsampling();
  assert.ok(result.fiveFrom > 0);

  const rows = linkDb
    .prepare(`SELECT * FROM monitoring_aggregates WHERE server_id = ? AND resolution = '5m' ORDER BY bucket_ts ASC`)
    .all(SERVER) as any[];
  assert.ok(rows.length > 0);
  const bucket = rows.find((r) => r.cpu_max === 100);
  assert.ok(bucket, "expected a bucket containing the 100% spike");
  assert.ok(bucket.cpu_min !== null && bucket.cpu_max !== null);
  assert.ok(bucket.cpu_avg! <= bucket.cpu_max!);
});

test("24h query uses 5m aggregates", () => {
  const points = querySeries(SERVER, "24h");
  assert.ok(points.length > 0);
  assert.ok(points.some((p) => p.cpuMax === 100));
});

test("retention deletes rows older than the configured windows", () => {
  const ancient = now - 200 * 86400;
  insertSample(SERVER, ancient, sample(5, 5, 5));
  linkDb
    .prepare(`INSERT INTO monitoring_aggregates (resolution, server_id, bucket_ts, sample_count, cpu_avg) VALUES ('5m', ?, ?, 1, 5)`)
    .run(SERVER, ancient);
  linkDb
    .prepare(`INSERT INTO monitoring_aggregates (resolution, server_id, bucket_ts, sample_count, cpu_avg) VALUES ('1h', ?, ?, 1, 5)`)
    .run(SERVER, ancient);

  const deleted = runRetention(DEFAULT_THRESHOLDS, now);
  assert.ok(deleted.raw >= 1);
  assert.ok(deleted.fiveMin >= 1);
  assert.ok(deleted.hour >= 1);

  const left = linkDb.prepare(`SELECT COUNT(*) AS c FROM monitoring_samples WHERE ts < ?`).get(now - 100 * 86400) as { c: number };
  assert.equal(left.c, 0);
});

test("history stats are reported", () => {
  const stats = historyStats(SERVER);
  assert.ok(stats.raw >= 0);
  assert.ok(stats.fiveMin >= 0);
  assert.ok(stats.hour >= 0);
});

test("queries for a server with no data return an empty array", () => {
  assert.deepEqual(querySeries(999999, "1h"), []);
  assert.deepEqual(querySeries(999999, "24h"), []);
  assert.deepEqual(querySeries(999999, "7d"), []);
});

test.after(() => {
  linkDb.close();
});