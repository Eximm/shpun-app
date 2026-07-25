import type { MonitoredServerRow } from "./repo.js";

type NetPoint = {
  ts: number;
  rx: number;
  tx: number;
};

const scrapeCache = new Map<number, { ts: number; value: any }>();
const netCache = new Map<number, NetPoint>();
const SCRAPE_CACHE_MS = 25_000;
const SCRAPE_TIMEOUT_MS = 4_000;

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

export async function checkServer(row: MonitoredServerRow) {
  const cached = scrapeCache.get(row.id);
  if (cached && Date.now() - cached.ts < SCRAPE_CACHE_MS) return cached.value;

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
    return value;
  } finally {
    clearTimeout(timer);
  }
}
