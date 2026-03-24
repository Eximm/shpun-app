import {
  createDevice,
  getDeviceByToken,
  getIpPrefix,
  getRecentTrialUsageByIpAndGroup,
  getTrialUsageByDeviceAndGroup,
  insertTrialProtectionEvent,
  markDeviceTrialUsed,
  resetDeviceTrialUsage,
  resetExpiredDeviceTrialUsage,
  touchDevice,
  upsertTrialUsage,
  deleteExpiredTrialUsage,
  countRecentTrialAttemptsByIpPrefix,
  countRecentTrialAttemptsByIpPrefixAndUserAgent,
  countRecentTrialUsageByIpPrefix,
  countRecentDistinctDevicesByIpPrefix,
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

function cleanupExpiredTrialUsage() {
  const ttlSeconds = getTrialDeviceTtlSeconds();
  const cutoffTs = nowTs() - ttlSeconds;

  resetExpiredDeviceTrialUsage(cutoffTs);
  deleteExpiredTrialUsage(cutoffTs);
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

export function hasDeviceUsedTrialInGroup(deviceToken: string, trialGroup: string): boolean {
  if (!deviceToken || !trialGroup) return false;

  cleanupExpiredTrialUsage();

  const row = getTrialUsageByDeviceAndGroup(deviceToken, trialGroup);
  return !!row;
}

export function hasIpUsedTrialInGroup(input: {
  ip?: string | null;
  deviceToken?: string | null;
  trialGroup: string;
}) {
  const ip = String(input.ip ?? "").trim();
  const deviceToken = String(input.deviceToken ?? "").trim();

  if (!ip || !input.trialGroup) return null;

  cleanupExpiredTrialUsage();

  const sinceTs = nowTs() - getTrialDeviceTtlSeconds();

  return getRecentTrialUsageByIpAndGroup({
    ip,
    trialGroup: input.trialGroup,
    sinceTs,
    excludeDeviceToken: deviceToken || null,
  });
}

export function getTrialRiskProfile(input: {
  ip?: string | null;
  userAgent?: string | null;
  deviceToken?: string | null;
  trialGroup: string;
  ipPrefixUsageThreshold?: number;
  ipPrefixAttemptThreshold?: number;
  ipPrefixDistinctDevicesThreshold?: number;
  ipPrefixUserAgentAttemptThreshold?: number;
}) {
  const ip = String(input.ip ?? "").trim();
  const userAgent = String(input.userAgent ?? "").trim();
  const deviceToken = String(input.deviceToken ?? "").trim();
  const trialGroup = String(input.trialGroup ?? "").trim();

  const ttlSeconds = getTrialDeviceTtlSeconds();
  const sinceTs = nowTs() - ttlSeconds;
  const ipPrefix = getIpPrefix(ip);

  const usageThreshold = Math.max(2, Number(input.ipPrefixUsageThreshold ?? 2) || 2);
  const attemptThreshold = Math.max(3, Number(input.ipPrefixAttemptThreshold ?? 3) || 3);
  const distinctDevicesThreshold = Math.max(3, Number(input.ipPrefixDistinctDevicesThreshold ?? 3) || 3);
  const uaAttemptThreshold = Math.max(2, Number(input.ipPrefixUserAgentAttemptThreshold ?? 2) || 2);

  const exactIpReuseRow =
    ip && trialGroup
      ? hasIpUsedTrialInGroup({ ip, deviceToken, trialGroup })
      : null;

  const ipPrefixUsageCount =
    ipPrefix && trialGroup
      ? countRecentTrialUsageByIpPrefix({
          ipPrefix,
          trialGroup,
          sinceTs,
          excludeDeviceToken: deviceToken || null,
        })
      : 0;

  const ipPrefixAttemptCount = ipPrefix
    ? countRecentTrialAttemptsByIpPrefix({
        ipPrefix,
        sinceTs,
        trialGroup: trialGroup || null,
      })
    : 0;

  const ipPrefixDistinctDevices = ipPrefix
    ? countRecentDistinctDevicesByIpPrefix({
        ipPrefix,
        sinceTs,
      })
    : 0;

  const ipPrefixUserAgentAttemptCount =
    ipPrefix && userAgent
      ? countRecentTrialAttemptsByIpPrefixAndUserAgent({
          ipPrefix,
          userAgent,
          sinceTs,
          trialGroup: trialGroup || null,
        })
      : 0;

  const ipPrefixUsageMatched = ipPrefixUsageCount >= usageThreshold;
  const ipPrefixAttemptMatched = ipPrefixAttemptCount >= attemptThreshold;
  const ipPrefixDistinctDevicesMatched = ipPrefixDistinctDevices >= distinctDevicesThreshold;
  const ipPrefixUserAgentMatched = ipPrefixUserAgentAttemptCount >= uaAttemptThreshold;

  const mediumSignals = [
    ipPrefixUsageMatched,
    ipPrefixAttemptMatched,
    ipPrefixDistinctDevicesMatched,
    ipPrefixUserAgentMatched,
  ].filter(Boolean).length;

  const highRisk =
    !!exactIpReuseRow ||
    mediumSignals >= 2 ||
    (ipPrefixUsageMatched && ipPrefixUserAgentMatched);

  return {
    exactIpReuseRow,
    ipPrefix,
    mediumSignals,
    highRisk,
    ipPrefixUsageCount,
    ipPrefixUsageThreshold: usageThreshold,
    ipPrefixUsageMatched,
    ipPrefixAttemptCount,
    ipPrefixAttemptThreshold: attemptThreshold,
    ipPrefixAttemptMatched,
    ipPrefixDistinctDevices,
    ipPrefixDistinctDevicesThreshold: distinctDevicesThreshold,
    ipPrefixDistinctDevicesMatched,
    ipPrefixUserAgentAttemptCount,
    ipPrefixUserAgentAttemptThreshold: uaAttemptThreshold,
    ipPrefixUserAgentMatched,
  };
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

export function isDeviceManuallyBlocked(deviceToken: string): boolean {
  if (!deviceToken) return false;
  const row = getDeviceByToken(deviceToken);
  return Number(row?.is_blocked ?? 0) === 1;
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