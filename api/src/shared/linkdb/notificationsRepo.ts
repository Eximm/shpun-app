// api/src/shared/linkdb/notificationsRepo.ts
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

const stmtListAfter = linkDb.prepare(`
  SELECT * FROM notif_events
  WHERE ts > @after
    AND (
      target = 'all'
      OR (target = 'user' AND user_id = @uid AND @uid > 0)
    )
  ORDER BY ts ASC
  LIMIT @limit
`);

const stmtFeed = linkDb.prepare(`
  SELECT * FROM notif_events
  WHERE (@before = 0 OR ts < @before)
    AND (
      target = 'all'
      OR (target = 'user' AND user_id = @uid AND @uid > 0)
    )
  ORDER BY ts DESC
  LIMIT @limit
`);

export function putNotifEvent(ev: NotifEvent): { ok: true; dedup: boolean } | { ok: false; error: string } {
  const id = String(ev?.event_id || "").trim();
  if (!id) return { ok: false, error: "missing_event_id" };

  const ts = Number.isFinite(Number(ev.ts)) ? Number(ev.ts) : Math.floor(Date.now() / 1000);

  const target: NotifTarget = ev.target === "user" ? "user" : "all";
  const user_id = target === "user" ? (ev.user_id ?? null) : null;

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

export function listNotifAfter(params: { afterTs?: number; userId?: number; limit?: number }) {
  const after = Number.isFinite(Number(params.afterTs)) ? Number(params.afterTs) : 0;
  const uid = params.userId ?? 0;
  const limit = Math.min(Math.max(Number(params.limit ?? 200), 1), 500);

  const rows = stmtListAfter.all({ after, uid, limit });
  const items = rows.map(rowToEvent);

  const nextCursor = items.length ? items[items.length - 1].ts : after;
  return { items, nextCursor };
}

export function listNotifFeed(params: { userId?: number; beforeTs?: number; limit?: number }) {
  const uid = params.userId ?? 0;
  const before = Number.isFinite(Number(params.beforeTs)) ? Number(params.beforeTs) : 0;
  const limit = Math.min(Math.max(Number(params.limit ?? 50), 1), 200);

  const rows = stmtFeed.all({ before, uid, limit });
  const items = rows.map(rowToEvent);

  const nextBefore = items.length ? items[items.length - 1].ts : before;
  return { items, nextBefore };
}