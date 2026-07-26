import type { MonitoredServerRow } from "./repo.js";

type NetPoint = {
  ts: number;
  rx: number;
  tx: number;
};

type CpuPoint = {
  ts: number;
  total: number;
  idle: number;
};

export type ServerCheckResult = {
  id: number;
  title: string;
  host: string;
  kind: MonitoredServerRow["kind"];
  online: boolean | null;
  latencyMs: number | null;
  uptime: string | null;
  uptimeSeconds: number | null;
  loadPct: number | null;
  cpuLoadPct: number | null;
  uplinkLoadPct: number | null;
  memoryLoadPct: number | null;
  rxMbps: number | null;
  txMbps: number | null;
  checkedAt: string | null;
};

const scrapeCache = new Map<number, { ts: number; value: any }>();
const netCache = new Map<number, NetPoint>();
const cpuCache = new Map<number, CpuPoint>();
const statusCache = new Map<number, ServerCheckResult>();
const SCRAPE_CACHE_MS = 25_000;
const SCRAPE_TIMEOUT_MS = 4_000;
const STATUS_REFRESH_MS = 120_000;
const MANUAL_REFRESH_MIN_MS = 30_000;
const AUTO_REFRESH_MIN_MS = 90_000;
const CHECK_SPACING_MS = 900;
const CHECK_JITTER_MS = 1_600;

let refreshInFlight: Promise<{ started: boolean; reason: string }> | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let lastRefreshAt: string | null = null;
let lastRefreshStartedAt = 0;

function metricValue(metrics: string, name: string) {
  const re = new RegExp(`^${name}(?:\\{[^\\n]*\\})?\\s+(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)$`, "im");
  const m = metrics.match(re);
  const n = Number(m?.[1]);
  return Number.isFinite(n) ? n : null;
}

function metricValues(metrics: string, name: string) {
  const out: number[] = [];
  const re = new RegExp(`^${name}(?:\\{[^\\n]*\\})?\\s+(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)$`, "gim");
  let m: RegExpExecArray | null;
  while ((m = re.exec(metrics))) {
    const n = Number(m[1]);
    if (Number.isFinite(n)) out.push(n);
  }
  return out;
}

function sumMetric(metrics: string, name: string, include?: (line: string) => boolean) {
  let sum = 0;
  const re = new RegExp(`^(${name}(?:\\{[^\\n]*\\})?)\\s+(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)$`, "gim");
  let m: RegExpExecArray | null;
  while ((m = re.exec(metrics))) {
    const line = m[1] || "";
    if (include && !include(line)) continue;
    const n = Number(m[2]);
    if (Number.isFinite(n)) sum += n;
  }
  return sum;
}

function maxMetric(metrics: string, name: string, include?: (line: string) => boolean) {
  let max: number | null = null;
  const re = new RegExp(`^(${name}(?:\\{[^\\n]*\\})?)\\s+(-?\\d+(?:\\.\\d+)?(?:e[+-]?\\d+)?)$`, "gim");
  let m: RegExpExecArray | null;
  while ((m = re.exec(metrics))) {
    const line = m[1] || "";
    if (include && !include(line)) continue;
    const n = Number(m[2]);
    if (Number.isFinite(n) && n > 0) max = max == null ? n : Math.max(max, n);
  }
  return max;
}

function cpuTotals(metrics: string) {
  let total = 0;
  let idle = 0;
  const re = /^node_cpu_seconds_total\{[^\n]*mode="([^"]+)"[^\n]*\}\s+(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(metrics))) {
    const mode = m[1];
    const n = Number(m[2]);
    if (!Number.isFinite(n)) continue;
    total += n;
    if (mode === "idle") idle += n;
  }
  return total > 0 ? { total, idle } : null;
}

function parseCpuBusy(metrics: string, id: number, now: number) {
  const point = cpuTotals(metrics);
  if (!point) return null;

  const prev = cpuCache.get(id);
  cpuCache.set(id, { ts: now, total: point.total, idle: point.idle });
  if (!prev || now <= prev.ts) return null;

  const totalDelta = point.total - prev.total;
  const idleDelta = point.idle - prev.idle;
  if (totalDelta <= 0 || idleDelta < 0) return null;

  const busy = 100 * (1 - idleDelta / totalDelta);
  return Math.min(100, Math.max(0, Math.round(busy)));
}

function fmtUptime(seconds: number | null) {
  if (!seconds || seconds < 0) return null;
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days} д ${hours} ч`;
  if (hours > 0) return `${hours} ч ${mins} мин`;
  return `${Math.max(1, mins)} мин`;
}

function parseLoad(metrics: string, uplinkMbps: number | null, id: number, now: number) {
  const cores = metricValues(metrics, "node_cpu_seconds_total")
    .length
    ? new Set((metrics.match(/^node_cpu_seconds_total\{[^\n]*cpu="([^"]+)"/gim) || []).map((x) => x.match(/cpu="([^"]+)"/)?.[1]).filter(Boolean)).size
    : 0;
  const load1 = metricValue(metrics, "node_load1");
  const systemLoadPct = load1 != null && cores > 0 ? Math.min(100, Math.max(0, Math.round((load1 / cores) * 100))) : null;
  const cpuLoadPct = parseCpuBusy(metrics, id, now) ?? systemLoadPct;

  const rx = sumMetric(metrics, "node_network_receive_bytes_total", (line) => !/device="lo"/.test(line));
  const tx = sumMetric(metrics, "node_network_transmit_bytes_total", (line) => !/device="lo"/.test(line));
  const nodeSpeedBytes = maxMetric(metrics, "node_network_speed_bytes", (line) => !/device="lo"/.test(line));
  const detectedUplinkMbps = nodeSpeedBytes != null ? Math.round((nodeSpeedBytes * 8) / 1_000_000) : null;
  const effectiveUplinkMbps = detectedUplinkMbps && detectedUplinkMbps > 0 ? detectedUplinkMbps : uplinkMbps;
  const prev = netCache.get(id);
  netCache.set(id, { ts: now, rx, tx });

  let uplinkLoadPct: number | null = null;
  let rxMbps: number | null = null;
  let txMbps: number | null = null;
  if (prev && effectiveUplinkMbps && effectiveUplinkMbps > 0 && now > prev.ts) {
    const seconds = (now - prev.ts) / 1000;
    rxMbps = Math.max(0, ((rx - prev.rx) * 8) / seconds / 1_000_000);
    txMbps = Math.max(0, ((tx - prev.tx) * 8) / seconds / 1_000_000);
    const totalMbps = rxMbps + txMbps;
    uplinkLoadPct = Math.min(100, Math.max(0, Math.round((totalMbps / effectiveUplinkMbps) * 100)));
  }

  const memTotal = metricValue(metrics, "node_memory_MemTotal_bytes");
  const memAvailable = metricValue(metrics, "node_memory_MemAvailable_bytes");
  const memoryLoadPct = memTotal && memTotal > 0 && memAvailable != null
    ? Math.min(100, Math.max(0, Math.round(((memTotal - memAvailable) / memTotal) * 100)))
    : null;

  const loadPct = cpuLoadPct;
  return { loadPct, cpuLoadPct, uplinkLoadPct, memoryLoadPct, rxMbps, txMbps };
}

function normalizeCachedValue(row: MonitoredServerRow, value: ServerCheckResult): ServerCheckResult {
  return {
    ...value,
    id: row.id,
    title: row.title,
    host: row.host,
    kind: row.kind,
  };
}

function pendingStatus(row: MonitoredServerRow): ServerCheckResult {
  return {
    id: row.id,
    title: row.title,
    host: row.host,
    kind: row.kind,
    online: null,
    latencyMs: null,
    uptime: null,
    uptimeSeconds: null,
    loadPct: null,
    cpuLoadPct: null,
    uplinkLoadPct: null,
    memoryLoadPct: null,
    rxMbps: null,
    txMbps: null,
    checkedAt: null,
  };
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shuffleRows(rows: MonitoredServerRow[]) {
  return rows
    .map((row) => ({ row, rank: Math.random() }))
    .sort((a, b) => a.rank - b.rank)
    .map((x) => x.row);
}

async function checkServersSoftly(rows: MonitoredServerRow[]) {
  const shuffled = shuffleRows(rows);
  for (const [i, row] of shuffled.entries()) {
    if (i > 0) {
      await delay(CHECK_SPACING_MS + Math.floor(Math.random() * CHECK_JITTER_MS));
    }
    await checkServer(row);
  }
}

export async function checkServer(row: MonitoredServerRow): Promise<ServerCheckResult> {
  const cached = scrapeCache.get(row.id);
  if (cached && Date.now() - cached.ts < SCRAPE_CACHE_MS) return normalizeCachedValue(row, cached.value);

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

  try {
    const res = await fetch(row.exporter_url, { signal: controller.signal });
    const text = await res.text();
    const latencyMs = Date.now() - started;
    if (!res.ok) throw new Error(`exporter_http_${res.status}`);

    const now = Date.now();
    const nodeTime = metricValue(text, "node_time_seconds");
    const bootTime = metricValue(text, "node_boot_time_seconds");
    const uptimeSeconds = nodeTime != null && bootTime != null ? Math.max(0, Math.round(nodeTime - bootTime)) : null;
    const load = parseLoad(text, row.uplink_mbps, row.id, now);

    const value = {
      id: row.id,
      title: row.title,
      host: row.host,
      kind: row.kind,
      online: true,
      latencyMs,
      uptime: fmtUptime(uptimeSeconds),
      uptimeSeconds,
      loadPct: load.loadPct,
      cpuLoadPct: load.cpuLoadPct,
      uplinkLoadPct: load.uplinkLoadPct,
      memoryLoadPct: load.memoryLoadPct,
      rxMbps: load.rxMbps,
      txMbps: load.txMbps,
      checkedAt: new Date().toISOString(),
    };
    scrapeCache.set(row.id, { ts: Date.now(), value });
    statusCache.set(row.id, value);
    return value;
  } catch {
    const value = {
      id: row.id,
      title: row.title,
      host: row.host,
      kind: row.kind,
      online: false,
      latencyMs: null,
      uptime: null,
      uptimeSeconds: null,
      loadPct: null,
      cpuLoadPct: null,
      uplinkLoadPct: null,
      memoryLoadPct: null,
      rxMbps: null,
      txMbps: null,
      checkedAt: new Date().toISOString(),
    };
    scrapeCache.set(row.id, { ts: Date.now(), value });
    statusCache.set(row.id, value);
    return value;
  } finally {
    clearTimeout(timer);
  }
}

export function getServerStatusSnapshot(rows: MonitoredServerRow[]) {
  const activeIds = new Set(rows.map((row) => row.id));
  for (const id of statusCache.keys()) {
    if (!activeIds.has(id)) statusCache.delete(id);
  }

  return rows.map((row) => {
    const cached = statusCache.get(row.id);
    return cached ? normalizeCachedValue(row, cached) : pendingStatus(row);
  });
}

export function requestServerStatusRefresh(
  rows: MonitoredServerRow[],
  log?: Pick<Console, "warn">,
  options: { minIntervalMs?: number; force?: boolean } = {},
) {
  if (refreshInFlight) return refreshInFlight;

  const now = Date.now();
  const minIntervalMs = options.minIntervalMs ?? AUTO_REFRESH_MIN_MS;
  if (!options.force && lastRefreshStartedAt > 0 && now - lastRefreshStartedAt < minIntervalMs) {
    return Promise.resolve({ started: false, reason: "cooldown" });
  }

  lastRefreshStartedAt = now;

  refreshInFlight = checkServersSoftly(rows)
    .then(() => {
      lastRefreshAt = new Date().toISOString();
      return { started: true, reason: "started" };
    })
    .catch((e) => {
      log?.warn?.({ err: e }, "server status refresh failed");
      return { started: true, reason: "failed" };
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

export function requestManualServerStatusRefresh(rows: MonitoredServerRow[], log?: Pick<Console, "warn">) {
  return requestServerStatusRefresh(rows, log, { minIntervalMs: MANUAL_REFRESH_MIN_MS });
}

export function startServerStatusMonitor(loadRows: () => MonitoredServerRow[], log?: Pick<Console, "warn">) {
  if (refreshTimer) return;

  const tick = () => {
    try {
      void requestServerStatusRefresh(loadRows(), log, { minIntervalMs: AUTO_REFRESH_MIN_MS });
    } catch (e) {
      log?.warn?.({ err: e }, "server status monitor tick failed");
    }
  };

  tick();
  refreshTimer = setInterval(tick, STATUS_REFRESH_MS);
  refreshTimer.unref?.();
}

export function getServerStatusMeta() {
  return {
    updatedAt: lastRefreshAt,
    refreshing: Boolean(refreshInFlight),
    refreshIntervalMs: STATUS_REFRESH_MS,
    manualCooldownMs: MANUAL_REFRESH_MIN_MS,
    lastRefreshStartedAt: lastRefreshStartedAt ? new Date(lastRefreshStartedAt).toISOString() : null,
  };
}
