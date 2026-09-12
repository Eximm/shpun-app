// web/src/shared/support/attachments.ts
// Shared attachment helpers/types for support/partnership (user + admin).

export type TicketAttachment = {
  id: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  deletedAt: string | null;
  deleteReason: string | null;
};

export type PendingFile = {
  id: string;
  file: File;
  previewUrl?: string;
};

export const ATTACHMENT_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf,text/plain";

export function formatBytes(n: number): string {
  const bytes = Number(n) || 0;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function attachmentUrl(id: number): string {
  return `/api/support/attachments/${id}`;
}

export function isImageAttachment(a: TicketAttachment): boolean {
  return String(a.mimeType || "").startsWith("image/");
}

export function buildMessageFormData(text: string, files: File[], extra?: Record<string, string>): FormData {
  const fd = new FormData();
  if (text) fd.append("text", text);
  for (const [k, v] of Object.entries(extra ?? {})) fd.append(k, v);
  for (const file of files) fd.append("files", file, file.name);
  return fd;
}

export function toPendingFiles(files: FileList | File[] | null): PendingFile[] {
  if (!files) return [];
  const list = Array.from(files as ArrayLike<File>);
  return list.map((file) => ({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    file,
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
  }));
}

export function releasePendingFiles(files: PendingFile[]): void {
  for (const f of files) {
    if (f.previewUrl) {
      try { URL.revokeObjectURL(f.previewUrl); } catch { /* ignore */ }
    }
  }
}
