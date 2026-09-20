// api/src/modules/serverStatus/monitor.ts
//
// Monitoring 2.0 collector.
//
// Responsibilities:
//   - one 60s collection cycle (configurable) guarded by a SQLite lease;
//   - Node Exporter scrape per enabled server (bounded concurrency + timeout);
//   - Remnawave /metrics fetched once per integration per cycle and distributed
//     to servers by stable node UUID;
//   - normalized current snapshot + bounded history writes;
//   - incident/anomaly evaluation with hysteresis and confirmation;
//   - failure isolation: one bad exporter never blocks the cycle.
//
// The public/user Server Status keeps consuming `getServerStatusSnapshot` and
// the sanitized projection, so this richer engine is additive.

import type { MonitoredServerRow } from "./repo.js";
import { getExporterCredentials, listMonitoredServers } from "./repo.js";
import {
  parseNodeExporter,
  rawCpuTotals,
  toPreviousState,
  type NodeExporterPrevious,
  type NodeExporterSample,
} from "./nodeExporter.js";
import { parseRemnawaveMetrics, type RemnawaveNodeMetric } from "./remnawaveMetrics.js";
import { getIntegration, getIntegrationCredentials, listIntegrations, recordIntegrationCheck } from "./integrationsRepo.js";
import { getGlobalThresholds, resolveThresholds, type MonitoringThresholds } from "./settingsRepo.js";
import { insertSample, recentSamples, runDownsampling, runRetention, type MonitoringSample } from "./historyRepo.js";
import { evaluateServerIncidents, type IncidentEvent, type RuleEvaluation } from "./incidents.js";
import { insertEvent, resolveIncidentsForMissingServers } from "./incidentsRepo.js";
import { acquireCollectorLease } from "./collectorLock.js";
import { createRestartableTimer, type RestartableTimer } from "./restartableTimer.js";

export type { ServerKind } from "./repo.js";

export type ServerCheckResult = {
  id: number;
  title: string;
  host: string;
  kind: MonitoredServerRow["kind"];
  countryCode: string | null;
  online: boolean | null;
  latencyMs: number | null;
  uptime: string | null;
  uptimeSeconds: number | null;
  loadPct: number | null;
  cpuLoadPct: number | null;
  iowaitPct: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  cpuCores: number | null;
  uplinkLoadPct: number | null;
  memoryLoadPct: number | null;
  swapLoadPct: number | null;
  diskLoadPct: number | null;
  diskFreeBytes: number | null;
  inodeLoadPct: number | null;
  rxMbps: number | null;
  txMbps: number | null;
  rxErrorsDelta: number | null;
  txErrorsDelta: number | null;
  rxDropsDelta: number | null;
  txDropsDelta: number | null;
  fileDescriptors: number | null;
  sockets: number | null;
  rebootDetected: boolean;
  remnawaveOnline: boolean | null;
  onlineUsers: number | null;
  remnawaveIntegrationId: number | null;
  remnawaveNodeUuid: string | null;
  exporterStatus: "ok" | "error" | "disabled";
  lastError: string | null;
  checkedAt: string | null;
};

export type RemnawaveGlobalState = {
  integrationId: number;
  status: "ok" | "error";
  errorCode: string | null;
  checkedAt: string | null;
  globalOnlineUsers: number | null;
  nodeCount: number;
};

const SCRAPE_CACHE_MS = 20_000;
const STATUS_REFRESH_MS_FALLBACK = 60_000;
const MANUAL_REFRESH_MIN_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 4_000;

const prevCache = new Map<number, { ts: number; node: NodeExporterPrevious; uptime: number | null; bootTime: number | null }>();
const sampleBuffers = new Map<number, MonitoringSample[]>();
const scrapeCache = new Map<number, { ts: number; value: ServerCheckResult }>();
const statusCache = new Map<number, ServerCheckResult>();
const remnawaveCache = new Map<number, { ts: number; nodes: Map<string, RemnawaveNodeMetric>; global: RemnawaveGlobalState }>();

let refreshInFlight: Promise<{ started: boolean; reason: string }> | null = null;
let collectorTimer: RestartableTimer | null = null;
let lastRefreshAt: string | null = null;
let lastRefreshStartedAt = 0;
let lastCycleAt = 0;
let cycleCount = 0;
let lastCycleError: string | null = null;

export type MonitoringIncidentHandler = (events: IncidentEvent[], servers: Map<number, MonitoredServerRow>) => void;
let incidentHandler: MonitoringIncidentHandler | null = null;

export function setMonitoringIncidentHandler(handler: MonitoringIncidentHandler | null) {
  incidentHandler = handler;
}

export function getRemnawaveGlobalStates(): RemnawaveGlobalState[] {
  return [...remnawaveCache.values()].map((v) => v.global).sort((a, b) => a.integrationId - b.integrationId);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorCodeFromError(e: unknown): string {
  const msg = String((e as any)?.message || e || "unknown");
  if ((e as any)?.name === "AbortError") return "timeout";
  if (/ENOTFOUND|getaddrinfo|EAI_AGAIN/i.test(msg)) return "dns_failed";
  if (/ECONNREFUSED/i.test(msg)) return "connection_refused";
  if (/exporter_http_401/.test(msg)) return "unauthorized";
  if (/exporter_http_403/.test(msg)) return "forbidden";
  if (/exporter_http_(\d+)/.test(msg)) return `http_${msg.match(/exporter_http_(\d+)/)![1]}`;
  if (/timeout/i.test(msg)) return "timeout";
  return "unreachable";
}

async function fetchText(
  url: string,
  opts: { timeoutMs: number; username?: string; password?: string; token?: string } = { timeoutMs: DEFAULT_TIMEOUT_MS },
): Promise<{ ok: boolean; status: number; text: string; latencyMs: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  const started = Date.now();
  const headers: Record<string, string> = {};
  if (opts.username) {
    headers.Authorization = `Basic ${Buffer.from(`${opts.username}:${opts.password ?? ""}`).toString("base64")}`;
  } else if (opts.token) {
    headers.Authorization = `Bearer ${opts.token}`;
  }
  try {
    const res = await fetch(url, { signal: controller.signal, headers });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
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

function emptyResult(row: MonitoredServerRow): ServerCheckResult {
  return {
    id: row.id,
    title: row.title,
    host: row.host,
    kind: row.kind,
    countryCode: row.country_code,
    online: null,
    latencyMs: null,
    uptime: null,
    uptimeSeconds: null,
    loadPct: null,
    cpuLoadPct: null,
    iowaitPct: null,
    load1: null,
    load5: null,
    load15: null,
    cpuCores: null,
    uplinkLoadPct: null,
    memoryLoadPct: null,
    swapLoadPct: null,
    diskLoadPct: null,
    diskFreeBytes: null,
    inodeLoadPct: null,
    rxMbps: null,
    txMbps: null,
    rxErrorsDelta: null,
    txErrorsDelta: null,
    rxDropsDelta: null,
    txDropsDelta: null,
    fileDescriptors: null,
    sockets: null,
    rebootDetected: false,
    remnawaveOnline: null,
    onlineUsers: null,
    remnawaveIntegrationId: row.remnawave_integration_id,
    remnawaveNodeUuid: row.remnawave_node_uuid,
    exporterStatus: "disabled",
    lastError: null,
    checkedAt: null,
  };
}

/* ── Remnawave ───────────────────────────────────────────────────────────── */

async function collectRemnawave(thresholds: MonitoringThresholds, log?: Pick<Console, "warn">) {
  const integrations = listIntegrations({ includeDisabled: false }).filter((i) => i.type === "remnawave");
  await runPool(integrations, Math.min(4, thresholds.collectorConcurrency), async (integration) => {
    const creds = getIntegrationCredentials(integration);
    const url = integration.metrics_url || integration.base_url;
    const ts = Math.floor(Date.now() / 1000);

    if (!url) {
      remnawaveCache.set(integration.id, {
        ts,
        nodes: new Map(),
        global: { integrationId: integration.id, status: "error", errorCode: "metrics_url_missing", checkedAt: null, globalOnlineUsers: null, nodeCount: 0 },
      });
      return;
    }

    // A stored secret that cannot be decrypted (missing/changed master key) is
    // a configuration problem, not a network error. Never attempt the request
    // and never expose the crypto error.
    if (creds.passwordDecryptFailed || creds.apiTokenDecryptFailed) {
      remnawaveCache.set(integration.id, {
        ts,
        nodes: new Map(),
        global: { integrationId: integration.id, status: "error", errorCode: "credential_decrypt_failed", checkedAt: new Date().toISOString(), globalOnlineUsers: null, nodeCount: 0 },
      });
      recordIntegrationCheck(integration.id, "error", "credential_decrypt_failed");
      log?.warn?.({ integrationId: integration.id }, "MONITOR_INTEGRATION_FAIL credential_decrypt_failed");
      return;
    }

    try {
      const res = await fetchText(url, {
        timeoutMs: thresholds.scrapeTimeoutMs,
        username: integration.username || undefined,
        password: creds.password ?? undefined,
        token: creds.apiToken ?? undefined,
      });
      if (!res.ok) throw new Error(`exporter_http_${res.status}`);
      const summary = parseRemnawaveMetrics(res.text);
      const nodes = new Map<string, RemnawaveNodeMetric>();
      for (const node of summary.nodes) nodes.set(node.nodeUuid, node);
      remnawaveCache.set(integration.id, {
        ts,
        nodes,
        global: {
          integrationId: integration.id,
          status: "ok",
          errorCode: null,
          checkedAt: new Date().toISOString(),
          globalOnlineUsers: summary.globalOnlineUsers,
          nodeCount: summary.nodes.length,
        },
      });
      recordIntegrationCheck(integration.id, "ok", null);
    } catch (e) {
      const code = errorCodeFromError(e);
      remnawaveCache.set(integration.id, {
        ts,
        nodes: new Map(),
        global: { integrationId: integration.id, status: "error", errorCode: code, checkedAt: new Date().toISOString(), globalOnlineUsers: null, nodeCount: 0 },
      });
      recordIntegrationCheck(integration.id, "error", code);
      log?.warn?.({ integrationId: integration.id, code }, "MONITOR_INTEGRATION_FAIL");
    }
  });
}

/* ── Node Exporter ───────────────────────────────────────────────────────── */

type ScrapeOutcome = {
  row: MonitoredServerRow;
  sample: NodeExporterSample | null;
  latencyMs: number | null;
  online: boolean;
  errorCode: string | null;
  dataAgeSec: number | null;
};

async function scrapeNodeExporter(row: MonitoredServerRow, thresholds: MonitoringThresholds): Promise<ScrapeOutcome> {
  const creds = getExporterCredentials(row);
  const started = Date.now();
  try {
    const res = await fetchText(row.exporter_url, {
      timeoutMs: thresholds.scrapeTimeoutMs,
      username: creds.authType === "basic" ? creds.username : undefined,
      password: creds.authType === "basic" ? creds.password ?? undefined : undefined,
    });
    if (!res.ok) throw new Error(`exporter_http_${res.status}`);
    const now = Date.now();
    const sample = parseNodeExporter(res.text, { nowMs: now, previous: prevCache.get(row.id)?.node ?? null });
    const rawCpu = rawCpuTotals(res.text);
    const prev = prevCache.get(row.id);
    prevCache.set(row.id, {
      ts: now,
      node: toPreviousState(sample, rawCpu, now),
      uptime: sample.uptimeSeconds,
      bootTime: sample.bootTimeSec,
    });

    const nodeTime = sample.uptimeSeconds != null && sample.bootTimeSec != null ? sample.bootTimeSec + sample.uptimeSeconds : null;
    const dataAgeSec = nodeTime != null ? Math.max(0, Math.round(now / 1000 - nodeTime)) : null;

    // Reboot detection: uptime dropped compared to the previous sample.
    if (prev && prev.uptime != null && sample.uptimeSeconds != null && sample.uptimeSeconds + 60 < prev.uptime) {
      insertEvent({
        serverId: row.id,
        type: "reboot",
        ts: Math.floor(now / 1000),
        message: `${row.title || row.host} перезагружен`,
        context: { uptimeSec: sample.uptimeSeconds, previousUptimeSec: prev.uptime },
      });
    }

    return { row, sample, latencyMs: Date.now() - started, online: true, errorCode: null, dataAgeSec };
  } catch (e) {
    return { row, sample: null, latencyMs: Date.now() - started, online: false, errorCode: errorCodeFromError(e), dataAgeSec: null };
  }
}

/* ── Incident rules ──────────────────────────────────────────────────────── */

function networkBaseline(serverId: number): number {
  const buffer = sampleBuffers.get(serverId) ?? [];
  let sum = 0;
  let n = 0;
  for (const s of buffer) {
    const d = (s.rxErrorsDelta ?? 0) + (s.txErrorsDelta ?? 0) + (s.rxDropsDelta ?? 0) + (s.txDropsDelta ?? 0);
    sum += d;
    n += 1;
  }
  return n > 0 ? sum / n : 0;
}

function buildRules(params: {
  row: MonitoredServerRow;
  result: ServerCheckResult;
  thresholds: MonitoringThresholds;
  scrape: ScrapeOutcome | null;
  }): RuleEvaluation[] {
  const { row, result, thresholds, scrape } = params;
  const rules: RuleEvaluation[] = [];

  // Availability. Only when we actually have an exporter or Remnawave source.
  if (result.exporterStatus === "ok" || result.remnawaveOnline != null) {
    const offline = result.online === false || result.remnawaveOnline === false;
    rules.push({
      ruleType: "offline",
      severity: "critical",
      active: offline,
      hold: offline,
      value: null,
      threshold: thresholds.offlineFailChecks,
      confirmAfterChecks: thresholds.offlineFailChecks,
      message: `${row.title || row.host} недоступен`,
    });
  }

  // Stale exporter data (clock/data freshness).
  if (scrape?.dataAgeSec != null) {
    const severity = scrape.dataAgeSec >= thresholds.staleScrapeCritSec ? "critical" : "warning";
    const active = scrape.dataAgeSec >= thresholds.staleScrapeWarnSec;
    rules.push({
      ruleType: "stale_scrape",
      severity,
      active,
      hold: active,
      value: scrape.dataAgeSec,
      threshold: severity === "critical" ? thresholds.staleScrapeCritSec : thresholds.staleScrapeWarnSec,
      message: `Данные ${row.title || row.host} устарели на ${Math.round(scrape.dataAgeSec / 60)} мин`,
    });
  }

  if (result.cpuLoadPct != null) {
    const active = result.cpuLoadPct >= thresholds.cpuPct;
    rules.push({
      ruleType: "high_cpu",
      severity: "warning",
      active,
      hold: result.cpuLoadPct > thresholds.cpuPct - thresholds.hysteresisPct,
      value: result.cpuLoadPct,
      threshold: thresholds.cpuPct,
      confirmAfterSec: thresholds.cpuDurationSec,
      message: `Высокая загрузка CPU на ${row.title || row.host}`,
    });
  }

  if (result.memoryLoadPct != null) {
    const critical = result.memoryLoadPct >= thresholds.memoryCritPct;
    const active = result.memoryLoadPct >= thresholds.memoryWarnPct;
    rules.push({
      ruleType: "high_memory",
      severity: critical ? "critical" : "warning",
      active,
      hold: result.memoryLoadPct > thresholds.memoryWarnPct - thresholds.hysteresisPct,
      value: result.memoryLoadPct,
      threshold: critical ? thresholds.memoryCritPct : thresholds.memoryWarnPct,
      confirmAfterSec: critical ? thresholds.memoryCritDurationSec : thresholds.memoryWarnDurationSec,
      message: `Высокое потребление RAM на ${row.title || row.host}`,
    });
  }

  if (result.diskLoadPct != null) {
    const critical = result.diskLoadPct >= thresholds.diskCritPct;
    rules.push({
      ruleType: "high_disk",
      severity: critical ? "critical" : "warning",
      active: result.diskLoadPct >= thresholds.diskWarnPct,
      hold: result.diskLoadPct > thresholds.diskWarnPct - thresholds.hysteresisPct,
      value: result.diskLoadPct,
      threshold: critical ? thresholds.diskCritPct : thresholds.diskWarnPct,
      confirmAfterChecks: 2,
      message: `Мало места на диске ${row.title || row.host}`,
    });
  }

  if (result.inodeLoadPct != null) {
    rules.push({
      ruleType: "high_inode",
      severity: "warning",
      active: result.inodeLoadPct >= thresholds.inodeWarnPct,
      hold: result.inodeLoadPct > thresholds.inodeWarnPct - thresholds.hysteresisPct,
      value: result.inodeLoadPct,
      threshold: thresholds.inodeWarnPct,
      confirmAfterChecks: 2,
      message: `Много использованных inode на ${row.title || row.host}`,
    });
  }

  if (result.uplinkLoadPct != null) {
    rules.push({
      ruleType: "uplink_saturation",
      severity: "warning",
      active: result.uplinkLoadPct >= thresholds.uplinkWarnPct,
      hold: result.uplinkLoadPct > thresholds.uplinkWarnPct - thresholds.hysteresisPct,
      value: result.uplinkLoadPct,
      threshold: thresholds.uplinkWarnPct,
      confirmAfterSec: thresholds.uplinkDurationSec,
      message: `Канал ${row.title || row.host} загружен на ${result.uplinkLoadPct}%`,
    });
  }

  const errorDelta =
    (result.rxErrorsDelta ?? 0) + (result.txErrorsDelta ?? 0) + (result.rxDropsDelta ?? 0) + (result.txDropsDelta ?? 0);
  if (result.rxErrorsDelta != null || result.txDropsDelta != null) {
    const baseline = networkBaseline(row.id);
    const active = errorDelta > thresholds.networkErrorDeltaThreshold && errorDelta > baseline * 3;
    rules.push({
      ruleType: "network_errors",
      severity: "warning",
      active,
      hold: active,
      value: errorDelta,
      threshold: Math.max(thresholds.networkErrorDeltaThreshold, Math.round(baseline * 3)),
      confirmAfterChecks: 2,
      message: `Рост ошибок/дропов сети на ${row.title || row.host}`,
    });
  }

  // Service-level: Remnawave says the node is down while the system is alive.
  if (result.remnawaveOnline === false && result.exporterStatus === "ok" && result.online === true) {
    rules.push({
      ruleType: "remnawave_offline",
      severity: "warning",
      active: true,
      hold: true,
      value: null,
      threshold: null,
      confirmAfterChecks: 2,
      message: `Remnawave-нода ${row.title || row.host} неактивна`,
    });
  }

  return rules;
}

/* ── One server ──────────────────────────────────────────────────────────── */

async function collectServer(
  row: MonitoredServerRow,
  remnawaveNodes: Map<number, Map<string, RemnawaveNodeMetric>>,
): Promise<{ result: ServerCheckResult; events: IncidentEvent[] }> {
  const thresholds = resolveThresholds(row.thresholds_json);
  const result = emptyResult(row);
  result.remnawaveIntegrationId = row.remnawave_integration_id;
  result.remnawaveNodeUuid = row.remnawave_node_uuid;

  let scrape: ScrapeOutcome | null = null;

  if (Number(row.node_exporter_enabled) === 1 && row.exporter_url) {
    scrape = await scrapeNodeExporter(row, thresholds);
    result.latencyMs = scrape.latencyMs;
    result.online = scrape.online;
    result.exporterStatus = scrape.online ? "ok" : "error";
    result.lastError = scrape.errorCode;

    if (scrape.sample) {
      const s = scrape.sample;
      const uplinkBytes = s.maxUplinkSpeedBytes ?? null;
      const configuredUplinkBytes = row.uplink_mbps && row.uplink_mbps > 0 ? (row.uplink_mbps * 1_000_000) / 8 : null;
      const effectiveUplinkBytes = uplinkBytes && uplinkBytes > 0 ? uplinkBytes : configuredUplinkBytes;
      const rxMbps = s.rxBytesPerSec != null ? (s.rxBytesPerSec * 8) / 1_000_000 : null;
      const txMbps = s.txBytesPerSec != null ? (s.txBytesPerSec * 8) / 1_000_000 : null;
      const uplinkLoadPct =
        effectiveUplinkBytes && s.rxBytesPerSec != null && s.txBytesPerSec != null
          ? Math.min(100, Math.round(((s.rxBytesPerSec + s.txBytesPerSec) / effectiveUplinkBytes) * 100))
          : null;
      const loadBasedPct =
        s.load1 != null && s.cpuCores && s.cpuCores > 0
          ? Math.min(100, Math.round((s.load1 / s.cpuCores) * 100))
          : null;

      result.uptimeSeconds = s.uptimeSeconds;
      result.uptime = fmtUptime(s.uptimeSeconds);
      result.cpuLoadPct = s.cpuBusyPct ?? loadBasedPct;
      result.loadPct = result.cpuLoadPct;
      result.iowaitPct = s.iowaitPct;
      result.load1 = s.load1;
      result.load5 = s.load5;
      result.load15 = s.load15;
      result.cpuCores = s.cpuCores;
      result.memoryLoadPct = s.memoryUsedPct;
      result.swapLoadPct = s.swapUsedPct;
      result.diskLoadPct = s.diskUsedPct;
      result.diskFreeBytes = s.diskFreeBytes;
      result.inodeLoadPct = s.inodeUsedPct;
      result.rxMbps = rxMbps;
      result.txMbps = txMbps;
      result.uplinkLoadPct = uplinkLoadPct;
      result.rxErrorsDelta = s.rxErrorsDelta;
      result.txErrorsDelta = s.txErrorsDelta;
      result.rxDropsDelta = s.rxDropsDelta;
      result.txDropsDelta = s.txDropsDelta;
      result.fileDescriptors = s.fileDescriptors;
      result.sockets = s.sockets;
      result.rebootDetected = false;
    }
  } else {
    result.exporterStatus = "disabled";
  }

  // Merge Remnawave node metrics by stable UUID.
  if (row.remnawave_integration_id && row.remnawave_node_uuid) {
    const node = remnawaveNodes.get(row.remnawave_integration_id)?.get(row.remnawave_node_uuid) ?? null;
    if (node) {
      result.remnawaveOnline = node.up ?? true;
      result.onlineUsers = node.onlineUsers;
      if (result.online == null) result.online = node.up ?? true;
    } else if (remnawaveNodes.has(row.remnawave_integration_id)) {
      result.remnawaveOnline = null;
    }
  }

  if (result.online == null) result.online = false;
  result.checkedAt = new Date().toISOString();

  const sample = buildMonitoringSample(result, thresholds);
  const events = evaluateServerIncidents({
    serverId: row.id,
    serverTitle: row.title || row.host,
    ts: Math.floor(Date.now() / 1000),
    thresholds,
    rules: buildRules({ row, result, thresholds, scrape }),
  });

  sampleBuffers.set(row.id, [...(sampleBuffers.get(row.id) ?? []), sample].slice(-30));
  try {
    insertSample(row.id, Math.floor(Date.now() / 1000), sample);
  } catch {
    /* history write failure must not destroy the current snapshot */
  }

  return { result, events };
}

function buildMonitoringSample(result: ServerCheckResult, _thresholds: MonitoringThresholds): MonitoringSample {
  const source: MonitoringSample["source"] =
    result.exporterStatus === "ok" && result.remnawaveOnline != null
      ? "both"
      : result.exporterStatus === "ok"
        ? "node_exporter"
        : result.remnawaveOnline != null
          ? "remnawave"
          : "none";
  return {
    online: result.online,
    latencyMs: result.latencyMs,
    cpuPct: result.cpuLoadPct,
    iowaitPct: result.iowaitPct,
    load1: result.load1,
    load5: result.load5,
    load15: result.load15,
    memoryUsedPct: result.memoryLoadPct,
    swapUsedPct: result.swapLoadPct,
    diskUsedPct: result.diskLoadPct,
    diskFreeBytes: result.diskFreeBytes,
    inodeUsedPct: result.inodeLoadPct,
    rxBps: result.rxMbps != null ? (result.rxMbps * 1_000_000) / 8 : null,
    txBps: result.txMbps != null ? (result.txMbps * 1_000_000) / 8 : null,
    uplinkUsedPct: result.uplinkLoadPct,
    rxDropsDelta: result.rxDropsDelta,
    txDropsDelta: result.txDropsDelta,
    rxErrorsDelta: result.rxErrorsDelta,
    txErrorsDelta: result.txErrorsDelta,
    systemUptimeSec: result.uptimeSeconds,
    rebootDetected: result.rebootDetected,
    remnawaveOnline: result.remnawaveOnline,
    onlineUsers: result.onlineUsers,
    source,
  };
}

/* ── Concurrency ─────────────────────────────────────────────────────────── */

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>) {
  const queue = [...items];
  const size = Math.max(1, Math.min(concurrency, queue.length || 1));
  const runners = Array.from({ length: size }, async () => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      try {
        await worker(item);
      } catch {
        /* isolate failures */
      }
    }
  });
  await Promise.all(runners);
}

/* ── Cycle ───────────────────────────────────────────────────────────────── */

async function runCollectionCycle(
  rows: MonitoredServerRow[],
  log?: Pick<Console, "warn">,
): Promise<{ started: boolean; reason: string }> {
  const baseThresholds = getGlobalThresholds();

  if (!acquireCollectorLease(Math.max(30, baseThresholds.collectionIntervalSec * 2))) {
    return { started: false, reason: "lease_held_elsewhere" };
  }

  // Remnawave once per integration/cycle.
  await collectRemnawave(baseThresholds, log);

  const remnawaveNodes = new Map<number, Map<string, RemnawaveNodeMetric>>();
  for (const [integrationId, entry] of remnawaveCache) remnawaveNodes.set(integrationId, entry.nodes);

  const activeRows = rows.filter((row) => Number(row.active) !== 0);
  const allEvents: IncidentEvent[] = [];

  await runPool(activeRows, baseThresholds.collectorConcurrency, async (row) => {
    try {
      const { result, events } = await collectServer(row, remnawaveNodes);
      statusCache.set(row.id, result);
      scrapeCache.set(row.id, { ts: Date.now(), value: result });
      allEvents.push(...events);
    } catch (e) {
      log?.warn?.({ err: e, serverId: row.id }, "MONITOR_SCRAPE_FAIL");
    }
  });

  // Drop current state for servers that no longer exist.
  const activeIds = new Set(activeRows.map((r) => r.id));
  for (const id of statusCache.keys()) if (!activeIds.has(id)) statusCache.delete(id);
  for (const id of scrapeCache.keys()) if (!activeIds.has(id)) scrapeCache.delete(id);
  for (const id of sampleBuffers.keys()) if (!activeIds.has(id)) sampleBuffers.delete(id);
  for (const id of prevCache.keys()) if (!activeIds.has(id)) prevCache.delete(id);

  resolveIncidentsForMissingServers([...activeIds], Math.floor(Date.now() / 1000));

  if (allEvents.length > 0) {
    const serverMap = new Map(activeRows.map((r) => [r.id, r]));
    try {
      incidentHandler?.(allEvents, serverMap);
    } catch (e) {
      log?.warn?.({ err: e }, "MONITOR_INCIDENT_HANDLER_FAIL");
    }
  }

  // Downsample + retention roughly once an hour.
  cycleCount += 1;
  if (cycleCount % Math.max(1, Math.round(3600 / baseThresholds.collectionIntervalSec)) === 0) {
    try {
      runDownsampling();
      runRetention(baseThresholds);
    } catch (e) {
      log?.warn?.({ err: e }, "MONITOR_RETENTION_FAIL");
    }
  }

  lastCycleAt = Date.now();
  lastCycleError = null;
  return { started: true, reason: "started" };
}

/* ── Public API (kept stable for existing consumers) ─────────────────────── */

export async function checkServer(row: MonitoredServerRow): Promise<ServerCheckResult> {
  const cached = scrapeCache.get(row.id);
  if (cached && Date.now() - cached.ts < SCRAPE_CACHE_MS) return cached.value;
  const thresholds = resolveThresholds(row.thresholds_json);

  const remnawaveNodes = new Map<number, Map<string, RemnawaveNodeMetric>>();
  for (const [integrationId, entry] of remnawaveCache) remnawaveNodes.set(integrationId, entry.nodes);

  const { result } = await collectServer(row, remnawaveNodes);
  statusCache.set(row.id, result);
  scrapeCache.set(row.id, { ts: Date.now(), value: result });
  return result;
}

export function getServerStatusSnapshot(rows: MonitoredServerRow[]) {
  const activeIds = new Set(rows.map((row) => row.id));
  for (const id of statusCache.keys()) if (!activeIds.has(id)) statusCache.delete(id);

  return rows.map((row) => {
    const cached = statusCache.get(row.id);
    if (!cached) return { ...emptyResult(row), checkedAt: null };
    return {
      ...cached,
      id: row.id,
      title: row.title,
      host: row.host,
      kind: row.kind,
      countryCode: row.country_code,
      remnawaveIntegrationId: row.remnawave_integration_id,
      remnawaveNodeUuid: row.remnawave_node_uuid,
    };
  });
}

export function requestServerStatusRefresh(
  rows: MonitoredServerRow[],
  log?: Pick<Console, "warn">,
  options: { minIntervalMs?: number; force?: boolean } = {},
) {
  if (refreshInFlight) return refreshInFlight;

  const now = Date.now();
  const minIntervalMs = options.minIntervalMs ?? STATUS_REFRESH_MS_FALLBACK;
  if (!options.force && lastRefreshStartedAt > 0 && now - lastRefreshStartedAt < minIntervalMs) {
    return Promise.resolve({ started: false, reason: "cooldown" });
  }

  lastRefreshStartedAt = now;
  refreshInFlight = runCollectionCycle(rows, log)
    .then((res) => {
      if (res.started) lastRefreshAt = new Date().toISOString();
      return res;
    })
    .catch((e) => {
      lastCycleError = String((e as any)?.message || e);
      log?.warn?.({ err: e }, "MONITOR_COLLECTOR_CYCLE failed");
      return { started: true, reason: "failed" };
    })
    .finally(() => {
      refreshInFlight = null;
    });

  return refreshInFlight;
}

export function requestManualServerStatusRefresh(rows: MonitoredServerRow[], log?: Pick<Console, "warn">) {
  return requestServerStatusRefresh(rows, log, { minIntervalMs: MANUAL_REFRESH_MIN_MS, force: true });
}

export function startServerStatusMonitor(loadRows: () => MonitoredServerRow[], log?: Pick<Console, "warn">) {
  if (collectorTimer) return;

  const intervalMs = currentIntervalMs();
  const tick = () => {
    try {
      const wait = collectorTimer ? Math.max(15_000, Math.trunc(collectorTimer.intervalMs() * 0.75)) : intervalMs;
      void requestServerStatusRefresh(loadRows(), log, { minIntervalMs: wait });
    } catch (e) {
      log?.warn?.({ err: e }, "MONITOR_COLLECTOR_TICK_FAIL");
    }
  };

  collectorTimer = createRestartableTimer(tick);
  collectorTimer.set(intervalMs);
  tick();
}

function currentIntervalMs(): number {
  try {
    return Math.max(15, getGlobalThresholds().collectionIntervalSec) * 1000;
  } catch {
    return STATUS_REFRESH_MS_FALLBACK;
  }
}

/**
 * Apply a new global collection interval without a process restart. Clears the
 * previous timer and installs exactly one new timer. Returns whether the
 * interval actually changed.
 */
export function applyCollectionInterval(intervalSec?: number): { changed: boolean; intervalMs: number; active: boolean } {
  const rawSec = Number(intervalSec);
  const sec = Number.isFinite(rawSec) && rawSec > 0 ? rawSec : getGlobalThresholds().collectionIntervalSec;
  const nextMs = Math.max(15, Math.min(3600, Math.trunc(sec))) * 1000;

  if (!collectorTimer) return { changed: false, intervalMs: nextMs, active: false };
  const changed = collectorTimer.intervalMs() !== nextMs;
  if (changed) collectorTimer.set(nextMs);
  return { changed, intervalMs: nextMs, active: true };
}

export function stopServerStatusMonitor() {
  collectorTimer?.stop();
  collectorTimer = null;
}

export function getCollectorTimerState() {
  return {
    active: Boolean(collectorTimer?.isActive()),
    intervalMs: collectorTimer?.intervalMs() ?? 0,
    version: collectorTimer?.version() ?? 0,
  };
}

export function getServerStatusMeta() {
  const intervalMs = collectorTimer?.isActive() ? collectorTimer.intervalMs() : currentIntervalMs();
  return {
    updatedAt: lastRefreshAt,
    refreshing: Boolean(refreshInFlight),
    refreshIntervalMs: intervalMs,
    manualCooldownMs: MANUAL_REFRESH_MIN_MS,
    lastRefreshStartedAt: lastRefreshStartedAt ? new Date(lastRefreshStartedAt).toISOString() : null,
    lastCycleAt: lastCycleAt ? new Date(lastCycleAt).toISOString() : null,
    lastCycleError,
  };
}

/** Recent normalized samples for a server (oldest -> newest), excluding current. */
export function getRecentSamples(serverId: number) {
  return recentSamples(serverId, 30);
}

/** Remnawave nodes discovered for an integration (for the mapping UI). */
export function getRemnawaveNodes(integrationId: number): RemnawaveNodeMetric[] {
  const entry = remnawaveCache.get(integrationId);
  return entry ? [...entry.nodes.values()] : [];
}

/** Probe a server's Node Exporter without persisting anything. */
export async function probeNodeExporter(row: MonitoredServerRow, timeoutMs = 5000) {
  const creds = getExporterCredentials(row);
  const started = Date.now();
  try {
    const res = await fetchText(row.exporter_url, {
      timeoutMs,
      username: creds.authType === "basic" ? creds.username : undefined,
      password: creds.authType === "basic" ? creds.password ?? undefined : undefined,
    });
    if (!res.ok) {
      return { ok: false as const, errorCode: `http_${res.status}`, latencyMs: Date.now() - started, metrics: null };
    }
    const sample = parseNodeExporter(res.text, { nowMs: Date.now() });
    return { ok: true as const, errorCode: null, latencyMs: Date.now() - started, metrics: sample };
  } catch (e) {
    return { ok: false as const, errorCode: errorCodeFromError(e), latencyMs: Date.now() - started, metrics: null };
  }
}

export { listMonitoredServers, getIntegration };