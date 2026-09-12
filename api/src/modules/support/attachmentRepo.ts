// api/src/modules/support/attachmentRepo.ts
//
// SQLite storage for support/partnership message attachments.
// Binaries are NOT stored here — only metadata + storage key.

import { linkDb } from "../../shared/linkdb/db.js";
import type { SupportAttachment } from "./types.js";

linkDb.exec(`
CREATE TABLE IF NOT EXISTS support_attachments (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id               INTEGER NOT NULL,
  ticket_id                INTEGER NOT NULL,
  storage_provider         TEXT NOT NULL DEFAULT 'local',
  storage_key              TEXT NOT NULL,
  original_name            TEXT NOT NULL DEFAULT '',
  mime_type                TEXT NOT NULL,
  size_bytes               INTEGER NOT NULL DEFAULT 0,
  width                    INTEGER,
  height                   INTEGER,
  telegram_file_id         TEXT,
  telegram_file_unique_id  TEXT,
  created_at               TEXT NOT NULL DEFAULT (datetime('now')),
  deleted_at               TEXT,
  delete_reason            TEXT
);

CREATE INDEX IF NOT EXISTS idx_support_attachments_message
  ON support_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_support_attachments_ticket
  ON support_attachments(ticket_id);
CREATE INDEX IF NOT EXISTS idx_support_attachments_active_created
  ON support_attachments(created_at) WHERE deleted_at IS NULL;
`);

type AttachmentRow = {
  id: number;
  message_id: number;
  ticket_id: number;
  storage_provider: string;
  storage_key: string;
  original_name: string;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  telegram_file_id: string | null;
  telegram_file_unique_id: string | null;
  created_at: string;
  deleted_at: string | null;
  delete_reason: string | null;
};

function mapAttachment(row: AttachmentRow): SupportAttachment {
  return {
    id: Number(row.id),
    messageId: Number(row.message_id),
    ticketId: Number(row.ticket_id),
    storageProvider: String(row.storage_provider || "local"),
    storageKey: String(row.storage_key),
    originalName: String(row.original_name ?? ""),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes ?? 0),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    telegramFileId: row.telegram_file_id ?? null,
    createdAt: String(row.created_at),
    deletedAt: row.deleted_at ?? null,
    deleteReason: row.delete_reason ?? null,
  };
}

export type CreateAttachmentInput = {
  messageId: number;
  ticketId: number;
  storageProvider: string;
  storageKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  width?: number | null;
  height?: number | null;
  telegramFileId?: string | null;
  telegramFileUniqueId?: string | null;
};

const stmtInsert = linkDb.prepare(`
  INSERT INTO support_attachments (
    message_id, ticket_id, storage_provider, storage_key, original_name,
    mime_type, size_bytes, width, height, telegram_file_id, telegram_file_unique_id
  ) VALUES (
    @message_id, @ticket_id, @storage_provider, @storage_key, @original_name,
    @mime_type, @size_bytes, @width, @height, @telegram_file_id, @telegram_file_unique_id
  )
`);

export function createAttachment(input: CreateAttachmentInput): SupportAttachment {
  const info = stmtInsert.run({
    message_id: input.messageId,
    ticket_id: input.ticketId,
    storage_provider: input.storageProvider,
    storage_key: input.storageKey,
    original_name: input.originalName.slice(0, 255),
    mime_type: input.mimeType,
    size_bytes: input.sizeBytes,
    width: input.width ?? null,
    height: input.height ?? null,
    telegram_file_id: input.telegramFileId ?? null,
    telegram_file_unique_id: input.telegramFileUniqueId ?? null,
  });
  return getAttachment(Number(info.lastInsertRowid)) as SupportAttachment;
}

export function getAttachment(id: number): SupportAttachment | null {
  const n = Number(id);
  if (!Number.isFinite(n) || n <= 0) return null;
  const row = linkDb.prepare(`SELECT * FROM support_attachments WHERE id = ?`).get(Math.trunc(n)) as
    | AttachmentRow
    | undefined;
  return row ? mapAttachment(row) : null;
}

export function listAttachmentsForMessage(messageId: number): SupportAttachment[] {
  const rows = linkDb
    .prepare(`SELECT * FROM support_attachments WHERE message_id = ? ORDER BY id ASC`)
    .all(messageId) as AttachmentRow[];
  return rows.map(mapAttachment);
}

/** Batch-load attachments for a set of messages, grouped by messageId. */
export function attachmentsByMessageIds(messageIds: number[]): Map<number, SupportAttachment[]> {
  const map = new Map<number, SupportAttachment[]>();
  const ids = messageIds.filter((n) => Number.isFinite(n) && n > 0);
  if (ids.length === 0) return map;
  const placeholders = ids.map(() => "?").join(", ");
  const rows = linkDb
    .prepare(`SELECT * FROM support_attachments WHERE message_id IN (${placeholders}) ORDER BY id ASC`)
    .all(...ids) as AttachmentRow[];
  for (const row of rows) {
    const item = mapAttachment(row);
    const arr = map.get(item.messageId) ?? [];
    arr.push(item);
    map.set(item.messageId, arr);
  }
  return map;
}

export function hasAttachmentsForMessage(messageId: number): boolean {
  const row = linkDb
    .prepare(`SELECT 1 AS x FROM support_attachments WHERE message_id = ? LIMIT 1`)
    .get(messageId) as { x?: number } | undefined;
  return Boolean(row?.x);
}

/** Active (not yet deleted) attachments older than the cutoff, oldest first. */
export function listExpiredAttachments(cutoffIso: string, limit = 500): SupportAttachment[] {
  const safeLimit = Math.min(Math.max(Math.trunc(Number(limit) || 500), 1), 5000);
  const rows = linkDb
    .prepare(
      `SELECT * FROM support_attachments
       WHERE deleted_at IS NULL AND datetime(created_at) <= datetime(?)
       ORDER BY datetime(created_at) ASC, id ASC
       LIMIT ?`
    )
    .all(cutoffIso, safeLimit) as AttachmentRow[];
  return rows.map(mapAttachment);
}

export function markAttachmentDeleted(id: number, reason: string): boolean {
  const info = linkDb
    .prepare(
      `UPDATE support_attachments
       SET deleted_at = COALESCE(deleted_at, datetime('now')), delete_reason = ?
       WHERE id = ? AND deleted_at IS NULL`
    )
    .run(String(reason || "retention").slice(0, 40), Math.trunc(Number(id)));
  return Number(info.changes) > 0;
}

export function deleteAttachmentsForMessage(messageId: number): void {
  linkDb.prepare(`DELETE FROM support_attachments WHERE message_id = ?`).run(messageId);
}
