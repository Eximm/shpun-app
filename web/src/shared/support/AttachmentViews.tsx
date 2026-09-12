// web/src/shared/support/AttachmentViews.tsx
// Attachment rendering components (separated from helpers for fast-refresh).

import {
  attachmentUrl,
  formatBytes,
  isImageAttachment,
  type PendingFile,
  type TicketAttachment,
} from "./attachments";

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
