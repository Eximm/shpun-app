// FILE: api/src/shared/linkdb/notificationsRepo.ts
import { linkDb } from "./db.js";

export type NotifTarget = "all" | "user";
export type NotifLevel = "info" | "success" | "error";

export type NotifEvent = {
  event_id: string;
  ts: number;
  type?: string;
  level?: NotifLevel;
  title?: string;
  message?: string;
  target?: NotifTarget;
  user_id?: number;
  toast?: boolean;
  meta?: unknown;
};

export type NotifCursor = { ts: number; id: string };

export type BroadcastItem = {
  origin_id: string;
  ts: number;
  type?: string;
  level?: NotifLevel;
  title?: string;
  message?: string;
  copies: number;
  hidden: boolean;
};

function asInt(v: any) { return v ? 1 : 0; }

function parseJson(s: any) {
  if (!s) return undefined;
  try { return JSON.parse(String(s)); } catch { return undefined; }
}

function normalizeTs(input: any): number {
  const raw = Number(input);
  let ts = Number.isFinite(raw) ? raw : Math.floor(Date.now() / 1000);
  if (ts > 10_000_000_000) ts = Math.floor(ts / 1000);
  ts = Math.floor(ts);
  if (!Number.isFinite(ts) || ts <= 0) ts = Math.floor(Date.now() / 1000);
  return ts;
}

function rowToEvent(r: any): NotifEvent {
  return {
    event_id: String(r.event_id),
    ts: Number(r.ts),
    type: r.type ?? undefined,
    level: r.level ?? undefined,
    title: r.title ?? undefined,
    message: r.message ?? undefined,
    target: (r.target === "user" ? "user" : "all") as NotifTarget,
    user_id: r.user_id == null ? undefined : Number(r.user_id),
    toast: Number(r.toast) === 1,
    meta: parseJson(r.meta_json),
  };
}

function extractBroadcastOriginId(eventId: string): string {
  const s = String(eventId ?? "").trim();
  const sys = s.match(/^sys:broadcast:(.+)$/);
  if (sys?.[1]) return String(sys[1]).trim();
  const legacy = s.match(/^u:\d+:b:(.+)$/);
  if (legacy?.[1]) return String(legacy[1]).trim();
  return "";
}

// ===== schema =====
linkDb.exec(`
CREATE TABLE IF NOT EXISTS notif_events (
  event_id   TEXT PRIMARY KEY,
  ts         INTEGER NOT NULL,
  target     TEXT NOT NULL DEFAULT 'all',
  user_id    INTEGER,
  type       TEXT,
  level      TEXT,
  title      TEXT,
  message    TEXT,
  toast      INTEGER NOT NULL DEFAULT 0,
  meta_json  TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notif_events_ts
  ON notif_events(ts);

CREATE INDEX IF NOT EXISTS idx_notif_events_user_ts
  ON notif_events(user_id, ts);

CREATE INDEX IF NOT EXISTS idx_notif_events_target_ts
  ON notif_events(target, ts);

CREATE INDEX IF NOT EXISTS idx_notif_events_user_type_ts
  ON notif_events(user_id, type, ts);
`);

// Добавляем колонку hidden если её ещё нет (миграция)
try {
  linkDb.exec(`ALTER TABLE notif_events ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0`);
} catch {
  // уже есть — игнорируем
}

// ===== statements =====

const stmtInsertOrIgnore = linkDb.prepare(`
  INSERT OR IGNORE INTO notif_events
    (event_id, ts, target, user_id, type, level, title, message, toast, meta_json)
  VALUES
    (@event_id, @ts, @target, @user_id, @type, @level, @title, @message, @toast, @meta_json)
`);

const stmtListAfter = linkDb.prepare(`
  SELECT * FROM notif_events
  WHERE
    (
      ts > @afterTs
      OR (ts = @afterTs AND event_id > @afterId)
    )
    AND (
      target = 'all'
      OR (
        target = 'user'
        AND user_id = @uid
        AND @uid > 0
      )
    )
    AND hidden = 0
  ORDER BY ts ASC, event_id ASC
  LIMIT @limit
`);

const stmtFeed = linkDb.prepare(`
  SELECT * FROM notif_events
  WHERE
    (
      @beforeTs = 0
      OR ts < @beforeTs
      OR (ts = @beforeTs AND event_id < @beforeId)
    )
    AND (
      target = 'all'
      OR (
        target = 'user'
        AND user_id = @uid
        AND @uid > 0
      )
    )
    AND hidden = 0
  ORDER BY ts DESC, event_id DESC
  LIMIT @limit
`);

const stmtFeedNews = linkDb.prepare(`
  SELECT * FROM notif_events
  WHERE
    (
      @beforeTs = 0
      OR ts < @beforeTs
      OR (ts = @beforeTs AND event_id < @beforeId)
    )
    AND (
      target = 'all'
      OR (
        target = 'user'
        AND user_id = @uid
        AND @uid > 0
      )
    )
    AND (
      type = 'broadcast.news'
      OR type LIKE 'broadcast.news.%'
      OR type LIKE 'broadcast.%'
    )
    AND hidden = 0
  ORDER BY ts DESC, event_id DESC
  LIMIT @limit
`);

const stmtDeleteBroadcastByOriginId = linkDb.prepare(`
  DELETE FROM notif_events
  WHERE
    type LIKE 'broadcast.%'
    AND (
      event_id = @sysEventId
      OR event_id LIKE @userPattern
    )
`);

const stmtListBroadcastRows = linkDb.prepare(`
  SELECT event_id, ts, type, level, title, message, hidden
  FROM notif_events
  WHERE type LIKE 'broadcast.%'
  ORDER BY ts DESC, event_id DESC
  LIMIT @limit
`);

const stmtHideBroadcast = linkDb.prepare(`
  UPDATE notif_events
  SET hidden = @hidden
  WHERE
    type LIKE 'broadcast.%'
    AND (
      event_id = @sysEventId
      OR event_id LIKE @userPattern
    )
`);

const stmtUpdateBroadcast = linkDb.prepare(`
  UPDATE notif_events
  SET title = @title, message = @message
  WHERE
    type LIKE 'broadcast.%'
    AND (
      event_id = @sysEventId
      OR event_id LIKE @userPattern
    )
`);

// ===== exports =====

export function putNotifEvent(
  ev: NotifEvent,
): { ok: true; dedup: boolean } | { ok: false; error: string } {
  const event_id = String(ev?.event_id ?? "").trim();
  if (!event_id) return { ok: false, error: "missing_event_id" };

  const ts = normalizeTs(ev.ts);
  const target: NotifTarget = ev.target === "user" ? "user" : "all";
  const uidRaw = Number(ev.user_id);
  const uid = Number.isFinite(uidRaw) && uidRaw > 0 ? Math.floor(uidRaw) : null;

  if (target === "user" && !uid) return { ok: false, error: "missing_user_id" };

  try {
    const res = stmtInsertOrIgnore.run({
      event_id, ts, target,
      user_id: target === "user" ? uid : null,
      type: ev.type ?? null,
      level: ev.level ?? null,
      title: ev.title ?? null,
      message: ev.message ?? null,
      toast: asInt(ev.toast),
      meta_json: ev.meta ? JSON.stringify(ev.meta) : null,
    });
    const changes = Number((res as any)?.changes ?? 0);
    return { ok: true, dedup: changes === 0 };
  } catch {
    return { ok: false, error: "db_insert_failed" };
  }
}

export function listNotifAfter(params: {
  afterTs?: number;
  afterId?: string;
  userId?: number;
  limit?: number;
}) {
  const afterTs = Number.isFinite(Number(params.afterTs ?? 0)) ? Math.floor(Number(params.afterTs ?? 0)) : 0;
  const afterId = String(params.afterId ?? "");
  const uid = params.userId ?? 0;
  const limit = Math.min(Math.max(Number(params.limit ?? 200), 1), 500);

  const rows = stmtListAfter.all({ afterTs, afterId, uid, limit });
  const items = rows.map(rowToEvent);
  const nextCursor: NotifCursor = items.length
    ? { ts: items[items.length - 1].ts, id: items[items.length - 1].event_id }
    : { ts: afterTs, id: afterId };

  return { items, nextCursor };
}

export function listNotifFeed(params: {
  userId?: number;
  beforeTs?: number;
  beforeId?: string;
  limit?: number;
}) {
  const uid = params.userId ?? 0;
  const beforeTs = Number.isFinite(Number(params.beforeTs ?? 0)) ? Math.floor(Number(params.beforeTs ?? 0)) : 0;
  const beforeId = String(params.beforeId ?? "\uffff");
  const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 200);

  const rows = stmtFeed.all({ beforeTs, beforeId, uid, limit });
  const items = rows.map(rowToEvent);
  const nextBefore: NotifCursor = items.length
    ? { ts: items[items.length - 1].ts, id: items[items.length - 1].event_id }
    : { ts: beforeTs, id: beforeId };

  return { items, nextBefore };
}

export function listNotifNewsFeed(params: {
  userId?: number;
  beforeTs?: number;
  beforeId?: string;
  limit?: number;
}) {
  const uid = params.userId ?? 0;
  const beforeTs = Number.isFinite(Number(params.beforeTs ?? 0)) ? Math.floor(Number(params.beforeTs ?? 0)) : 0;
  const beforeId = String(params.beforeId ?? "\uffff");
  const limit = Math.min(Math.max(Number(params.limit ?? 10), 1), 200);

  const rows = stmtFeedNews.all({ beforeTs, beforeId, uid, limit });
  const items = rows.map(rowToEvent);
  const nextBefore: NotifCursor = items.length
    ? { ts: items[items.length - 1].ts, id: items[items.length - 1].event_id }
    : { ts: beforeTs, id: beforeId };

  return { items, nextBefore };
}

export function listBroadcasts(params?: { limit?: number }) {
  const limit = Math.min(Math.max(Number(params?.limit ?? 500), 1), 2000);
  const rows = stmtListBroadcastRows.all({ limit }) as Array<{
    event_id: string;
    ts: number;
    type?: string;
    level?: NotifLevel;
    title?: string;
    message?: string;
    hidden?: number;
  }>;

  const map = new Map<string, BroadcastItem>();

  for (const row of rows) {
    const originId = extractBroadcastOriginId(row.event_id);
    if (!originId) continue;

    const existing = map.get(originId);
    if (!existing) {
      map.set(originId, {
        origin_id: originId,
        ts: Number(row.ts) || 0,
        type: row.type ?? undefined,
        level: row.level ?? undefined,
        title: row.title ?? undefined,
        message: row.message ?? undefined,
        copies: 1,
        hidden: Number(row.hidden ?? 0) === 1,
      });
      continue;
    }

    existing.copies += 1;

    if ((Number(row.ts) || 0) > existing.ts) {
      existing.ts = Number(row.ts) || 0;
      existing.type = row.type ?? undefined;
      existing.level = row.level ?? undefined;
      existing.title = row.title ?? undefined;
      existing.message = row.message ?? undefined;
      existing.hidden = Number(row.hidden ?? 0) === 1;
    }
  }

  const items = Array.from(map.values()).sort((a, b) => {
    if (b.ts !== a.ts) return b.ts - a.ts;
    return a.origin_id < b.origin_id ? 1 : -1;
  });

  return { items };
}

export function deleteBroadcastByOriginId(
  originId: string,
): { ok: true; deleted: number } | { ok: false; error: string } {
  const cleanOriginId = String(originId ?? "").trim();
  if (!cleanOriginId) return { ok: false, error: "missing_origin_id" };

  const userPattern = `%:b:${cleanOriginId}`;
  const sysEventId = `sys:broadcast:${cleanOriginId}`;

  try {
    const res = stmtDeleteBroadcastByOriginId.run({ userPattern, sysEventId });
    const deleted = Number((res as any)?.changes ?? 0);
    return { ok: true, deleted };
  } catch {
    return { ok: false, error: "db_delete_failed" };
  }
}

export function hideBroadcastByOriginId(
  originId: string,
  hidden: boolean,
): { ok: true; updated: number } | { ok: false; error: string } {
  const cleanOriginId = String(originId ?? "").trim();
  if (!cleanOriginId) return { ok: false, error: "missing_origin_id" };

  const userPattern = `%:b:${cleanOriginId}`;
  const sysEventId = `sys:broadcast:${cleanOriginId}`;

  try {
    const res = stmtHideBroadcast.run({ hidden: hidden ? 1 : 0, userPattern, sysEventId });
    const updated = Number((res as any)?.changes ?? 0);
    return { ok: true, updated };
  } catch {
    return { ok: false, error: "db_update_failed" };
  }
}

export function updateBroadcastByOriginId(
  originId: string,
  fields: { title?: string; message?: string },
): { ok: true; updated: number } | { ok: false; error: string } {
  const cleanOriginId = String(originId ?? "").trim();
  if (!cleanOriginId) return { ok: false, error: "missing_origin_id" };

  const userPattern = `%:b:${cleanOriginId}`;
  const sysEventId = `sys:broadcast:${cleanOriginId}`;

  try {
    const res = stmtUpdateBroadcast.run({
      title: fields.title ?? null,
      message: fields.message ?? null,
      userPattern,
      sysEventId,
    });
    const updated = Number((res as any)?.changes ?? 0);
    return { ok: true, updated };
  } catch {
    return { ok: false, error: "db_update_failed" };
  }
}

/* =========================================================
   PUSH SUBSCRIPTIONS
   ========================================================= */

linkDb.exec(`
CREATE TABLE IF NOT EXISTS push_subscriptions (
  user_id     INTEGER NOT NULL,
  endpoint    TEXT    NOT NULL,
  p256dh      TEXT    NOT NULL,
  auth        TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user
  ON push_subscriptions(user_id);
`);

const stmtPushSubUpsert = linkDb.prepare(`
  INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, created_at, updated_at)
  VALUES (@user_id, @endpoint, @p256dh, @auth, @now, @now)
  ON CONFLICT(user_id, endpoint) DO UPDATE SET
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    updated_at = excluded.updated_at
`);

const stmtPushSubList = linkDb.prepare(`
  SELECT endpoint, p256dh, auth, updated_at AS ts
  FROM push_subscriptions
  WHERE user_id = @user_id
  ORDER BY updated_at DESC
`);

const stmtPushSubRemoveOne = linkDb.prepare(`
  DELETE FROM push_subscriptions
  WHERE user_id = @user_id AND endpoint = @endpoint
`);

const stmtPushSubRemoveAll = linkDb.prepare(`
  DELETE FROM push_subscriptions
  WHERE user_id = @user_id
`);

export type PushSubscriptionRow = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  ts?: number;
};

export function upsertPushSubscription(params: {
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
}) {
  const uid = Number(params.userId);
  const endpoint = String(params.endpoint ?? "").trim();
  const p256dh = String(params.p256dh ?? "").trim();
  const auth = String(params.auth ?? "").trim();

  if (!Number.isFinite(uid) || uid <= 0) return { ok: false as const, error: "bad_user_id" };
  if (!endpoint) return { ok: false as const, error: "bad_endpoint" };
  if (!p256dh || !auth) return { ok: false as const, error: "bad_keys" };

  const now = Math.floor(Date.now() / 1000);

  try {
    stmtPushSubUpsert.run({ user_id: uid, endpoint, p256dh, auth, now });
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "db_upsert_failed" };
  }
}

export function listPushSubscriptions(userId: number): PushSubscriptionRow[] {
  const uid = Number(userId);
  if (!Number.isFinite(uid) || uid <= 0) return [];

  const rows = stmtPushSubList.all({ user_id: uid }) as any[];
  return rows.map((r) => ({
    endpoint: String(r.endpoint),
    keys: { p256dh: String(r.p256dh), auth: String(r.auth) },
    ts: r.ts == null ? undefined : Number(r.ts),
  }));
}

export function removePushSubscription(params: { userId: number; endpoint?: string | null }) {
  const uid = Number(params.userId);
  if (!Number.isFinite(uid) || uid <= 0) return { ok: false as const, error: "bad_user_id" };

  const endpoint = params.endpoint == null ? null : String(params.endpoint).trim();

  try {
    if (!endpoint) {
      stmtPushSubRemoveAll.run({ user_id: uid });
    } else {
      stmtPushSubRemoveOne.run({ user_id: uid, endpoint });
    }
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: "db_delete_failed" };
  }
}