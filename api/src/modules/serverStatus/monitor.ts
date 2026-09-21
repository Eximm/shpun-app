// api/src/modules/serverStatus/monitor.ts
//
// Monitoring 2.0 collector.
//
// Responsibilities:
//   - one 60s collection cycle (configurable) guarded by a SQLite lease;
//   - Node Exporter scrape per enabled server (bounded concurrency + timeout);
//   - normalized current snapshot + bounded history writes;
//   - incident/anomaly evaluation with hysteresis and confirmation;
//   - failure isolation: one bad exporter never blocks the cycle.
//
// The public/user Server Status keeps consuming `getServerStatusSnapshot` and
// the sanitized projection, so this richer engine is additive.

import type { MonitoredServerRow } from "./repo.js";
import { getExporterCredentials, listMonitoredServers } from "./repo.js";
import { parseNodeExporter, rawCpuTotals, toPreviousState, type NodeExporterPrevious, type NodeExporterSample } from "./nodeExporter.js";
import { getGlobalThresholds, resolveThresholds, type MonitoringThresholds } from "./settingsRepo.js";
import { insertSample, recentSamples, runDownsampling, runRetention, type MonitoringSample } from "./historyRepo.js";
import { evaluateServerIncidents, type IncidentEvent, type RuleEvaluation } from "./incidents.js";
import { insertEvent, resolveIncidentsForMissingServers } from "./incidentsRepo.js";
import { acquireCollectorLease, collectorLeaseOwner } from "./collectorLock.js";
import { computeUplink } from "./uplink.js";
import { createRestartableTimer, type RestartableTimer } from "./restartableTimer.js";
import {
  computeState,
  getCollectorState,
  getCurrent,
  getCurrentMany,
  lastCurrentUpdatedAt,
  pruneCurrent,
  upsertCurrent,
  writeCollectorState,
  type CurrentRecord,
  type CurrentState,
} from "./currentRepo.js";

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
  exporterStatus: "ok" | "error" | "disabled";
  lastError: string | null;
  checkedAt: string | null;
  // Persistent current-state metadata (see currentRepo.ts).
  state: CurrentState;
  stale: boolean;
  consecutiveFailures: number;
  lastAttemptAt: number | null;
  lastSuccessAt: number | null;
  memoryTotalBytes: number | null;
  memoryAvailableBytes: number | null;
  uplinkCapacityBps: number | null;
  uplinkCapacitySource: "configured" | "detected" | "unknown";
};

const STATUS_REFRESH_MS_FALLBACK = 60_000;
const MANUAL_REFRESH_MIN_MS = 15_000;
const FORCE_CHECK_MIN_MS = 15_000;
const DEFAULT_TIMEOUT_MS = 4_000;

const prevCache = new Map<number, { ts: number; node: NodeExporterPrevious; uptime: number | null; bootTime: number | null }>();
const sampleBuffers = new Map<number, MonitoringSample[]>();

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
    exporterStatus: "disabled",
    lastError: null,
    checkedAt: null,
    state: "no_data",
    stale: false,
    consecutiveFailures: 0,
    lastAttemptAt: null,
    lastSuccessAt: null,
    memoryTotalBytes: null,
    memoryAvailableBytes: null,
    uplinkCapacityBps: null,
    uplinkCapacitySource: "unknown",
  };
}

/** Build the display shape from the persisted canonical current record. */
function currentToCheck(row: MonitoredServerRow, rec: CurrentRecord | null): ServerCheckResult {
  const base = emptyResult(row);
  if (!rec) return base;
  return {
    ...base,
    online: rec.online,
    latencyMs: rec.nodeExporterLatencyMs,
    uptime: fmtUptime(rec.systemUptimeSec),
    uptimeSeconds: rec.systemUptimeSec,
    loadPct: rec.cpuPct,
    cpuLoadPct: rec.cpuPct,
    iowaitPct: rec.iowaitPct,
    load1: rec.load1,
    load5: rec.load5,
    load15: rec.load15,
    cpuCores: rec.cpuCores,
    uplinkLoadPct: rec.uplinkUsedPct,
    memoryLoadPct: rec.memoryUsedPct,
    swapLoadPct: rec.swapUsedPct,
    diskLoadPct: rec.diskUsedPct,
    diskFreeBytes: rec.diskFreeBytes,
    inodeLoadPct: rec.inodeUsedPct,
    rxMbps: rec.rxBps != null ? (rec.rxBps * 8) / 1_000_000 : null,
    txMbps: rec.txBps != null ? (rec.txBps * 8) / 1_000_000 : null,
    rxErrorsDelta: rec.rxErrorsDelta,
    txErrorsDelta: rec.txErrorsDelta,
    rxDropsDelta: rec.rxDropsDelta,
    txDropsDelta: rec.txDropsDelta,
    fileDescriptors: rec.fileDescriptors,
    sockets: rec.sockets,
    rebootDetected: rec.rebootDetected,
    exporterStatus: rec.nodeExporterStatus === "disabled" ? "disabled" : rec.nodeExporterStatus === "ok" ? "ok" : "error",
    lastError: rec.lastErrorCode,
    checkedAt: rec.checkedAt,
    state: rec.state,
    stale: rec.stale,
    consecutiveFailures: rec.consecutiveFailures,
    lastAttemptAt: rec.lastAttemptAt,
    lastSuccessAt: rec.lastSuccessAt,
    memoryTotalBytes: rec.memoryTotalBytes,
    memoryAvailableBytes: rec.memoryAvailableBytes,
    uplinkCapacityBps: rec.uplinkCapacityBps,
    uplinkCapacitySource: rec.uplinkCapacitySource === "configured" || rec.uplinkCapacitySource === "detected" ? rec.uplinkCapacitySource : "unknown",
  };
}

/* ── Node Exporter ───────────────────────────────────────────────────────── */

type ScrapeOutcome = {
  row: MonitoredServerRow;
  sample: NodeExporterSample | null;
  latencyMs: number | null;
  online: boolean;
  errorCode: string | null;
  dataAgeSec: number | null;
  rebootDetected: boolean;
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
    let rebootDetected = false;
    if (prev && prev.uptime != null && sample.uptimeSeconds != null && sample.uptimeSeconds + 60 < prev.uptime) {
      rebootDetected = true;
      insertEvent({
        serverId: row.id,
        type: "reboot",
        ts: Math.floor(now / 1000),
        message: `${row.title || row.host} перезагружен`,
        context: { uptimeSec: sample.uptimeSeconds, previousUptimeSec: prev.uptime },
      });
    }

    return { row, sample, latencyMs: Date.now() - started, online: true, errorCode: null, dataAgeSec, rebootDetected };
  } catch (e) {
    return { row, sample: null, latencyMs: Date.now() - started, online: false, errorCode: errorCodeFromError(e), dataAgeSec: null, rebootDetected: false };
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
  exporterEnabled: boolean;
  exporterSucceeded: boolean;
}): RuleEvaluation[] {
  const { row, result, thresholds, scrape, exporterEnabled, exporterSucceeded } = params;
  const rules: RuleEvaluation[] = [];

  // Availability: host-level source failed. A single failed scrape is NOT
  // offline — the incident engine confirms only after `offlineFailChecks`.
  const hostSourceFailed = exporterEnabled ? !exporterSucceeded : false;
  if (exporterEnabled) {
    rules.push({
      ruleType: "offline",
      severity: "critical",
      active: hostSourceFailed,
      hold: hostSourceFailed,
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
      context: {
        rxBps: result.rxMbps != null ? (result.rxMbps * 1_000_000) / 8 : null,
        txBps: result.txMbps != null ? (result.txMbps * 1_000_000) / 8 : null,
        capacityBps: result.uplinkCapacityBps,
        capacitySource: result.uplinkCapacitySource,
        calculatedPct: result.uplinkLoadPct,
        threshold: thresholds.uplinkWarnPct,
      },
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

  return rules;
}

/* ── One server ──────────────────────────────────────────────────────────── */

async function collectServer(
  row: MonitoredServerRow,
): Promise<{ result: ServerCheckResult; events: IncidentEvent[]; succeeded: boolean }> {
  const thresholds = resolveThresholds(row.thresholds_json);
  const prev = getCurrent(row.id);
  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const exporterEnabled = Number(row.node_exporter_enabled) === 1 && Boolean(row.exporter_url);

  let scrape: ScrapeOutcome | null = null;
  let exporterSucceeded = false;
  if (exporterEnabled) {
    scrape = await scrapeNodeExporter(row, thresholds);
    exporterSucceeded = Boolean(scrape.sample);
  }

  const succeeded = exporterEnabled ? exporterSucceeded : false;
  const s = scrape?.sample ?? null;
  const carry = (v: number | null | undefined, pv: number | null | undefined) => (v != null ? v : pv ?? null);

  let record: CurrentRecord;

  if (succeeded) {
    const uplinkBytes = s?.maxUplinkSpeedBytes ?? null;
    const rxBps = s?.rxBytesPerSec ?? null;
    const txBps = s?.txBytesPerSec ?? null;
    const uplink = computeUplink({
      rxBps,
      txBps,
      configuredUplinkMbps: row.uplink_mbps,
      detectedUplinkSpeedBytes: uplinkBytes,
    });
    const uplinkUsedPct = uplink.pct ?? prev?.uplinkUsedPct ?? null;
    const cpuPct =
      s?.cpuBusyPct ??
      (s?.load1 != null && s.cpuCores && s.cpuCores > 0 ? Math.min(100, Math.round((s.load1 / s.cpuCores) * 100)) : null);

    record = {
      serverId: row.id,
      updatedAt: nowSec,
      lastAttemptAt: nowSec,
      lastSuccessAt: nowSec,
      state: "fresh",
      online: true,
      stale: false,
      consecutiveFailures: 0,
      lastErrorCode: null,
      cpuPct: carry(cpuPct, prev?.cpuPct),
      iowaitPct: carry(s?.iowaitPct, prev?.iowaitPct),
      load1: carry(s?.load1, prev?.load1),
      load5: carry(s?.load5, prev?.load5),
      load15: carry(s?.load15, prev?.load15),
      cpuCores: carry(s?.cpuCores, prev?.cpuCores),
      memoryUsedPct: carry(s?.memoryUsedPct, prev?.memoryUsedPct),
      memoryTotalBytes: carry(s?.memTotalBytes, prev?.memoryTotalBytes),
      memoryAvailableBytes: carry(s?.memAvailableBytes, prev?.memoryAvailableBytes),
      swapUsedPct: carry(s?.swapUsedPct, prev?.swapUsedPct),
      diskUsedPct: carry(s?.diskUsedPct, prev?.diskUsedPct),
      diskFreeBytes: carry(s?.diskFreeBytes, prev?.diskFreeBytes),
      inodeUsedPct: carry(s?.inodeUsedPct, prev?.inodeUsedPct),
      rxBps: carry(rxBps, prev?.rxBps),
      txBps: carry(txBps, prev?.txBps),
      uplinkUsedPct,
      uplinkCapacityBps: uplink.capacityBps,
      uplinkCapacitySource: uplink.capacitySource,
      rxDropsDelta: carry(s?.rxDropsDelta, prev?.rxDropsDelta),
      txDropsDelta: carry(s?.txDropsDelta, prev?.txDropsDelta),
      rxErrorsDelta: carry(s?.rxErrorsDelta, prev?.rxErrorsDelta),
      txErrorsDelta: carry(s?.txErrorsDelta, prev?.txErrorsDelta),
      systemUptimeSec: carry(s?.uptimeSeconds, prev?.systemUptimeSec),
      rebootDetected: Boolean(scrape?.rebootDetected),
      nodeExporterStatus: exporterEnabled ? "ok" : "disabled",
      nodeExporterLatencyMs: scrape?.latencyMs ?? null,
      remnawaveStatus: "disabled",
      onlineUsers: null,
      fileDescriptors: carry(s?.fileDescriptors, prev?.fileDescriptors),
      sockets: carry(s?.sockets, prev?.sockets),
      source: exporterSucceeded ? "node_exporter" : prev?.source ?? "none",
      checkedAt: new Date(nowMs).toISOString(),
    };
  } else {
    // Transient failure: NEVER blank the last known metrics. A single failed
    // scrape is not offline — offline is confirmed only after the threshold.
    const failures = (prev?.consecutiveFailures ?? 0) + 1;
    const confirmedOffline = failures >= thresholds.offlineFailChecks;
    const online = confirmedOffline ? false : prev?.online ?? null;
    const stale = !confirmedOffline && (prev?.lastSuccessAt ?? null) != null;
    record = {
      serverId: row.id,
      updatedAt: nowSec,
      lastAttemptAt: nowSec,
      lastSuccessAt: prev?.lastSuccessAt ?? null,
      state: computeState(online, stale),
      online,
      stale,
      consecutiveFailures: failures,
      lastErrorCode:
        scrape?.errorCode ??
        (exporterEnabled ? "unreachable" : prev?.lastErrorCode ?? null),
      cpuPct: prev?.cpuPct ?? null,
      iowaitPct: prev?.iowaitPct ?? null,
      load1: prev?.load1 ?? null,
      load5: prev?.load5 ?? null,
      load15: prev?.load15 ?? null,
      cpuCores: prev?.cpuCores ?? null,
      memoryUsedPct: prev?.memoryUsedPct ?? null,
      memoryTotalBytes: prev?.memoryTotalBytes ?? null,
      memoryAvailableBytes: prev?.memoryAvailableBytes ?? null,
      swapUsedPct: prev?.swapUsedPct ?? null,
      diskUsedPct: prev?.diskUsedPct ?? null,
      diskFreeBytes: prev?.diskFreeBytes ?? null,
      inodeUsedPct: prev?.inodeUsedPct ?? null,
      rxBps: prev?.rxBps ?? null,
      txBps: prev?.txBps ?? null,
      uplinkUsedPct: prev?.uplinkUsedPct ?? null,
      uplinkCapacityBps: prev?.uplinkCapacityBps ?? null,
      uplinkCapacitySource: prev?.uplinkCapacitySource ?? "unknown",
      rxDropsDelta: prev?.rxDropsDelta ?? null,
      txDropsDelta: prev?.txDropsDelta ?? null,
      rxErrorsDelta: prev?.rxErrorsDelta ?? null,
      txErrorsDelta: prev?.txErrorsDelta ?? null,
      systemUptimeSec: prev?.systemUptimeSec ?? null,
      rebootDetected: false,
      nodeExporterStatus: exporterEnabled ? "error" : prev?.nodeExporterStatus ?? "disabled",
      nodeExporterLatencyMs: scrape?.latencyMs ?? null,
      remnawaveStatus: "disabled",
      onlineUsers: null,
      fileDescriptors: prev?.fileDescriptors ?? null,
      sockets: prev?.sockets ?? null,
      source: prev?.source ?? "none",
      checkedAt: prev?.checkedAt ?? null,
    };
  }

  try {
    upsertCurrent(record);
  } catch {
    /* current persist failure must not break the cycle */
  }

  const result = currentToCheck(row, record);

  const sample = sampleFromRecord(record, succeeded);
  sampleBuffers.set(row.id, [...(sampleBuffers.get(row.id) ?? []), sample].slice(-30));
  try {
    insertSample(row.id, nowSec, sample);
  } catch {
    /* history write failure must not destroy the current snapshot */
  }

  let events: IncidentEvent[] = [];
  try {
    events = evaluateServerIncidents({
      serverId: row.id,
      serverTitle: row.title || row.host,
      serverKind: row.kind,
      ts: nowSec,
      thresholds,
      rules: buildRules({ row, result, thresholds, scrape, exporterEnabled, exporterSucceeded }),
    });
  } catch {
    /* incident engine failure must not destroy current/history */
  }

  return { result, events, succeeded };
}

function sampleFromRecord(record: CurrentRecord, succeeded: boolean): MonitoringSample {
  return {
    online: record.online,
    latencyMs: record.nodeExporterLatencyMs,
    cpuPct: succeeded ? record.cpuPct : null,
    iowaitPct: succeeded ? record.iowaitPct : null,
    load1: succeeded ? record.load1 : null,
    load5: succeeded ? record.load5 : null,
    load15: succeeded ? record.load15 : null,
    memoryUsedPct: succeeded ? record.memoryUsedPct : null,
    swapUsedPct: succeeded ? record.swapUsedPct : null,
    diskUsedPct: succeeded ? record.diskUsedPct : null,
    diskFreeBytes: succeeded ? record.diskFreeBytes : null,
    inodeUsedPct: succeeded ? record.inodeUsedPct : null,
    rxBps: succeeded ? record.rxBps : null,
    txBps: succeeded ? record.txBps : null,
    uplinkUsedPct: succeeded ? record.uplinkUsedPct : null,
    rxDropsDelta: succeeded ? record.rxDropsDelta : null,
    txDropsDelta: succeeded ? record.txDropsDelta : null,
    rxErrorsDelta: succeeded ? record.rxErrorsDelta : null,
    txErrorsDelta: succeeded ? record.txErrorsDelta : null,
    systemUptimeSec: succeeded ? record.systemUptimeSec : null,
    rebootDetected: record.rebootDetected,
    remnawaveOnline: null,
    onlineUsers: null,
    source: (record.source as MonitoringSample["source"]) ?? "none",
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
  const startedAt = Date.now();

  if (!acquireCollectorLease(Math.max(30, baseThresholds.collectionIntervalSec * 2))) {
    return { started: false, reason: "lease_held_elsewhere" };
  }

  // Node Exporter is the only external monitoring scrape source.
  const activeRows = rows.filter((row) => Number(row.active) !== 0);
  const allEvents: IncidentEvent[] = [];
  let serversSucceeded = 0;
  let serversFailed = 0;

  await runPool(activeRows, baseThresholds.collectorConcurrency, async (row) => {
    try {
      const { events, succeeded } = await collectServer(row);
      if (succeeded) serversSucceeded += 1;
      else serversFailed += 1;
      allEvents.push(...events);
    } catch (e) {
      serversFailed += 1;
      log?.warn?.({ err: e, serverId: row.id }, "MONITOR_SCRAPE_FAIL");
    }
  });

  // Drop persisted current rows for servers that no longer exist. History and
  // incidents are intentionally kept (retention handles them).
  const activeIds = new Set(activeRows.map((r) => r.id));
  pruneCurrent([...activeIds]);
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

  const finishedAt = Date.now();
  lastCycleAt = finishedAt;
  lastCycleError = null;
  try {
    writeCollectorState({
      lastCycleAt: Math.floor(finishedAt / 1000),
      lastCycleStartedAt: Math.floor(startedAt / 1000),
      lastCycleDurationMs: finishedAt - startedAt,
      serversAttempted: activeRows.length,
      serversSucceeded,
      serversFailed,
      remnawaveAttempted: 0,
      remnawaveSucceeded: 0,
      remnawaveFailed: 0,
    });
  } catch {
    /* observability write failure must not break the cycle */
  }

  return { started: true, reason: "started" };
}

/* ── Public API (kept stable for existing consumers) ─────────────────────── */

export async function checkServer(row: MonitoredServerRow): Promise<ServerCheckResult> {
  const { result } = await collectServer(row);
  return result;
}

/**
 * Canonical read: build the display shape from the persistent
 * `monitoring_current` table. Never scrapes. Safe after a restart.
 */
export function getServerStatusSnapshot(rows: MonitoredServerRow[]) {
  const current = getCurrentMany(rows.map((r) => r.id));
  return rows.map((row) => currentToCheck(row, current.get(row.id) ?? null));
}

/** Safe collector observability (no URLs/secrets). */
export function getCollectorObservability() {
  const persisted = getCollectorState();
  const lease = collectorLeaseOwner();
  return {
    ...persisted,
    collectorRunning: Boolean(refreshInFlight),
    leaseOwner: lease?.owner ?? null,
    leaseExpiresAt: lease?.expires_at ?? null,
  };
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

let lastForceCheckAt = 0;

/**
 * Explicit admin "check now": rate-limited, respects the single-collector
 * lease and the in-flight guard. Not used by normal UI refresh.
 */
export function requestForcedCollection(
  rows: MonitoredServerRow[],
  log?: Pick<Console, "warn">,
): Promise<{ started: boolean; reason: string }> {
  const now = Date.now();
  if (now - lastForceCheckAt < FORCE_CHECK_MIN_MS) {
    return Promise.resolve({ started: false, reason: "cooldown" });
  }
  lastForceCheckAt = now;
  return requestServerStatusRefresh(rows, log, { force: true });
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
  const dbTs = lastCurrentUpdatedAt();
  const collector = getCollectorState();
  return {
    updatedAt: dbTs ? new Date(dbTs * 1000).toISOString() : lastRefreshAt,
    refreshing: Boolean(refreshInFlight),
    refreshIntervalMs: intervalMs,
    manualCooldownMs: MANUAL_REFRESH_MIN_MS,
    lastRefreshStartedAt: lastRefreshStartedAt ? new Date(lastRefreshStartedAt).toISOString() : null,
    lastCycleAt: collector.lastCycleAt ? new Date(collector.lastCycleAt * 1000).toISOString() : lastCycleAt ? new Date(lastCycleAt).toISOString() : null,
    lastCycleError,
  };
}

/** Recent normalized samples for a server (oldest -> newest), excluding current. */
export function getRecentSamples(serverId: number) {
  return recentSamples(serverId, 30);
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

export { listMonitoredServers };