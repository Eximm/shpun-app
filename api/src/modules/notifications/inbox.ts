import {
  putNotifEvent,
  listNotifAfter,
  listNotifFeed,
  type NotifEvent,
  type NotifCursor,
} from "../../shared/linkdb/notificationsRepo.js";

export type BillingPushEvent = {
  event_id: string;
  ts?: number;
  type?: string;
  level?: "info" | "success" | "error";
  title?: string;
  message?: string;
  target?: "all" | "user";
  user_id?: number;
  toast?: boolean;
  meta?: unknown;
};

export function putEvent(e: BillingPushEvent) {
  const ev: NotifEvent = {
    event_id: e.event_id,
    ts: Number.isFinite(Number(e.ts)) ? Number(e.ts) : Math.floor(Date.now() / 1000),
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