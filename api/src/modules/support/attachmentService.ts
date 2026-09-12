// api/src/modules/support/attachmentService.ts
//
// Business logic for support/partnership attachments:
//  - validate + persist uploaded files (never trust filename/content-type)
//  - enrich messages with their attachments
//  - retention cleanup (180 days by default)

import path from "node:path";
import {
  attachmentMaxFileBytes,
  attachmentMaxFiles,
  attachmentMaxMessageBytes,
  attachmentRetentionDays,
  detectDimensions,
  detectMimeType,
  getAttachmentStorage,
  isAllowedMime,
  type AttachmentStorage,
} from "./attachmentStorage.js";
import {
  attachmentsByMessageIds,
  createAttachment,
  deleteAttachmentsForMessage,
  listAttachmentsForMessage,
  listExpiredAttachments,
  markAttachmentDeleted,
} from "./attachmentRepo.js";
import type { SupportAttachment, TicketMessage } from "./types.js";

export class AttachmentError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 400, message?: string) {
    super(message ?? code);
    this.name = "AttachmentError";
    this.code = code;
    this.status = status;
  }
}

export type UploadFile = {
  filename: string;
  mimetype: string; // browser-provided, untrusted
  buffer: Buffer;
  telegramFileId?: string | null;
  telegramFileUniqueId?: string | null;
};

export type CleanupSummary = {
  scanned: number;
  expired: number;
  deleted: number;
  already_missing: number;
  failed: number;
};

/* ─── Message enrichment ─────────────────────────────────────────────────── */

export function enrichMessagesWithAttachments(messages: TicketMessage[]): TicketMessage[] {
  if (messages.length === 0) return messages;
  const map = attachmentsByMessageIds(messages.map((m) => m.id));
  return messages.map((m) => ({ ...m, attachments: map.get(m.id) ?? [] }));
}

/* ─── Save ───────────────────────────────────────────────────────────────── */

function sanitizeOriginalName(name: unknown): string {
  const raw = String(name ?? "").replace(/\\/g, "/");
  const base = raw.split("/").pop() || "file";
  return base.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 200) || "file";
}

/**
 * Validate and persist files for an already created message.
 * Throws AttachmentError on invalid input. On partial failure, removes the
 * files already written so no orphan binaries remain.
 */
export function saveMessageAttachments(input: {
  ticketId: number;
  messageId: number;
  files: UploadFile[];
  storage?: AttachmentStorage;
  telegram?: { fileId?: string | null; fileUniqueId?: string | null };
}): SupportAttachment[] {
  const files = input.files ?? [];
  if (files.length === 0) return [];

  const maxFiles = attachmentMaxFiles();
  if (files.length > maxFiles) {
    throw new AttachmentError("too_many_files", 400, `Можно приложить не больше ${maxFiles} файлов.`);
  }

  const maxFileBytes = attachmentMaxFileBytes();
  const maxTotalBytes = attachmentMaxMessageBytes();

  let total = 0;
  const prepared: Array<{ buffer: Buffer; mime: string; ext: string; originalName: string; width: number | null; height: number | null; telegramFileId: string | null; telegramFileUniqueId: string | null }> = [];

  for (const file of files) {
    const buffer = file.buffer ?? Buffer.alloc(0);
    if (buffer.length === 0) throw new AttachmentError("empty_file", 400, "Пустой файл.");
    if (buffer.length > maxFileBytes) {
      throw new AttachmentError("file_too_large", 413, "Файл больше допустимого размера.");
    }
    total += buffer.length;
    if (total > maxTotalBytes) {
      throw new AttachmentError("message_too_large", 413, "Суммарный размер вложений слишком большой.");
    }

    const detected = detectMimeType(buffer);
    if (!detected || !isAllowedMime(detected.mime)) {
      throw new AttachmentError("unsupported_file_type", 415, "Такой тип файла не поддерживается.");
    }

    const dims = detectDimensions(buffer, detected.mime);
    prepared.push({
      buffer,
      mime: detected.mime,
      ext: detected.ext,
      originalName: sanitizeOriginalName(file.filename),
      width: dims.width,
      height: dims.height,
      telegramFileId: file.telegramFileId ?? null,
      telegramFileUniqueId: file.telegramFileUniqueId ?? null,
    });
  }

  const storage = input.storage ?? getAttachmentStorage();
  const created: SupportAttachment[] = [];
  const savedKeys: string[] = [];

  try {
    for (const item of prepared) {
      const stored = storage.save(item.buffer, item.ext);
      savedKeys.push(stored.storageKey);
      created.push(
        createAttachment({
          messageId: input.messageId,
          ticketId: input.ticketId,
          storageProvider: stored.storageProvider,
          storageKey: stored.storageKey,
          originalName: item.originalName,
          mimeType: item.mime,
          sizeBytes: item.buffer.length,
          width: item.width,
          height: item.height,
          telegramFileId: item.telegramFileId ?? input.telegram?.fileId ?? null,
          telegramFileUniqueId: item.telegramFileUniqueId ?? input.telegram?.fileUniqueId ?? null,
        })
      );
    }
    return created;
  } catch (error) {
    for (const key of savedKeys) {
      try { storage.remove(key); } catch { /* best-effort */ }
    }
    deleteAttachmentsForMessage(input.messageId);
    throw error;
  }
}

/** Roll back attachments of a message (used when the whole message must be undone). */
export function removeMessageAttachments(messageId: number, storage: AttachmentStorage = getAttachmentStorage()): void {
  for (const a of listAttachmentsForMessage(messageId)) {
    try { storage.remove(a.storageKey); } catch { /* best-effort */ }
  }
  deleteAttachmentsForMessage(messageId);
}

/* ─── Retention cleanup ──────────────────────────────────────────────────── */

function isoCutoff(days: number, now: Date): string {
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().replace("T", " ").slice(0, 19);
}

export function cleanupExpiredAttachments(options: {
  retentionDays?: number;
  now?: Date;
  limit?: number;
  storage?: AttachmentStorage;
} = {}): CleanupSummary {
  const days = options.retentionDays ?? attachmentRetentionDays();
  const now = options.now ?? new Date();
  const storage = options.storage ?? getAttachmentStorage();

  const expiredItems = listExpiredAttachments(isoCutoff(days, now), options.limit ?? 500);
  const summary: CleanupSummary = {
    scanned: expiredItems.length,
    expired: 0,
    deleted: 0,
    already_missing: 0,
    failed: 0,
  };

  for (const item of expiredItems) {
    summary.expired++;
    try {
      const result = item.storageKey ? storage.remove(item.storageKey) : "missing";
      if (result === "deleted") {
        summary.deleted++;
        markAttachmentDeleted(item.id, "retention");
      } else if (result === "missing") {
        summary.already_missing++;
        markAttachmentDeleted(item.id, "retention");
      } else {
        // Deletion failed: keep metadata active so the next run retries.
        summary.failed++;
      }
    } catch {
      summary.failed++;
    }
  }

  return summary;
}
