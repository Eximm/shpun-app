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

function normalizeEventId(base: any, ts: number): string {
  const raw = String(base ?? "").trim();
  const b = raw || "evt";

  // If billing sends constant ids like "service-block-1731-" (no suffix),
  // make it unique by adding ts. This also fixes empty/invalid ids.
  const needsSuffix =
    !raw ||
    raw.endsWith("-") ||
    raw.endsWith("_") ||
    raw.length < 8 ||
    !/[0-9a-zA-Z]/.test(raw);

  return needsSuffix ? `${b}${b.endsWith("-") ? "" : "-"}${ts}` : b;
}

export function putEvent(e: BillingPushEvent) {
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

  return putNotifEvent(ev);
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