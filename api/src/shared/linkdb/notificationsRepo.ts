import { linkDb } from "./db.js";

export type NotifTarget = "all" | "user";
export type NotifLevel = "info" | "success" | "error";

export type NotifEvent = {
  event_id: string;
  ts: number; // unix seconds
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

function asInt(v: any) {
  return v ? 1 : 0;
}

function parseJson(s: any) {
  if (!s) return undefined;
  try {
    return JSON.parse(String(s));
  } catch {
    return undefined;
  }
}

function normalizeTs(input: any): number {
  const raw = Number(input);
  let ts = Number.isFinite(raw) ? raw : Math.floor(Date.now() / 1000);

  // if milliseconds (>= year 2286 in seconds, but practical threshold)
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
`);

// ===== statements =====
const stmtInsert = linkDb.prepare(`
  INSERT OR IGNORE INTO notif_events
    (event_id, ts, target, user_id, type, level, title, message, toast, meta_json)
  VALUES
    (@event_id, @ts, @target, @user_id, @type, @level, @title, @message, @toast, @meta_json)
`);

// Cursor = (ts, event_id) to avoid “missing” events in same second
const stmtListAfter = linkDb.prepare(`
  SELECT * FROM notif_events
  WHERE
    (
      ts > @afterTs
      OR (ts = @afterTs AND event_id > @afterId)
    )
    AND (
      target = 'all'
      OR (target = 'user' AND user_id = @uid AND @uid > 0)
    )
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
      OR (target = 'user' AND user_id = @uid AND @uid > 0)
    )
  ORDER BY ts DESC, event_id DESC
  LIMIT @limit
`);

export function putNotifEvent(
  ev: NotifEvent
): { ok: true; dedup: boolean } | { ok: false; error: string } {
  const id = String(ev?.event_id ?? "").trim();
  if (!id) return { ok: false, error: "missing_event_id" };

  const ts = normalizeTs(ev.ts);

  const target: NotifTarget = ev.target === "user" ? "user" : "all";

  let user_id: number | null = null;
  if (target === "user") {
    const uid = Number(ev.user_id);
    if (!Number.isFinite(uid) || uid <= 0) {
      return { ok: false, error: "missing_user_id" };
    }
    user_id = uid;
  }

  const info = stmtInsert.run({
    event_id: id,
    ts,
    target,
    user_id,
    type: ev.type ?? null,
    level: ev.level ?? null,
    title: ev.title ?? null,
    message: ev.message ?? null,
    toast: asInt(ev.toast),
    meta_json: ev.meta ? JSON.stringify(ev.meta) : null,
  });

  const dedup = info.changes === 0;
  return { ok: true, dedup };
}

export function listNotifAfter(params: {
  afterTs?: number;
  afterId?: string;
  userId?: number;
  limit?: number;
}) {
  const afterTs = normalizeTs(params.afterTs ?? 0);
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

  // beforeTs=0 means "latest", keep it 0 (do NOT normalize to now)
  const beforeTsRaw = Number(params.beforeTs ?? 0);
  const beforeTs = Number.isFinite(beforeTsRaw) ? Math.floor(beforeTsRaw) : 0;

  const beforeId = String(params.beforeId ?? "\uffff");
  const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 200);

  const rows = stmtFeed.all({ beforeTs, beforeId, uid, limit });
  const items = rows.map(rowToEvent);

  const nextBefore: NotifCursor = items.length
    ? { ts: items[items.length - 1].ts, id: items[items.length - 1].event_id }
    : { ts: beforeTs, id: beforeId };

  return { items, nextBefore };
}