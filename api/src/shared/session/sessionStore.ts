// api/src/shared/session/sessionStore.ts
import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";
import {
  upsertSession,
  getSession as getDbSession,
  touchSession,
  deleteSessionBySid,
  cleanupSessions,
} from "../linkdb/sessionRepo.js";

export type AppSession = {
  shmSessionId: string;
  shmUserId?: number;
  userId?: number; // backcompat alias
  createdAt: number;
  lastSeenAt: number;

  // важно для re-auth после смены пароля в Telegram WebApp
  telegramInitData?: string;

  // важно для re-auth после смены пароля в Telegram Widget
  telegramWidgetPayload?: Record<string, any>;
};

// Максимально долго: по умолчанию 365 дней “скользящей” сессии.
const SESSION_TTL_MS = Number(
  process.env.SESSION_TTL_MS || 365 * 24 * 60 * 60 * 1000
);

// Чтобы не писать в SQLite на каждый запрос — троттлим touch.
const TOUCH_MIN_INTERVAL_MS = Number(process.env.SESSION_TOUCH_MS || 30_000);

function now() {
  return Date.now();
}

function isExpired(s: AppSession, t = now()) {
  return t - (s.lastSeenAt || s.createdAt) > SESSION_TTL_MS;
}

// ленивая уборка: не чаще раза в минуту
let lastCleanupAt = 0;
function cleanupIfNeeded() {
  const t = now();
  if (t - lastCleanupAt < 60_000) return;
  lastCleanupAt = t;

  try {
    cleanupSessions(SESSION_TTL_MS);
  } catch {
    // best-effort
  }
}

function safeParseJsonObject(text: string | undefined): Record<string, any> | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text);
    if (v && typeof v === "object") return v as any;
    return undefined;
  } catch {
    return undefined;
  }
}

export function createLocalSid() {
  return randomUUID();
}

export function putSession(
  localSid: string,
  session: Omit<AppSession, "lastSeenAt">
) {
  const t = now();

  const merged: AppSession = {
    ...session,
    shmUserId: session.shmUserId ?? session.userId,
    userId: session.userId ?? session.shmUserId,
    lastSeenAt: t,
    ...(session.telegramInitData
      ? { telegramInitData: String(session.telegramInitData).trim() }
      : {}),
  };

  const widgetJson =
    merged.telegramWidgetPayload && typeof merged.telegramWidgetPayload === "object"
      ? JSON.stringify(merged.telegramWidgetPayload)
      : undefined;

  upsertSession({
    sid: localSid,
    shmUserId: Number(merged.shmUserId || 0),
    shmSessionId: String(merged.shmSessionId || ""),
    telegramInitData: merged.telegramInitData,
    telegramWidgetPayload: widgetJson,
    createdAt: Number(merged.createdAt || t),
    lastSeenAt: Number(merged.lastSeenAt || t),
  });
}

/** Получить сессию по localSid (sid cookie) */
export function getSessionBySid(localSid: string | undefined) {
  cleanupIfNeeded();
  if (!localSid) return null;

  const s0 = getDbSession(localSid);
  if (!s0) return null;

  const s: AppSession = {
    shmSessionId: s0.shmSessionId,
    shmUserId: s0.shmUserId,
    userId: s0.shmUserId,
    createdAt: s0.createdAt,
    lastSeenAt: s0.lastSeenAt,
    ...(s0.telegramInitData ? { telegramInitData: s0.telegramInitData } : {}),
    ...(s0.telegramWidgetPayload
      ? { telegramWidgetPayload: safeParseJsonObject(s0.telegramWidgetPayload) }
      : {}),
  };

  if (isExpired(s)) {
    deleteSessionBySid(localSid);
    return null;
  }

  // touch (скользящая сессия), но не чаще TOUCH_MIN_INTERVAL_MS
  const t = now();
  if (t - (s.lastSeenAt || s.createdAt) >= TOUCH_MIN_INTERVAL_MS) {
    try {
      touchSession(localSid, t);
      s.lastSeenAt = t;
    } catch {
      // ignore
    }
  }

  return s;
}

/** Robust sid parse from raw Cookie header (fallback) */
function getSidFromCookieHeader(req: FastifyRequest): string | undefined {
  const hdr = String(req.headers?.cookie ?? "");
  if (!hdr) return undefined;
  const m = hdr.match(/(?:^|;\s*)sid=([^;]+)/);
  if (!m) return undefined;
  const raw = String(m[1] ?? "").trim();
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/** Вытянуть sid из запроса (cookie sid, заголовок x-app-sid, или raw Cookie header) */
function getSidFromRequest(req: FastifyRequest): string | undefined {
  const sidCookie = (req.cookies as any)?.sid;
  if (typeof sidCookie === "string" && sidCookie.trim()) return sidCookie.trim();

  const sidHeader = req.headers["x-app-sid"];
  if (typeof sidHeader === "string" && sidHeader.trim()) return sidHeader.trim();

  const fromCookieHdr = getSidFromCookieHeader(req);
  if (fromCookieHdr && fromCookieHdr.trim()) return fromCookieHdr.trim();

  return undefined;
}

/** Получить сессию из FastifyRequest (sid cookie) */
export function getSessionFromRequest(req: FastifyRequest) {
  return getSessionBySid(getSidFromRequest(req));
}

/**
 * BACKCOMPAT:
 * Старые роуты импортят getSession(req) — оставляем алиас.
 * Важно: принимает FastifyRequest (не sid-строку).
 */
export function getSession(req: FastifyRequest) {
  return getSessionFromRequest(req);
}

export function deleteSession(localSid: string | undefined) {
  if (!localSid) return;
  try {
    deleteSessionBySid(localSid);
  } catch {
    // ignore
  }
}
