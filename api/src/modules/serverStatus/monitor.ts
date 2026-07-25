import type { MonitoredServerRow } from "./repo.js";

type NetPoint = {
  ts: number;
  rx: number;
  tx: number;
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
  checkedAt: string | null;
};

const scrapeCache = new Map<number, { ts: number; value: any }>();
const netCache = new Map<number, NetPoint>();
const statusCache = new Map<number, ServerCheckResult>();
const SCRAPE_CACHE_MS = 25_000;
const SCRAPE_TIMEOUT_MS = 4_000;
const STATUS_REFRESH_MS = 60_000;
const MANUAL_REFRESH_MIN_MS = 20_000;
const AUTO_REFRESH_MIN_MS = 45_000;
const CHECK_SPACING_MS = 350;
const CHECK_JITTER_MS = 650;

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
  const cpuLoadPct = load1 != null && cores > 0 ? Math.min(100, Math.max(0, Math.round((load1 / cores) * 100))) : null;

  const rx = sumMetric(metrics, "node_network_receive_bytes_total", (line) => !/device="lo"/.test(line));
  const tx = sumMetric(metrics, "node_network_transmit_bytes_total", (line) => !/device="lo"/.test(line));
  const prev = netCache.get(id);
  netCache.set(id, { ts: now, rx, tx });

  let uplinkLoadPct: number | null = null;
  if (prev && uplinkMbps && uplinkMbps > 0 && now > prev.ts) {
    const seconds = (now - prev.ts) / 1000;
    const bytesPerSec = Math.max(0, (rx - prev.rx) + (tx - prev.tx)) / seconds;
    const mbps = (bytesPerSec * 8) / 1_000_000;
    uplinkLoadPct = Math.min(100, Math.max(0, Math.round((mbps / uplinkMbps) * 100)));
  }

  const loadPct = uplinkLoadPct ?? cpuLoadPct;
  return { loadPct, cpuLoadPct, uplinkLoadPct };
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
