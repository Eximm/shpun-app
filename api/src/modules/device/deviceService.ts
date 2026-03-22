import {
  createDevice,
  getDeviceByToken,
  getTrialUsageByDeviceAndGroup,
  insertTrialProtectionEvent,
  markDeviceTrialUsed,
  resetDeviceTrialUsage,
  resetExpiredDeviceTrialUsage,
  touchDevice,
  upsertTrialUsage,
  deleteExpiredTrialUsage,
} from "./deviceRepo.js";

export type TrialDeviceMode = "off" | "observe" | "enforce";

let cachedMode: TrialDeviceMode | null = null;
let cachedTtlHours: number | null = null;

function nowTs(): number {
  return Math.floor(Date.now() / 1000);
}

export function setCachedTrialDeviceMode(mode: TrialDeviceMode | null) {
  cachedMode = mode;
}

export function setCachedTrialDeviceTtlHours(v: number | null) {
  cachedTtlHours = v;
}

export function getTrialDeviceMode(): TrialDeviceMode {
  if (cachedMode) return cachedMode;

  const raw = String(process.env.TRIAL_DEVICE_MODE ?? "observe").trim().toLowerCase();
  if (raw === "off" || raw === "observe" || raw === "enforce") return raw;
  return "observe";
}

export function getTrialDeviceTtlHours(): number {
  if (cachedTtlHours != null && Number.isFinite(cachedTtlHours) && cachedTtlHours > 0) {
    return cachedTtlHours;
  }

  const raw = Number(process.env.TRIAL_DEVICE_TTL_HOURS ?? 72);
  if (!Number.isFinite(raw) || raw <= 0) return 72;
  return raw;
}

export function getTrialDeviceTtlSeconds(): number {
  return getTrialDeviceTtlHours() * 60 * 60;
}

export function normalizeDeviceToken(v: unknown): string {
  return String(v ?? "").trim().slice(0, 200);
}

export function getRequestDeviceToken(req: any): string {
  return normalizeDeviceToken(req?.headers?.["x-device-token"]);
}

export function getRequestIp(req: any): string {
  const xff = String(req?.headers?.["x-forwarded-for"] ?? "").trim();
  if (xff) return xff.split(",")[0].trim();
  return String(req?.ip ?? "").trim();
}

export function getRequestUserAgent(req: any): string {
  return String(req?.headers?.["user-agent"] ?? "").trim().slice(0, 500);
}

/* ============================================================
   CLEANUP
============================================================ */

function cleanupExpiredTrialUsage() {
  const ttlSeconds = getTrialDeviceTtlSeconds();
  const cutoffTs = nowTs() - ttlSeconds;

  // legacy single-trial-per-device
  resetExpiredDeviceTrialUsage(cutoffTs);

  // current trial-group usage
  deleteExpiredTrialUsage(cutoffTs);
}

function isTrialExpired(trialUsedAt: number | null | undefined): boolean {
  if (!trialUsedAt) return false;
  const ttlSeconds = getTrialDeviceTtlSeconds();
  return trialUsedAt < nowTs() - ttlSeconds;
}

/* ============================================================
   DEVICE TRACKING
============================================================ */

export function registerDeviceSeen(input: {
  deviceToken: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  if (!input.deviceToken) return null;

  cleanupExpiredTrialUsage();

  const now = nowTs();
  const existing = getDeviceByToken(input.deviceToken);

  if (!existing) {
    createDevice({
      deviceToken: input.deviceToken,
      now,
      ip: input.ip,
      userAgent: input.userAgent,
    });
    return getDeviceByToken(input.deviceToken);
  }

  if (isTrialExpired(existing.trial_used_at)) {
    resetDeviceTrialUsage(input.deviceToken);
  }

  touchDevice({
    deviceToken: input.deviceToken,
    now,
    ip: input.ip,
    userAgent: input.userAgent,
  });

  return getDeviceByToken(input.deviceToken);
}

/* ============================================================
   GROUP-BASED TRIAL LOGIC
============================================================ */

export function hasDeviceUsedTrialInGroup(deviceToken: string, trialGroup: string): boolean {
  if (!deviceToken || !trialGroup) return false;

  cleanupExpiredTrialUsage();

  const row = getTrialUsageByDeviceAndGroup(deviceToken, trialGroup);
  return !!row;
}

export function rememberTrialUsedInGroup(input: {
  deviceToken: string;
  trialGroup: string;
  userId?: number | null;
  serviceId?: number | null;
}) {
  if (!input.deviceToken || !input.trialGroup) return;

  upsertTrialUsage({
    deviceToken: input.deviceToken,
    trialGroup: input.trialGroup,
    usedAt: nowTs(),
    userId: input.userId ?? null,
    serviceId: input.serviceId ?? null,
  });
}

/* ============================================================
   LEGACY COMPATIBILITY
============================================================ */

export function hasDeviceUsedTrial(deviceToken: string): boolean {
  if (!deviceToken) return false;

  cleanupExpiredTrialUsage();

  const row = getDeviceByToken(deviceToken);
  if (!row?.trial_used_at) return false;

  if (isTrialExpired(row.trial_used_at)) {
    resetDeviceTrialUsage(deviceToken);
    return false;
  }

  return true;
}

export function rememberTrialUsed(input: {
  deviceToken: string;
  userId?: number | null;
}) {
  if (!input.deviceToken) return;

  const now = nowTs();
  markDeviceTrialUsed({
    deviceToken: input.deviceToken,
    now,
    userId: input.userId ?? null,
  });
}

/* ============================================================
   LOGGING
============================================================ */

export function logTrialEvent(input: {
  deviceToken?: string | null;
  userId?: number | null;
  ip?: string | null;
  userAgent?: string | null;
  eventType: string;
  decision: "allow" | "observe" | "block";
  reason?: string | null;
  meta?: unknown;
}) {
  insertTrialProtectionEvent({
    createdAt: nowTs(),
    deviceToken: input.deviceToken ?? null,
    userId: input.userId ?? null,
    ip: input.ip ?? null,
    userAgent: input.userAgent ?? null,
    eventType: input.eventType,
    decision: input.decision,
    reason: input.reason ?? null,
    metaJson: input.meta == null ? null : JSON.stringify(input.meta),
  });
}