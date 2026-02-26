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

function randHex(n = 10) {
  return Math.random().toString(16).slice(2, 2 + n);
}

function normalizeEventId(base: any, ts: number): string {
  const raw = String(base ?? "").trim();
  const b = raw || "evt";

  // Billing may send non-unique ids. We must keep ALL events in feed.
  // Add unique suffix always (ts + random) while keeping original prefix for search/debug.
  const sep = b.endsWith("-") || b.endsWith("_") ? "" : "-";
  return `${b}${sep}${ts}-${randHex()}`;
}

export function putEvent(e: BillingPushEvent):
  | { ok: true; dedup: boolean; event: NotifEvent }
  | { ok: false; error: string } {
  const ts = normalizeTs(e.ts);
  const event_id = normalizeEventId(e.event_id, ts);

  const ev: NotifEvent = {
    event_id,
    ts,
    type: e.type,
    level: e.level,
    title: e.title,
    message: e.message,
    target: e.target,
    user_id: e.user_id,
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