// web/src/shared/support/attachments.tsx
//
// Shared attachment UI for support/partnership (user + admin).
// Downloads go through the authenticated endpoint /api/support/attachments/:id.

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

/* ─── Display ────────────────────────────────────────────────────────────── */

export function AttachmentView({ attachment }: { attachment: TicketAttachment }) {
  if (attachment.deletedAt) {
    return (
      <div className="attachItem attachItem--expired">
        <span className="attachItem__icon">📎</span>
        <span className="attachItem__main">
          <span className="attachItem__name">{attachment.originalName || "Файл"}</span>
          <span className="attachItem__note">Удалено по истечении срока хранения.</span>
        </span>
      </div>
    );
  }

  if (isImageAttachment(attachment)) {
    return (
      <a className="attachImage" href={attachmentUrl(attachment.id)} target="_blank" rel="noopener noreferrer">
        <img src={attachmentUrl(attachment.id)} alt={attachment.originalName || "Вложение"} loading="lazy" />
      </a>
    );
  }

  return (
    <a className="attachItem" href={attachmentUrl(attachment.id)} target="_blank" rel="noopener noreferrer">
      <span className="attachItem__icon">📄</span>
      <span className="attachItem__main">
        <span className="attachItem__name">{attachment.originalName || "Файл"}</span>
        <span className="attachItem__size">{formatBytes(attachment.sizeBytes)}</span>
      </span>
    </a>
  );
}

export function AttachmentList({ attachments }: { attachments?: TicketAttachment[] | null }) {
  if (!attachments || attachments.length === 0) return null;
  return (
    <div className="attachList">
      {attachments.map((a) => (
        <AttachmentView key={a.id} attachment={a} />
      ))}
    </div>
  );
}

export function PendingFiles({ files, onRemove, disabled }: { files: PendingFile[]; onRemove: (id: string) => void; disabled?: boolean }) {
  if (files.length === 0) return null;
  return (
    <div className="attachPending">
      {files.map((f) => (
        <div key={f.id} className="attachPending__item">
          {f.previewUrl ? (
            <img className="attachPending__thumb" src={f.previewUrl} alt="" />
          ) : (
            <span className="attachPending__icon">📄</span>
          )}
          <span className="attachPending__main">
            <span className="attachPending__name">{f.file.name}</span>
            <span className="attachPending__size">{formatBytes(f.file.size)}</span>
          </span>
          <button
            type="button"
            className="attachPending__remove"
            aria-label="Убрать файл"
            disabled={disabled}
            onClick={() => onRemove(f.id)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
