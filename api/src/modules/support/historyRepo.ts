// api/src/modules/support/historyRepo.ts
//
// User-centric support history: compensations ledger + internal user notes.
// Both are admin-only internal data and are never exposed by the public
// support API. Old tickets are picked up automatically from support_tickets.

import { linkDb } from "../../shared/linkdb/db.js";

/* ─── Schema (additive) ──────────────────────────────────────────────────── */

linkDb.exec(`
CREATE TABLE IF NOT EXISTS support_compensations (
  id                     INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id                INTEGER NOT NULL,
  ticket_id              INTEGER,
  service_id             INTEGER,
  service_title_snapshot TEXT,
  kind                   TEXT NOT NULL DEFAULT 'days',
  amount_days            INTEGER,
  amount_minor           INTEGER,
  currency               TEXT,
  description            TEXT NOT NULL DEFAULT '',
  reason                 TEXT,
  external_reference     TEXT,
  created_by             INTEGER,
  created_at             TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_support_compensations_user
  ON support_compensations(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS support_user_notes (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  text       TEXT NOT NULL,
  created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT,
  is_pinned  INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_support_user_notes_user
  ON support_user_notes(user_id, is_pinned DESC, created_at DESC);
`);

/* ─── Types ──────────────────────────────────────────────────────────────── */

export type SupportCompensation = {
  id: number;
  userId: number;
  ticketId: number | null;
  serviceId: number | null;
  serviceTitleSnapshot: string | null;
  kind: string;
  amountDays: number | null;
  amountMinor: number | null;
  currency: string | null;
  description: string;
  reason: string | null;
  externalReference: string | null;
  createdBy: number | null;
  createdAt: string;
};

export type SupportUserNote = {
  id: number;
  userId: number;
  text: string;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string | null;
  isPinned: boolean;
};

export type UserHistoryTicket = {
  id: number;
  userId: number;
  publicNo: string;
  kind: string;
  status: string;
  priority: string;
  categoryKey: string;
  subject: string | null;
  serviceId: number | null;
  userServiceId: number | null;
  serviceCategory: string | null;
  serviceTitle: string | null;
  userLoginSnapshot: string | null;
  displayNameSnapshot: string | null;
  balanceSnapshot: number | null;
  createdAt: string;
  updatedAt: string;
  lastMessageAt: string;
  closedAt: string | null;
  messageCount: number;
};

/* ─── Mapping ────────────────────────────────────────────────────────────── */

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function mapCompensation(row: any): SupportCompensation {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    ticketId: toNullableNumber(row.ticket_id),
    serviceId: toNullableNumber(row.service_id),
    serviceTitleSnapshot: row.service_title_snapshot ?? null,
    kind: String(row.kind ?? "days"),
    amountDays: toNullableNumber(row.amount_days),
    amountMinor: toNullableNumber(row.amount_minor),
    currency: row.currency ?? null,
    description: String(row.description ?? ""),
    reason: row.reason ?? null,
    externalReference: row.external_reference ?? null,
    createdBy: toNullableNumber(row.created_by),
    createdAt: String(row.created_at ?? ""),
  };
}

function mapNote(row: any): SupportUserNote {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    text: String(row.text ?? ""),
    createdBy: toNullableNumber(row.created_by),
    createdAt: String(row.created_at ?? ""),
    updatedAt: row.updated_at ?? null,
    isPinned: Number(row.is_pinned ?? 0) === 1,
  };
}

function serviceTitleFromSnapshot(raw: unknown): string | null {
  try {
    const parsed = JSON.parse(String(raw ?? "null"));
    if (parsed && typeof parsed === "object") {
      const name = (parsed as any).name;
      if (typeof name === "string" && name.trim()) return name.trim();
    }
  } catch {
    /* ignore malformed snapshot */
  }
  return null;
}

function mapHistoryTicket(row: any): UserHistoryTicket {
  return {
    id: Number(row.id),
    userId: Number(row.user_id),
    publicNo: String(row.public_no ?? ""),
    kind: String(row.kind ?? "support"),
    status: String(row.status ?? "open"),
    priority: String(row.priority ?? "normal"),
    categoryKey: String(row.category_key ?? ""),
    subject: row.subject ?? null,
    serviceId: toNullableNumber(row.service_id),
    userServiceId: toNullableNumber(row.user_service_id),
    serviceCategory: row.service_category ?? null,
    serviceTitle: serviceTitleFromSnapshot(row.service_snapshot_json),
    userLoginSnapshot: row.user_login_snapshot ?? null,
    displayNameSnapshot: row.display_name_snapshot ?? null,
    balanceSnapshot: row.balance_snapshot == null ? null : Number(row.balance_snapshot),
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
    lastMessageAt: String(row.last_message_at ?? ""),
    closedAt: row.closed_at ?? null,
    messageCount: Number(row.message_count ?? 0) || 0,
  };
}

/* ─── Compensations ──────────────────────────────────────────────────────── */

export function listCompensations(userId: unknown): SupportCompensation[] {
  const uid = Math.trunc(Number(userId));
  if (!Number.isFinite(uid) || uid <= 0) return [];
  const rows = linkDb.prepare(`
    SELECT * FROM support_compensations
    WHERE user_id = ?
    ORDER BY datetime(created_at) DESC, id DESC
  `).all(uid) as any[];
  return rows.map(mapCompensation);
}

export type CreateCompensationInput = {
  userId: number;
  ticketId?: number | null;
  serviceId?: number | null;
  serviceTitleSnapshot?: string | null;
  kind?: string;
  amountDays?: number | null;
  amountMinor?: number | null;
  currency?: string | null;
  description: string;
  reason?: string | null;
  externalReference?: string | null;
  createdBy?: number | null;
};

export function createCompensation(input: CreateCompensationInput): SupportCompensation {
  const uid = Math.trunc(Number(input.userId));
  if (!Number.isFinite(uid) || uid <= 0) throw new Error("invalid_user");
  const info = linkDb.prepare(`
    INSERT INTO support_compensations (
      user_id, ticket_id, service_id, service_title_snapshot, kind,
      amount_days, amount_minor, currency, description, reason, external_reference, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    uid,
    input.ticketId ?? null,
    input.serviceId ?? null,
    input.serviceTitleSnapshot ?? null,
    String(input.kind ?? "days"),
    input.amountDays ?? null,
    input.amountMinor ?? null,
    input.currency ?? null,
    String(input.description ?? ""),
    input.reason ?? null,
    input.externalReference ?? null,
    input.createdBy ?? null,
  );
  const row = linkDb.prepare(`SELECT * FROM support_compensations WHERE id = ?`).get(Number(info.lastInsertRowid)) as any;
  return mapCompensation(row);
}

/* ─── User notes ─────────────────────────────────────────────────────────── */

export function listUserNotes(userId: unknown): SupportUserNote[] {
  const uid = Math.trunc(Number(userId));
  if (!Number.isFinite(uid) || uid <= 0) return [];
  const rows = linkDb.prepare(`
    SELECT * FROM support_user_notes
    WHERE user_id = ?
    ORDER BY is_pinned DESC, datetime(created_at) DESC, id DESC
  `).all(uid) as any[];
  return rows.map(mapNote);
}

export function createUserNote(input: { userId: number; text: string; createdBy?: number | null; isPinned?: boolean }): SupportUserNote {
  const uid = Math.trunc(Number(input.userId));
  if (!Number.isFinite(uid) || uid <= 0) throw new Error("invalid_user");
  const text = String(input.text ?? "").trim();
  if (!text) throw new Error("note_text_required");
  const info = linkDb.prepare(`
    INSERT INTO support_user_notes (user_id, text, created_by, is_pinned)
    VALUES (?, ?, ?, ?)
  `).run(uid, text.slice(0, 4000), input.createdBy ?? null, input.isPinned ? 1 : 0);
  const row = linkDb.prepare(`SELECT * FROM support_user_notes WHERE id = ?`).get(Number(info.lastInsertRowid)) as any;
  return mapNote(row);
}

export function updateUserNote(
  noteId: unknown,
  patch: { text?: unknown; isPinned?: unknown },
): SupportUserNote | null {
  const id = Math.trunc(Number(noteId));
  if (!Number.isFinite(id) || id <= 0) return null;
  const sets: string[] = ["updated_at = datetime('now')"];
  const params: any[] = [];
  if (patch.text !== undefined) {
    const text = String(patch.text ?? "").trim();
    if (!text) throw new Error("note_text_required");
    sets.push("text = ?");
    params.push(text.slice(0, 4000));
  }
  if (patch.isPinned !== undefined) {
    sets.push("is_pinned = ?");
    params.push(patch.isPinned ? 1 : 0);
  }
  params.push(id);
  linkDb.prepare(`UPDATE support_user_notes SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  const row = linkDb.prepare(`SELECT * FROM support_user_notes WHERE id = ?`).get(id) as any;
  return row ? mapNote(row) : null;
}

export function deleteUserNote(noteId: unknown): boolean {
  const id = Math.trunc(Number(noteId));
  if (!Number.isFinite(id) || id <= 0) return false;
  return linkDb.prepare(`DELETE FROM support_user_notes WHERE id = ?`).run(id).changes > 0;
}

/* ─── Tickets for a user (all services, all kinds) ───────────────────────── */

export function listUserHistoryTickets(userId: unknown): UserHistoryTicket[] {
  const uid = Math.trunc(Number(userId));
  if (!Number.isFinite(uid) || uid <= 0) return [];
  const rows = linkDb.prepare(`
    SELECT t.*,
      (SELECT COUNT(*) FROM support_ticket_messages m
        WHERE m.ticket_id = t.id AND m.deleted_at IS NULL) AS message_count
    FROM support_tickets t
    WHERE t.user_id = ?
    ORDER BY datetime(t.last_message_at) DESC, t.id DESC
  `).all(uid) as any[];
  return rows.map(mapHistoryTicket);
}
