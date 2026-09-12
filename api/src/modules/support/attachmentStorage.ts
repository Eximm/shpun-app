// api/src/modules/support/attachmentStorage.ts
//
// Local persistent storage for support/partnership attachments + MIME sniffing.
//
// Files live under DATA_DIR/support-attachments (already a persistent Docker
// bind mount: /opt/shpun-app/data -> /data). The storage layer is abstracted so
// a future object-storage provider can be plugged in without touching routes.
//
// Original filenames are NEVER used as filesystem paths.

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_MAX_FILE_MB = 10;
export const DEFAULT_MAX_MESSAGE_MB = 25;
export const DEFAULT_MAX_FILES = 5;
export const DEFAULT_RETENTION_DAYS = 180;

function envInt(name: string, def: number): number {
  const n = Number(String(process.env[name] ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : def;
}

export function attachmentMaxFileBytes(): number {
  return envInt("SUPPORT_ATTACHMENT_MAX_FILE_MB", DEFAULT_MAX_FILE_MB) * 1024 * 1024;
}
export function attachmentMaxMessageBytes(): number {
  return envInt("SUPPORT_ATTACHMENT_MAX_MESSAGE_MB", DEFAULT_MAX_MESSAGE_MB) * 1024 * 1024;
}
export function attachmentMaxFiles(): number {
  return envInt("SUPPORT_ATTACHMENT_MAX_FILES", DEFAULT_MAX_FILES);
}
export function attachmentRetentionDays(): number {
  return envInt("SUPPORT_ATTACHMENT_RETENTION_DAYS", DEFAULT_RETENTION_DAYS);
}

/* ─── MIME sniffing (never trust filename / browser content-type) ────────── */

export type DetectedMime = { mime: string; ext: string; inline: boolean };

const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
]);

function startsWith(buf: Buffer, sig: number[], offset = 0): boolean {
  if (buf.length < offset + sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[offset + i] !== sig[i]) return false;
  return true;
}

function isProbablyUtf8Text(buf: Buffer): boolean {
  if (buf.length === 0) return false;
  if (buf.includes(0)) return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
    // No control chars except tab/newline/carriage return.
    return !/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(text);
  } catch {
    return false;
  }
}

export function detectMimeType(buf: Buffer): DetectedMime | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return { mime: "image/jpeg", ext: "jpg", inline: true };
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { mime: "image/png", ext: "png", inline: true };
  }
  if (startsWith(buf, [0x52, 0x49, 0x46, 0x46]) && startsWith(buf, [0x57, 0x45, 0x42, 0x50], 8)) {
    return { mime: "image/webp", ext: "webp", inline: true };
  }
  if (startsWith(buf, [0x25, 0x50, 0x44, 0x46])) {
    return { mime: "application/pdf", ext: "pdf", inline: true };
  }
  // ISO-BMFF: ....ftyp<brand>
  if (startsWith(buf, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = buf.slice(8, 12).toString("ascii").toLowerCase();
    if (brand.startsWith("heic") || brand.startsWith("heix") || brand.startsWith("heif") || brand.startsWith("mif1")) {
      return { mime: "image/heic", ext: "heic", inline: true };
    }
  }
  if (isProbablyUtf8Text(buf)) return { mime: "text/plain", ext: "txt", inline: false };
  return null;
}

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIME.has(mime);
}

/** PNG only: width/height from IHDR. Others stay null (nullable by design). */
export function detectDimensions(buf: Buffer, mime: string): { width: number | null; height: number | null } {
  if (mime === "image/png" && buf.length >= 24 && startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  return { width: null, height: null };
}

/* ─── Storage abstraction ────────────────────────────────────────────────── */

export type StoredObject = { storageProvider: string; storageKey: string };

export interface AttachmentStorage {
  save(buffer: Buffer, ext: string): StoredObject;
  read(storageKey: string): Buffer | null;
  exists(storageKey: string): boolean;
  remove(storageKey: string): "deleted" | "missing" | "failed";
  /** best-effort listing for orphan cleanup */
  listKeys(): string[];
}

function attachmentsRoot(): string {
  const dataDir = process.env.DATA_DIR || path.join(process.cwd(), "data");
  return process.env.SUPPORT_ATTACHMENTS_DIR || path.join(dataDir, "support-attachments");
}

function safeAbsPath(root: string, key: string): string | null {
  const resolved = path.resolve(root, key);
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  return resolved.startsWith(rootWithSep) ? resolved : null;
}

export class LocalAttachmentStorage implements AttachmentStorage {
  private root: string;

  constructor(root = attachmentsRoot()) {
    this.root = root;
  }

  save(buffer: Buffer, ext: string): StoredObject {
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
    const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : "bin";
    const key = `${yyyy}/${mm}/${randomUUID()}.${safeExt}`;
    const abs = safeAbsPath(this.root, key);
    if (!abs) throw new Error("attachment_path_rejected");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buffer);
    return { storageProvider: "local", storageKey: key };
  }

  read(storageKey: string): Buffer | null {
    const abs = safeAbsPath(this.root, storageKey);
    if (!abs) return null;
    try {
      return fs.readFileSync(abs);
    } catch {
      return null;
    }
  }

  exists(storageKey: string): boolean {
    const abs = safeAbsPath(this.root, storageKey);
    if (!abs) return false;
    try {
      return fs.existsSync(abs);
    } catch {
      return false;
    }
  }

  remove(storageKey: string): "deleted" | "missing" | "failed" {
    const abs = safeAbsPath(this.root, storageKey);
    if (!abs) return "failed";
    try {
      fs.unlinkSync(abs);
      return "deleted";
    } catch (error: any) {
      if (error?.code === "ENOENT") return "missing";
      return "failed";
    }
  }

  listKeys(): string[] {
    const out: string[] = [];
    const walk = (dir: string, prefix: string) => {
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
        else if (entry.isFile()) out.push(rel);
      }
    };
    walk(this.root, "");
    return out;
  }
}

let activeStorage: AttachmentStorage = new LocalAttachmentStorage();

export function getAttachmentStorage(): AttachmentStorage {
  return activeStorage;
}

/** Override storage (tests / future provider). Null restores local default. */
export function setAttachmentStorage(storage: AttachmentStorage | null): void {
  activeStorage = storage ?? new LocalAttachmentStorage();
}
