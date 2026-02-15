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

  upsertSession({
    sid: localSid,
    shmUserId: Number(merged.shmUserId || 0),
    shmSessionId: String(merged.shmSessionId || ""),
    telegramInitData: merged.telegramInitData,
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

/** Вытянуть sid из запроса (cookie sid или заголовок x-app-sid) */
function getSidFromRequest(req: FastifyRequest): string | undefined {
  const sidCookie = (req.cookies as any)?.sid;
  if (typeof sidCookie === "string" && sidCookie.trim()) return sidCookie.trim();

  const sidHeader = req.headers["x-app-sid"];
  if (typeof sidHeader === "string" && sidHeader.trim()) return sidHeader.trim();

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
