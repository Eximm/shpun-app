// api/src/modules/serverStatus/nodeExporter.ts
//
// Normalized Node Exporter parser.
//
// Reads the Prometheus text exposition line by line and keeps only the metric
// families the monitoring engine actually needs. It never stores or returns the
// raw /metrics payload. Rate/delta metrics (CPU %, network B/s, error/drop
// deltas) are computed against the previous sample for the same server.

export type NodeExporterPrevious = {
  ts: number;
  cpuTotal: number;
  cpuIdle: number;
  cpuIowait: number;
  rxBytes: number;
  txBytes: number;
  rxErrors: number;
  txErrors: number;
  rxDrops: number;
  txDrops: number;
};

export type NodeExporterSample = {
  online: true;
  uptimeSeconds: number | null;
  bootTimeSec: number | null;

  cpuCores: number | null;
  cpuBusyPct: number | null;
  iowaitPct: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;

  memTotalBytes: number | null;
  memAvailableBytes: number | null;
  memoryUsedPct: number | null;
  swapTotalBytes: number | null;
  swapUsedPct: number | null;

  fsMount: string | null;
  diskTotalBytes: number | null;
  diskFreeBytes: number | null;
  diskUsedPct: number | null;
  inodeUsedPct: number | null;

  rxBytesTotal: number | null;
  txBytesTotal: number | null;
  rxBytesPerSec: number | null;
  txBytesPerSec: number | null;
  rxErrorsTotal: number | null;
  txErrorsTotal: number | null;
  rxDropsTotal: number | null;
  txDropsTotal: number | null;
  rxErrorsDelta: number | null;
  txErrorsDelta: number | null;
  rxDropsDelta: number | null;
  txDropsDelta: number | null;
  maxUplinkSpeedBytes: number | null;

  fileDescriptors: number | null;
  sockets: number | null;
};

export type ParsedMetric = {
  name: string;
  labels: Record<string, string>;
  value: number;
};

const NEEDED_PREFIXES = [
  "node_time_seconds",
  "node_boot_time_seconds",
  "node_cpu_seconds_total",
  "node_load1",
  "node_load5",
  "node_load15",
  "node_memory_MemTotal_bytes",
  "node_memory_MemAvailable_bytes",
  "node_memory_SwapTotal_bytes",
  "node_memory_SwapFree_bytes",
  "node_filesystem_size_bytes",
  "node_filesystem_avail_bytes",
  "node_filesystem_files",
  "node_filesystem_files_free",
  "node_network_receive_bytes_total",
  "node_network_transmit_bytes_total",
  "node_network_receive_errs_total",
  "node_network_transmit_errs_total",
  "node_network_receive_drop_total",
  "node_network_transmit_drop_total",
  "node_network_speed_bytes",
  "node_filefd_allocated",
  "node_sockstat_sockets_used",
];

const NEEDED = new Set(NEEDED_PREFIXES);

function isNeeded(name: string) {
  if (NEEDED.has(name)) return true;
  // Counters are often suffixed per interface; exact names above are used.
  return false;
}

function parseLabels(raw: string): Record<string, string> {
  const labels: Record<string, string> = {};
  const re = /([a-zA-Z_][a-zA-Z0-9_]*)="((?:[^"\\]|\\.)*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    labels[m[1]] = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n").replace(/\\\\/g, "\\");
  }
  return labels;
}

/** Parse only the needed metric families out of a Prometheus text payload. */
export function parsePrometheusNeeded(text: string): ParsedMetric[] {
  const out: ParsedMetric[] = [];
  const lines = String(text || "").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line[0] === "#") continue;
    const brace = line.indexOf("{");
    const space = line.indexOf(" ");
    let name: string;
    let labelRaw = "";
    let valueRaw: string;

    if (brace !== -1 && (space === -1 || brace < space)) {
      name = line.slice(0, brace);
      const close = line.indexOf("}", brace);
      if (close === -1) continue;
      labelRaw = line.slice(brace + 1, close);
      valueRaw = line.slice(close + 1).trim();
    } else {
      if (space === -1) continue;
      name = line.slice(0, space);
      valueRaw = line.slice(space + 1).trim();
    }

    if (!isNeeded(name)) continue;
    const value = Number(valueRaw.split(/\s+/)[0]);
    if (!Number.isFinite(value)) continue;
    out.push({ name, labels: labelRaw ? parseLabels(labelRaw) : {}, value });
  }
  return out;
}

function first(metrics: ParsedMetric[], name: string): number | null {
  for (const m of metrics) if (m.name === name) return m.value;
  return null;
}

function nonVirtualFs(fs: ParsedMetric[]) {
  return fs.filter((m) => {
    const fstype = m.labels.fstype || "";
    const mount = m.labels.mountpoint || "";
    if (/^(tmpfs|devtmpfs|overlay|squashfs|ramfs|proc|sysfs|autofs|nsfs|cgroup|fuse\..*|rpc_pipefs)$/i.test(fstype)) {
      return false;
    }
    if (mount === "" || mount === "/dev" || mount.startsWith("/sys") || mount.startsWith("/proc")) return false;
    return true;
  });
}

function pickFilesystem(metrics: ParsedMetric[]) {
  const candidates = nonVirtualFs(metrics);
  if (candidates.length === 0) return null;

  const byMount = new Map<string, { size: number; avail: number; files: number | null; filesFree: number | null }>();
  for (const m of candidates) {
    const mount = m.labels.mountpoint || "";
    const entry = byMount.get(mount) ?? { size: 0, avail: 0, files: null, filesFree: null };
    if (m.name === "node_filesystem_size_bytes") entry.size = Math.max(entry.size, m.value);
    if (m.name === "node_filesystem_avail_bytes") entry.avail = Math.max(entry.avail, m.value);
    if (m.name === "node_filesystem_files") entry.files = m.value;
    if (m.name === "node_filesystem_files_free") entry.filesFree = m.value;
    byMount.set(mount, entry);
  }

  const root = byMount.get("/");
  const selected = root
    ? { mount: "/", ...root }
    : (() => {
        let best: { mount: string; size: number; avail: number; files: number | null; filesFree: number | null } | null = null;
        for (const [mount, entry] of byMount) {
          if (!best || entry.size > best.size) best = { mount, ...entry };
        }
        return best;
      })();

  if (!selected || selected.size <= 0) return null;
  return selected;
}

function sumBy(
  metrics: ParsedMetric[],
  name: string,
  include: (m: ParsedMetric) => boolean = () => true,
) {
  let sum = 0;
  let seen = false;
  for (const m of metrics) {
    if (m.name !== name) continue;
    if (!include(m)) continue;
    sum += m.value;
    seen = true;
  }
  return seen ? sum : null;
}

function countCpus(metrics: ParsedMetric[]) {
  const cpus = new Set<string>();
  for (const m of metrics) if (m.name === "node_cpu_seconds_total") cpus.add(m.labels.cpu || "");
  return cpus.size || null;
}

function cpuTotals(metrics: ParsedMetric[]) {
  let total = 0;
  let idle = 0;
  let iowait = 0;
  let seen = false;
  for (const m of metrics) {
    if (m.name !== "node_cpu_seconds_total") continue;
    total += m.value;
    if (m.labels.mode === "idle") idle += m.value;
    if (m.labels.mode === "iowait") iowait += m.value;
    seen = true;
  }
  return seen ? { total, idle, iowait } : null;
}

export function parseNodeExporter(
  text: string,
  opts: { nowMs: number; previous?: NodeExporterPrevious | null } = { nowMs: Date.now() },
): NodeExporterSample {
  const metrics = parsePrometheusNeeded(text);
  const now = opts.nowMs;
  const prev = opts.previous ?? null;

  const nodeTime = first(metrics, "node_time_seconds");
  const bootTime = first(metrics, "node_boot_time_seconds");
  const uptimeSeconds =
    nodeTime != null && bootTime != null ? Math.max(0, Math.round(nodeTime - bootTime)) : null;

  const cpu = cpuTotals(metrics);
  let cpuBusyPct: number | null = null;
  let iowaitPct: number | null = null;
  if (cpu && prev && cpu.total > prev.cpuTotal) {
    const totalDelta = cpu.total - prev.cpuTotal;
    const idleDelta = cpu.idle - prev.cpuIdle;
    const iowaitDelta = cpu.iowait - prev.cpuIowait;
    cpuBusyPct = clampPct(100 * (1 - idleDelta / totalDelta));
    iowaitPct = clampPct(100 * (iowaitDelta / totalDelta));
  }

  const memTotal = first(metrics, "node_memory_MemTotal_bytes");
  const memAvailable = first(metrics, "node_memory_MemAvailable_bytes");
  const memoryUsedPct =
    memTotal && memTotal > 0 && memAvailable != null ? clampPct(100 * ((memTotal - memAvailable) / memTotal)) : null;

  const swapTotal = first(metrics, "node_memory_SwapTotal_bytes");
  const swapFree = first(metrics, "node_memory_SwapFree_bytes");
  const swapUsedPct =
    swapTotal && swapTotal > 0 && swapFree != null ? clampPct(100 * ((swapTotal - swapFree) / swapTotal)) : null;

  const fs = pickFilesystem(metrics);
  const diskTotalBytes = fs?.size ?? null;
  const diskFreeBytes = fs?.avail ?? null;
  const diskUsedPct = fs && fs.size > 0 ? clampPct(100 * (1 - fs.avail / fs.size)) : null;
  const inodeUsedPct =
    fs && fs.files && fs.files > 0 && fs.filesFree != null
      ? clampPct(100 * (1 - fs.filesFree / fs.files))
      : null;

  const notLo = (m: ParsedMetric) => m.labels.device !== "lo";
  const rxBytesTotal = sumBy(metrics, "node_network_receive_bytes_total", notLo);
  const txBytesTotal = sumBy(metrics, "node_network_transmit_bytes_total", notLo);
  const rxErrorsTotal = sumBy(metrics, "node_network_receive_errs_total", notLo);
  const txErrorsTotal = sumBy(metrics, "node_network_transmit_errs_total", notLo);
  const rxDropsTotal = sumBy(metrics, "node_network_receive_drop_total", notLo);
  const txDropsTotal = sumBy(metrics, "node_network_transmit_drop_total", notLo);

  let maxUplinkSpeedBytes: number | null = null;
  for (const m of metrics) {
    if (m.name !== "node_network_speed_bytes" || m.labels.device === "lo") continue;
    maxUplinkSpeedBytes = maxUplinkSpeedBytes == null ? m.value : Math.max(maxUplinkSpeedBytes, m.value);
  }

  let rxBytesPerSec: number | null = null;
  let txBytesPerSec: number | null = null;
  let rxErrorsDelta: number | null = null;
  let txErrorsDelta: number | null = null;
  let rxDropsDelta: number | null = null;
  let txDropsDelta: number | null = null;

  if (prev && now > prev.ts && rxBytesTotal != null && txBytesTotal != null) {
    const seconds = (now - prev.ts) / 1000;
    rxBytesPerSec = Math.max(0, (rxBytesTotal - prev.rxBytes) / seconds);
    txBytesPerSec = Math.max(0, (txBytesTotal - prev.txBytes) / seconds);
  }
  if (prev) {
    if (rxErrorsTotal != null) rxErrorsDelta = Math.max(0, rxErrorsTotal - prev.rxErrors);
    if (txErrorsTotal != null) txErrorsDelta = Math.max(0, txErrorsTotal - prev.txErrors);
    if (rxDropsTotal != null) rxDropsDelta = Math.max(0, rxDropsTotal - prev.rxDrops);
    if (txDropsTotal != null) txDropsDelta = Math.max(0, txDropsTotal - prev.txDrops);
  }

  return {
    online: true,
    uptimeSeconds,
    bootTimeSec: bootTime,
    cpuCores: countCpus(metrics),
    cpuBusyPct,
    iowaitPct,
    load1: first(metrics, "node_load1"),
    load5: first(metrics, "node_load5"),
    load15: first(metrics, "node_load15"),
    memTotalBytes: memTotal,
    memAvailableBytes: memAvailable,
    memoryUsedPct,
    swapTotalBytes: swapTotal,
    swapUsedPct,
    fsMount: fs?.mount ?? null,
    diskTotalBytes,
    diskFreeBytes,
    diskUsedPct,
    inodeUsedPct,
    rxBytesTotal,
    txBytesTotal,
    rxBytesPerSec,
    txBytesPerSec,
    rxErrorsTotal,
    txErrorsTotal,
    rxDropsTotal,
    txDropsTotal,
    rxErrorsDelta,
    txErrorsDelta,
    rxDropsDelta,
    txDropsDelta,
    maxUplinkSpeedBytes,
    fileDescriptors: first(metrics, "node_filefd_allocated"),
    sockets: first(metrics, "node_sockstat_sockets_used"),
  };
}

function clampPct(v: number) {
  if (!Number.isFinite(v)) return null;
  return Math.min(100, Math.max(0, Math.round(v * 10) / 10));
}

/** Build the `previous` state needed for the next parse from a sample. */
export function toPreviousState(
  sample: NodeExporterSample,
  cpuTotalsRaw: { total: number; idle: number; iowait: number } | null,
  ts: number,
): NodeExporterPrevious {
  return {
    ts,
    cpuTotal: cpuTotalsRaw?.total ?? 0,
    cpuIdle: cpuTotalsRaw?.idle ?? 0,
    cpuIowait: cpuTotalsRaw?.iowait ?? 0,
    rxBytes: sample.rxBytesTotal ?? 0,
    txBytes: sample.txBytesTotal ?? 0,
    rxErrors: sample.rxErrorsTotal ?? 0,
    txErrors: sample.txErrorsTotal ?? 0,
    rxDrops: sample.rxDropsTotal ?? 0,
    txDrops: sample.txDropsTotal ?? 0,
  };
}

/** Extract raw CPU totals for previous-state bookkeeping. */
export function rawCpuTotals(text: string) {
  const metrics = parsePrometheusNeeded(text);
  return cpuTotals(metrics);
}