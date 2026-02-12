// api/src/shared/session/sessionStore.ts
import { randomUUID } from "node:crypto";

export type AppSession = {
  shmSessionId: string;
  shmUserId?: number;
  createdAt: number;
  lastSeenAt: number;
};

const store = new Map<string, AppSession>();

// TTL для in-memory сессий (в миллисекундах)
// Для беты — 7 дней. Потом можно заменить на Redis и убрать TTL здесь.
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function now() {
  return Date.now();
}

function isExpired(s: AppSession, t = now()) {
  return t - (s.lastSeenAt || s.createdAt) > SESSION_TTL_MS;
}

// Ленивая уборка: не чаще раза в минуту
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

export function putSession(localSid: string, session: Omit<AppSession, "lastSeenAt">) {
  const t = now();
  store.set(localSid, { ...session, lastSeenAt: t });
}

export function getSession(localSid: string | undefined) {
  cleanupIfNeeded();

  if (!localSid) return null;

  const s = store.get(localSid) ?? null;
  if (!s) return null;

  if (isExpired(s)) {
    store.delete(localSid);
    return null;
  }

  // “touch”
  s.lastSeenAt = now();
  store.set(localSid, s);

  return s;
}

export function deleteSession(localSid: string | undefined) {
  if (!localSid) return;
  store.delete(localSid);
}
