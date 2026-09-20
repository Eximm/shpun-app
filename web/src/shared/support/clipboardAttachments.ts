// web/src/shared/support/clipboardAttachments.ts
//
// Clipboard image extraction for the support/partnership composers.
//
// Pure helpers (no React) so they can be unit-tested. Uses the paste event's
// `clipboardData` only — never `navigator.clipboard.read()` (no permission
// prompt, no background reads).

import { ATTACHMENT_MIME_TYPES } from "./attachments";

// Extensions are only a display/name concern; the backend sniffs real content.
const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

// Clipboard accepts exactly the supported image types from the shared
// allowlist (no separate/drifting set). GIF is not in the backend allowlist, so
// it is not accepted here either.
const CLIPBOARD_IMAGE_TYPES = new Set<string>(
  ATTACHMENT_MIME_TYPES.filter((type) => type.startsWith("image/") && IMAGE_EXT[type])
);

function isClipboardImage(type: unknown): boolean {
  return CLIPBOARD_IMAGE_TYPES.has(String(type || "").toLowerCase());
}

function imageExtension(type: string, name: string): string {
  const mapped = IMAGE_EXT[String(type || "").toLowerCase()];
  if (mapped) return mapped;
  const fromName = String(name || "").split(".").pop()?.toLowerCase() || "";
  return /^[a-z0-9]{2,5}$/.test(fromName) ? fromName : "png";
}

/** Locale-independent, filesystem-safe screenshot name. */
export function screenshotFileName(date: Date, ext = "png"): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
  return `screenshot-${stamp}.${ext}`;
}

const SAFE_NAME_RE = /^[\w .\-()]+$/;

function isUsableName(name: string): boolean {
  const n = String(name || "").trim();
  return n.length > 0 && n.length <= 100 && n.includes(".") && SAFE_NAME_RE.test(n);
}

/**
 * Extract image files from a paste event.
 * Returns [] when the clipboard has no image (plain text paste is left intact).
 */
export function extractClipboardImageFiles(event: {
  clipboardData?: DataTransfer | null;
}): File[] {
  const dt = event?.clipboardData;
  if (!dt) return [];

  const out: File[] = [];
  const items = dt.items ? Array.from(dt.items) : [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    if (!isClipboardImage(item.type)) continue;
    const blob = item.getAsFile();
    if (!blob) continue;
    out.push(toNamedImage(blob));
  }

  // Some browsers only populate `dt.files`.
  if (out.length === 0 && dt.files && dt.files.length) {
    for (const file of Array.from(dt.files)) {
      if (isClipboardImage(file.type)) out.push(toNamedImage(file));
    }
  }

  return out;
}

function toNamedImage(blob: File): File {
  const type = String(blob.type || "image/png");
  const ext = imageExtension(type, blob.name);
  const name = isUsableName(blob.name) ? blob.name : screenshotFileName(new Date(), ext);
  return new File([blob], name, { type, lastModified: Date.now() });
}