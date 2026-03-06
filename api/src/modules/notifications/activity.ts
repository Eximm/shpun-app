type ActiveState = {
  untilTs: number;
};

const ACTIVE_TTL_SEC = 30;
const activeUsers = new Map<number, ActiveState>();

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

export function markUserActive(userId: number, ttlSec = ACTIVE_TTL_SEC) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return;

  activeUsers.set(uid, {
    untilTs: nowSec() + Math.max(5, Math.floor(ttlSec)),
  });
}

export function isUserActive(userId: number): boolean {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return false;

  const state = activeUsers.get(uid);
  if (!state) return false;

  if (state.untilTs <= nowSec()) {
    activeUsers.delete(uid);
    return false;
  }

  return true;
}

export function clearUserActive(userId: number) {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return;
  activeUsers.delete(uid);
}