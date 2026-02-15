// api/src/shared/session/sessionStore.ts
import { randomUUID } from "node:crypto";
import type { FastifyRequest } from "fastify";

export type AppSession = {
  shmSessionId: string;
  shmUserId?: number;
  userId?: number; // алиас под старые места (если где-то ждут userId)
  createdAt: number;
  lastSeenAt: number;

  // важно для re-auth после смены пароля в Telegram WebApp
  telegramInitData?: string;
};

const store = new Map<string, AppSession>();

// Для беты: 30 дней “скользящей” сессии в памяти.
// (user не должен разлогиниваться — это важно для уведомлений)
const SESSION_TTL_MS = Number(
  process.env.SESSION_TTL_MS || 30 * 24 * 60 * 60 * 1000
);

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

  for (const [sid, s] of store.entries()) {
    if (isExpired(s, t)) store.delete(sid);
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

  // userId поддержим как алиас к shmUserId — чтобы старые роуты не падали
  const merged: AppSession = {
    ...session,
    shmUserId: session.shmUserId ?? session.userId,
    userId: session.userId ?? session.shmUserId,
    lastSeenAt: t,

    // мягкая нормализация: если поле есть, то строка без мусора
    ...(session.telegramInitData
      ? { telegramInitData: String(session.telegramInitData).trim() }
      : {}),
  };

  store.set(localSid, merged);
}

/** Получить сессию по localSid (sid cookie) */
export function getSessionBySid(localSid: string | undefined) {
  cleanupIfNeeded();
  if (!localSid) return null;

  const s = store.get(localSid) ?? null;
  if (!s) return null;

  if (isExpired(s)) {
    store.delete(localSid);
    return null;
  }

  // touch (скользящая сессия)
  s.lastSeenAt = now();
  store.set(localSid, s);

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
 * Важно: getSession принимает именно FastifyRequest (не sid-строку).
 */
export function getSession(req: FastifyRequest) {
  return getSessionFromRequest(req);
}

export function deleteSession(localSid: string | undefined) {
  if (!localSid) return;
  store.delete(localSid);
}
