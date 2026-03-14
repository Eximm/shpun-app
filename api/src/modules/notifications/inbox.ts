// FILE: api/src/modules/notifications/inbox.ts
import {
  putNotifEvent,
  listNotifAfter,
  listNotifFeed,
  listNotifNewsFeed,
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
  target?: "all" | "user"; // can be ignored, billing decides recipients
  user_id?: number | string; // may be absent for broadcast
  toast?: boolean;
  push?: boolean;
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

function parseUid(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Broadcast detection:
 * - billing sets type=broadcast.news for news
 * - sometimes target=all is present (we tolerate it)
 */
function isBroadcast(e: BillingPushEvent): boolean {
  const t = String(e.type ?? "").trim();
  if (e.target === "all") return true;
  if (t === "broadcast.news") return true;
  return false;
}

function buildSystemBroadcastEventId(baseEventId: string): string {
  return `sys:broadcast:${baseEventId}`;
}

function buildUserEventId(uid: number, baseEventId: string, ts: number): string {
  // personal events can repeat often => include ts
  return `u:${uid}:e:${baseEventId}:${ts}`;
}

export function putEvent(
  e: BillingPushEvent,
):
  | {
      ok: true;
      dedup: boolean;
      event?: NotifEvent;
      delivered?: { total: number; inserted: number; userIds?: number[] };
    }
  | { ok: false; error: string } {
  const ts = normalizeTs(e.ts);
  const baseEventId = normalizeBaseEventId(e.event_id);
  const uid = parseUid(e.user_id);
  const type = String(e.type ?? "").trim();
  const broadcast = isBroadcast(e);

  // ===== A) broadcast => single global event =====
  // Important:
  // even if billing executes template from some concrete user (e.g. admin user_id=1),
  // broadcast.news must be stored ONCE globally, not copied per user.
  if (broadcast) {
    const ev: NotifEvent = {
      event_id: buildSystemBroadcastEventId(baseEventId),
      ts,
      type: e.type,
      level: e.level,
      title: e.title,
      message: e.message,
      target: "all",
      toast: e.toast,
      meta: e.meta,
    };

    const r = putNotifEvent(ev);
    if (!r.ok) return r;

    return {
      ok: true,
      dedup: r.dedup,
      event: ev,
      delivered: { total: 1, inserted: r.dedup ? 0 : 1 },
    };
  }

  // ===== B) personal event => user_id required =====
  if (uid === 0) {
    return { ok: false, error: "missing_user_id" };
  }

  const event_id = buildUserEventId(uid, baseEventId, ts);

  const ev: NotifEvent = {
    event_id,
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

export function listNewsFeed(params: {
  userId?: number;
  beforeTs?: number;
  beforeId?: string;
  limit?: number;
}): { items: NotifEvent[]; nextBefore: NotifCursor } {
  return listNotifNewsFeed(params);
}