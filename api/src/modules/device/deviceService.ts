import {
  createDevice,
  getDeviceByToken,
  insertTrialProtectionEvent,
  markDeviceTrialUsed,
  touchDevice,
} from "./deviceRepo.js";

export type TrialDeviceMode = "off" | "observe" | "enforce";

export function getTrialDeviceMode(): TrialDeviceMode {
  const raw = String(process.env.TRIAL_DEVICE_MODE ?? "observe").trim().toLowerCase();
  if (raw === "off" || raw === "observe" || raw === "enforce") return raw;
  return "observe";
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

export function registerDeviceSeen(input: {
  deviceToken: string;
  ip?: string | null;
  userAgent?: string | null;
}) {
  if (!input.deviceToken) return null;

  const now = Math.floor(Date.now() / 1000);
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
  const row = getDeviceByToken(deviceToken);
  return !!row?.trial_used_at;
}

export function rememberTrialUsed(input: {
  deviceToken: string;
  userId?: number | null;
}) {
  if (!input.deviceToken) return;

  const now = Math.floor(Date.now() / 1000);
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
    createdAt: Math.floor(Date.now() / 1000),
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