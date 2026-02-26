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
  // target больше не используем (биллинг решает сам)
  target?: "all" | "user";
  user_id?: number;
  toast?: boolean;
  meta?: unknown;
};

function normalizeTs(v: any): number {
  const raw = Number(v);
  let ts = Number.isFinite(raw) ? raw : Math.floor(Date.now() / 1000);

  if (ts > 10_000_000_000) ts = Math.floor(ts / 1000);

  ts = Math.floor(ts);
  if (!Number.isFinite(ts) || ts <= 0) ts = Math.floor(Date.now() / 1000);
  return ts;
}

function normalizeBaseEventId(base: any): string {
  const raw = String(base ?? "").trim();
  return raw || "evt";
}

function buildBroadcastEventId(uid: number, baseEventId: string): string {
  // 1 новость = 1 запись на пользователя (повтор по тому же event_id дедупится)
  return `u:${uid}:b:${baseEventId}`;
}

function buildUserEventId(uid: number, baseEventId: string, ts: number): string {
  // обычные события могут приходить много раз — включаем ts
  return `u:${uid}:e:${baseEventId}:${ts}`;
}

export function putEvent(
  e: BillingPushEvent,
):
  | { ok: true; dedup: boolean; event: NotifEvent }
  | { ok: false; error: string } {
  const ts = normalizeTs(e.ts);
  const baseEventId = normalizeBaseEventId(e.event_id);

  const uid = Number(e.user_id ?? 0);
  if (!Number.isFinite(uid) || uid <= 0) {
    // strict: всё только на конкретного пользователя
    return { ok: false, error: "missing_user_id" };
  }

  const type = String(e.type ?? "").trim();

  // broadcast.news -> стабильно дедупим (1 раз на пользователя)
  const event_id = type === "broadcast.news"
    ? buildBroadcastEventId(uid, baseEventId)
    : buildUserEventId(uid, baseEventId, ts);

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