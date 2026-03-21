import {
  createDevice,
  getDeviceByToken,
  insertTrialProtectionEvent,
  markDeviceTrialUsed,
  resetDeviceTrialUsage,
  resetExpiredDeviceTrialUsage,
  touchDevice,
} from "./deviceRepo.js";

export type TrialDeviceMode = "off" | "observe" | "enforce";

function nowTs(): number {
  return Math.floor(Date.now() / 1000);
}

let cachedMode: TrialDeviceMode | null = null;

export function setCachedTrialDeviceMode(mode: TrialDeviceMode | null) {
  cachedMode = mode;
}

export function getTrialDeviceMode(): TrialDeviceMode {
  if (cachedMode) return cachedMode;

  const raw = String(process.env.TRIAL_DEVICE_MODE ?? "observe").trim().toLowerCase();
  if (raw === "off" || raw === "observe" || raw === "enforce") return raw;
  return "observe";
}

export function getTrialDeviceTtlHours(): number {
  const raw = Number(process.env.TRIAL_DEVICE_TTL_HOURS ?? 72);
  if (!Number.isFinite(raw) || raw <= 0) return 72;
  return Math.floor(raw);
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

function cleanupExpiredTrialUsage() {
  const ttlSeconds = getTrialDeviceTtlSeconds();
  const cutoffTs = nowTs() - ttlSeconds;
  resetExpiredDeviceTrialUsage(cutoffTs);
}

function isTrialExpired(trialUsedAt: number | null | undefined): boolean {
  if (!trialUsedAt) return false;
  const ttlSeconds = getTrialDeviceTtlSeconds();
  return trialUsedAt < nowTs() - ttlSeconds;
}

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