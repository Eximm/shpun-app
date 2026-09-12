// api/src/modules/support/notifyRepo.ts
//
// Support-specific notification state (kept separate from the generic
// `notif_events` table so the ticket repository interface stays clean).
//
//  - support_notify_recipients: TECHNICAL DELIVERY REGISTRY of SHM user ids
//    that should receive in-app support notifications. It is NOT an
//    authorization source: rows are written only after the existing
//    billing/auth admin check (`ensureAdmin` / `/api/me` isAdmin) has already
//    confirmed admin access. Presence here never grants any rights.
//  - support_reads: minimal per-admin unread model (last read message id
//    per ticket). No full CRM read model.

import { linkDb } from "../../shared/linkdb/db.js";

linkDb.exec(`
CREATE TABLE IF NOT EXISTS support_notify_recipients (
  user_id    INTEGER PRIMARY KEY,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS support_reads (
  user_id              INTEGER NOT NULL,
  ticket_id            INTEGER NOT NULL,
  last_read_message_id INTEGER NOT NULL DEFAULT 0,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, ticket_id)
);

CREATE INDEX IF NOT EXISTS idx_support_reads_user
  ON support_reads(user_id);
`);

/**
 * Register an admin/operator SHM user id as a support notification recipient.
 * Callers MUST have already confirmed admin access through the existing
 * billing/auth logic; this registry is delivery-only and never an ACL.
 */
export function recordSupportNotifyRecipient(userId: number): void {
  const uid = Math.trunc(Number(userId));
  if (!Number.isFinite(uid) || uid <= 0) return;
  try {
    linkDb
      .prepare(
        `INSERT INTO support_notify_recipients(user_id, updated_at)
         VALUES(@uid, datetime('now'))
         ON CONFLICT(user_id) DO UPDATE SET updated_at = datetime('now')`
      )
      .run({ uid });
  } catch {
    // best-effort
  }
}

/** Admin delivery recipients registered after a confirmed admin check. */
export function listSupportNotifyRecipients(): number[] {
  const ids = new Set<number>();
  try {
    const rows = linkDb
      .prepare(`SELECT user_id FROM support_notify_recipients`)
      .all() as Array<{ user_id: number }>;
    for (const row of rows) {
      const n = Math.trunc(Number(row?.user_id));
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
  } catch {
    // ignore
  }
  return Array.from(ids);
}

/** Mark a ticket as read for an admin (up to the latest message id). */
export function markSupportTicketRead(userId: number, ticketId: number): void {
  const uid = Math.trunc(Number(userId));
  const tid = Math.trunc(Number(ticketId));
  if (!Number.isFinite(uid) || uid <= 0 || !Number.isFinite(tid) || tid <= 0) return;
  try {
    const row = linkDb
      .prepare(`SELECT COALESCE(MAX(id), 0) AS max_id FROM support_ticket_messages WHERE ticket_id = ?`)
      .get(tid) as { max_id?: number } | undefined;
    const maxId = Math.trunc(Number(row?.max_id ?? 0));
    linkDb
      .prepare(
        `INSERT INTO support_reads(user_id, ticket_id, last_read_message_id, updated_at)
         VALUES(@uid, @tid, @maxId, datetime('now'))
         ON CONFLICT(user_id, ticket_id) DO UPDATE SET
           last_read_message_id = excluded.last_read_message_id,
           updated_at = datetime('now')`
      )
      .run({ uid, tid, maxId });
  } catch {
    // best-effort
  }
}

/** Ticket ids that have at least one unread user message for this admin. */
export function listSupportUnreadTicketIds(userId: number, kind?: string | null): number[] {
  const uid = Math.trunc(Number(userId));
  if (!Number.isFinite(uid) || uid <= 0) return [];
  const useKind = kind === "support" || kind === "partnership";
  try {
    const rows = linkDb
      .prepare(
        `SELECT t.id AS ticket_id
         FROM support_tickets t
         WHERE ${useKind ? "t.kind = @kind AND" : ""} EXISTS (
           SELECT 1
           FROM support_ticket_messages m
           LEFT JOIN support_reads r
             ON r.ticket_id = t.id AND r.user_id = @uid
           WHERE m.ticket_id = t.id
             AND m.author_type = 'user'
             AND m.is_internal_note = 0
             AND (r.last_read_message_id IS NULL OR m.id > r.last_read_message_id)
         )`
      )
      .all(useKind ? { uid, kind } : { uid }) as Array<{ ticket_id: number }>;
    return rows
      .map((r) => Math.trunc(Number(r?.ticket_id)))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}

export function countSupportUnread(userId: number, kind?: string | null): number {
  return listSupportUnreadTicketIds(userId, kind).length;
}

/**
 * Ticket ids where the OWNER has an unread staff reply (non-internal).
 * Reuses the same support_reads table as admin unread, just for the user id.
 */
export function listOwnerUnreadTicketIds(userId: number, kind?: string | null): number[] {
  const uid = Math.trunc(Number(userId));
  if (!Number.isFinite(uid) || uid <= 0) return [];
  const useKind = kind === "support" || kind === "partnership";
  try {
    const rows = linkDb
      .prepare(
        `SELECT t.id AS ticket_id
         FROM support_tickets t
         WHERE ${useKind ? "t.kind = @kind AND" : ""} EXISTS (
           SELECT 1
           FROM support_ticket_messages m
           LEFT JOIN support_reads r
             ON r.ticket_id = t.id AND r.user_id = @uid
           WHERE m.ticket_id = t.id
             AND m.author_type = 'staff'
             AND m.is_internal_note = 0
             AND (r.last_read_message_id IS NULL OR m.id > r.last_read_message_id)
         )`
      )
      .all(useKind ? { uid, kind } : { uid }) as Array<{ ticket_id: number }>;
    return rows
      .map((r) => Math.trunc(Number(r?.ticket_id)))
      .filter((n) => Number.isFinite(n) && n > 0);
  } catch {
    return [];
  }
}
