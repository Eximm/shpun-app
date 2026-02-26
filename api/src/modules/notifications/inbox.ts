import { linkDb } from "../../shared/linkdb/db.js";
import {
  putNotifEvent,
  listNotifAfter,
  listNotifFeed,
  type NotifEvent,
  type NotifCursor,
} from "../../shared/linkdb/notificationsRepo.js";

export type BillingPushEvent = {
  event_id: string;
  ts?: number | string;
  type?: string;
  level?: "info" | "success" | "error";
  title?: string;
  message?: string;
  target?: "all" | "user";
  user_id?: number;
  toast?: boolean;
  meta?: unknown;
};

function normalizeTs(v: any): number {
  const raw = Number(v);
  let ts = Number.isFinite(raw) ? raw : Math.floor(Date.now() / 1000);

  // allow ms
  if (ts > 10_000_000_000) ts = Math.floor(ts / 1000);

  ts = Math.floor(ts);
  if (!Number.isFinite(ts) || ts <= 0) ts = Math.floor(Date.now() / 1000);
  return ts;
}

function normalizeBaseEventId(base: any): string {
  const raw = String(base ?? "").trim();
  return raw || "evt";
}

function isBroadcast(e: BillingPushEvent): boolean {
  const t = String(e.type ?? "").trim();
  if (e.target === "all") return true;
  if (t === "broadcast.news") return true;
  return false;
}

// Pull distinct users known to the app.
// NOTE: account_links has shm_user_id; this is our "user id" across the app.
const stmtListAllUserIds = linkDb.prepare(`
  SELECT DISTINCT shm_user_id AS uid
  FROM account_links
  WHERE shm_user_id IS NOT NULL AND shm_user_id > 0
`);

/**
 * Event id rules:
 * - Broadcast: MUST be stable per user, so it dedupes (1 per user).
 *   => "u:<uid>:b:<baseEventId>"
 *
 * - User events (forecast, service.* etc): allow multiple occurrences.
 *   We scope to user and include ts so repeated pushes are kept.
 *   => "u:<uid>:e:<baseEventId>:<ts>"
 *
 * This keeps:
 * - no cross-user PK collisions
 * - forecast can be triggered often (each ts -> new row)
 * - broadcast does not multiply (same baseEventId -> only one per user)
 */
function buildUserEventId(uid: number, baseEventId: string, ts: number): string {
  return `u:${uid}:e:${baseEventId}:${ts}`;
}

function buildBroadcastEventId(uid: number, baseEventId: string): string {
  return `u:${uid}:b:${baseEventId}`;
}

export function putEvent(
  e: BillingPushEvent,
):
  | { ok: true; dedup: boolean; event?: NotifEvent; delivered?: { total: number; inserted: number } }
  | { ok: false; error: string } {
  const ts = normalizeTs(e.ts);
  const baseEventId = normalizeBaseEventId(e.event_id);

  // ===== broadcast => expand to all users =====
  if (isBroadcast(e)) {
    const rows = stmtListAllUserIds.all() as Array<{ uid: number }>;
    const uids = rows.map((r) => Number(r.uid)).filter((x) => Number.isFinite(x) && x > 0);

    let inserted = 0;
    let anyDedup = false;

    for (const uid of uids) {
      const ev: NotifEvent = {
        event_id: buildBroadcastEventId(uid, baseEventId),
        ts,
        type: e.type,
        level: e.level,
        title: e.title,
        message: e.message,
        target: "user",
        user_id: uid,
        toast: e.toast,
        meta: e.meta,
      };

      const r = putNotifEvent(ev);
      if (!r.ok) return r;

      if (r.dedup) anyDedup = true;
      else inserted++;
    }

    return {
      ok: true,
      dedup: anyDedup && inserted === 0,
      delivered: { total: uids.length, inserted },
    };
  }

  // ===== personal event => must have user_id =====
  const uid = Number(e.user_id ?? 0);
  if (!Number.isFinite(uid) || uid <= 0) {
    return { ok: false, error: "missing_user_id" };
  }

  const ev: NotifEvent = {
    event_id: buildUserEventId(uid, baseEventId, ts),
    ts,
    type: e.type,
    level: e.level,
    title: e.title,
    message: e.message,
    target: "user",
    user_id: uid,
    toast: e.toast,
    meta: e.meta,
  };

  const r = putNotifEvent(ev);
  if (!r.ok) return r;

  return { ok: true, dedup: r.dedup, event: ev };
}

export function listEvents(params: {
  afterTs?: number;
  afterId?: string;
  userId?: number;
  limit?: number;
}): { items: NotifEvent[]; nextCursor: NotifCursor } {
  return listNotifAfter(params);
}

export function listFeed(params: {
  userId?: number;
  beforeTs?: number;
  beforeId?: string;
  limit?: number;
}): { items: NotifEvent[]; nextBefore: NotifCursor } {
  return listNotifFeed(params);
}