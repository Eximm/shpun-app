// api/src/modules/serverStatus/settingsRepo.ts
//
// Global monitoring threshold defaults + per-node overrides.
// Stored as a single JSON document in a key/value table so the admin UI can
// tune the engine without redeploying. Per-node overrides live on the server
// row (`thresholds_json`) and are merged over the defaults at evaluation time.

import { linkDb } from "../../shared/linkdb/db.js";

export type MonitoringThresholds = {
  // CPU
  cpuPct: number;
  cpuDurationSec: number;
  // Memory
  memoryWarnPct: number;
  memoryWarnDurationSec: number;
  memoryCritPct: number;
  memoryCritDurationSec: number;
  // Disk / inode
  diskWarnPct: number;
  diskCritPct: number;
  inodeWarnPct: number;
  // Network
  uplinkWarnPct: number;
  uplinkDurationSec: number;
  networkErrorDeltaThreshold: number;
  networkErrorBaselineWindow: number;
  // Availability
  offlineFailChecks: number;
  recoveryChecks: number;
  staleScrapeWarnSec: number;
  staleScrapeCritSec: number;
  // Incident lifecycle
  cooldownSec: number;
  reminderSec: number;
  hysteresisPct: number;
  // Collection / retention
  scrapeTimeoutMs: number;
  collectionIntervalSec: number;
  collectorConcurrency: number;
  retentionRawHours: number;
  retentionFiveMinDays: number;
  retentionHourDays: number;
};

export const DEFAULT_THRESHOLDS: MonitoringThresholds = {
  cpuPct: 95,
  cpuDurationSec: 900,
  memoryWarnPct: 90,
  memoryWarnDurationSec: 600,
  memoryCritPct: 97,
  memoryCritDurationSec: 900,
  diskWarnPct: 85,
  diskCritPct: 95,
  inodeWarnPct: 90,
  uplinkWarnPct: 90,
  uplinkDurationSec: 900,
  networkErrorDeltaThreshold: 50,
  networkErrorBaselineWindow: 10,
  offlineFailChecks: 3,
  recoveryChecks: 3,
  staleScrapeWarnSec: 300,
  staleScrapeCritSec: 900,
  cooldownSec: 1800,
  reminderSec: 21600,
  hysteresisPct: 5,
  scrapeTimeoutMs: 4000,
  collectionIntervalSec: 60,
  collectorConcurrency: 8,
  retentionRawHours: 48,
  retentionFiveMinDays: 14,
  retentionHourDays: 90,
};

linkDb.exec(`
CREATE TABLE IF NOT EXISTS monitoring_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

const SETTINGS_KEY = "thresholds";

export const THRESHOLD_KEYS = Object.keys(DEFAULT_THRESHOLDS) as (keyof MonitoringThresholds)[];
export const THRESHOLD_KEY_SET: ReadonlySet<string> = new Set(THRESHOLD_KEYS);

/**
 * Whitelist an untrusted threshold object.
 * Only known numeric keys survive, values are clamped, and every unknown key is
 * reported so callers can fail loudly instead of silently storing junk that
 * would never reach runtime config.
 */
export function sanitizeThresholdOverrides(input: unknown): {
  allowed: Partial<MonitoringThresholds>;
  unknownKeys: string[];
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { allowed: {}, unknownKeys: [] };
  }
  const raw = input as Record<string, unknown>;
  const unknownKeys = Object.keys(raw).filter((k) => !THRESHOLD_KEY_SET.has(k));
  const allowed: Partial<MonitoringThresholds> = {};
  for (const key of THRESHOLD_KEYS) {
    if (key in raw && raw[key] != null && raw[key] !== "") {
      allowed[key] = clampNumber(key, raw[key], DEFAULT_THRESHOLDS[key]);
    }
  }
  return { allowed, unknownKeys };
}

/**
 * Sanitize a per-node override. Unknown keys are rejected (not silently kept)
 * so an admin cannot smuggle arbitrary config into `thresholds_json`.
 */
export function sanitizePerNodeThresholds(
  input: unknown,
): { ok: true; json: string | null; unknownKeys: string[] } | { ok: false; error: string; unknownKeys: string[] } {
  if (input == null || input === "" || input === "{}") return { ok: true, json: null, unknownKeys: [] };

  let obj: unknown = input;
  if (typeof input === "string") {
    try {
      obj = JSON.parse(input);
    } catch {
      return { ok: false, error: "thresholds_invalid_json", unknownKeys: [] };
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, error: "thresholds_invalid", unknownKeys: [] };
  }

  const { allowed, unknownKeys } = sanitizeThresholdOverrides(obj);
  if (unknownKeys.length > 0) {
    return { ok: false, error: "unknown_threshold_keys", unknownKeys };
  }
  return { ok: true, json: Object.keys(allowed).length ? JSON.stringify(allowed) : null, unknownKeys: [] };
}

type NumericKey = {
  [K in keyof MonitoringThresholds]: MonitoringThresholds[K] extends number ? K : never;
}[keyof MonitoringThresholds];

function clampNumber(key: NumericKey, value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  // Keep values inside sane operational bounds so a bad admin input cannot
  // disable monitoring or make it absurdly aggressive.
  const bounds: Record<NumericKey, [number, number]> = {
    cpuPct: [1, 100],
    cpuDurationSec: [0, 86400],
    memoryWarnPct: [1, 100],
    memoryWarnDurationSec: [0, 86400],
    memoryCritPct: [1, 100],
    memoryCritDurationSec: [0, 86400],
    diskWarnPct: [1, 100],
    diskCritPct: [1, 100],
    inodeWarnPct: [1, 100],
    uplinkWarnPct: [1, 100],
    uplinkDurationSec: [0, 86400],
    networkErrorDeltaThreshold: [1, 1_000_000],
    networkErrorBaselineWindow: [2, 240],
    offlineFailChecks: [1, 50],
    recoveryChecks: [1, 50],
    staleScrapeWarnSec: [30, 86400],
    staleScrapeCritSec: [60, 172800],
    cooldownSec: [0, 86400],
    reminderSec: [60, 604800],
    hysteresisPct: [0, 50],
    scrapeTimeoutMs: [500, 60000],
    collectionIntervalSec: [15, 3600],
    collectorConcurrency: [1, 64],
    retentionRawHours: [1, 720],
    retentionFiveMinDays: [1, 365],
    retentionHourDays: [1, 3650],
  };
  const [min, max] = bounds[key];
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

export function getGlobalThresholds(): MonitoringThresholds {
  const row = linkDb.prepare(`SELECT value FROM monitoring_settings WHERE key = ?`).get(SETTINGS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return { ...DEFAULT_THRESHOLDS };

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(row.value) as Record<string, unknown>;
  } catch {
    return { ...DEFAULT_THRESHOLDS };
  }

  const out = { ...DEFAULT_THRESHOLDS };
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as NumericKey[]) {
    if (key in parsed) out[key] = clampNumber(key, parsed[key], DEFAULT_THRESHOLDS[key]);
  }
  // Keep recovery/critical ordering sane.
  out.memoryCritPct = Math.max(out.memoryCritPct, out.memoryWarnPct);
  out.diskCritPct = Math.max(out.diskCritPct, out.diskWarnPct);
  return out;
}

export function setGlobalThresholds(input: Record<string, unknown>): {
  thresholds: MonitoringThresholds;
  ignoredKeys: string[];
} {
  const current = getGlobalThresholds();
  const { allowed, unknownKeys } = sanitizeThresholdOverrides(input);
  const next = { ...current, ...allowed };
  next.memoryCritPct = Math.max(next.memoryCritPct, next.memoryWarnPct);
  next.diskCritPct = Math.max(next.diskCritPct, next.diskWarnPct);

  linkDb.prepare(`
    INSERT INTO monitoring_settings (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
  `).run(SETTINGS_KEY, JSON.stringify(next));

  return { thresholds: next, ignoredKeys: unknownKeys };
}

/**
 * Merge a per-node override over global defaults. Only known numeric keys are
 * honored; unknown/garbage values are ignored. Passing `null` uses defaults.
 */
export function resolveThresholds(overrideJson: string | null | undefined): MonitoringThresholds {
  const base = getGlobalThresholds();
  const raw = String(overrideJson ?? "").trim();
  if (!raw) return base;

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return base;
  }

  const out = { ...base };
  for (const key of Object.keys(DEFAULT_THRESHOLDS) as NumericKey[]) {
    if (key in parsed && parsed[key] != null && parsed[key] !== "") {
      out[key] = clampNumber(key, parsed[key], base[key]);
    }
  }
  out.memoryCritPct = Math.max(out.memoryCritPct, out.memoryWarnPct);
  out.diskCritPct = Math.max(out.diskCritPct, out.diskWarnPct);
  return out;
}