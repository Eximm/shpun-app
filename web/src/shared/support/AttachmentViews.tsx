// web/src/shared/support/AttachmentViews.tsx
// Attachment rendering components (separated from helpers for fast-refresh).
//
// Previewable attachments (images, PDF) open in an in-app viewer/lightbox so
// that neither desktop nor mobile ever leaves the current SPA:
//   - no target="_blank", no window.open, no location/href navigation
//   - closing restores the exact thread + scroll position
// Generic files download in place, keeping the SPA untouched.

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../i18n";
import {
  attachmentUrl,
  isImageAttachment,
  isPdfAttachment,
  type PendingFile,
  type TicketAttachment,
} from "./attachments";

function AttachmentViewer({ attachment, onClose }: { attachment: TicketAttachment; onClose: () => void }) {
  const { t } = useI18n();
  const url = attachmentUrl(attachment.id);
  const isImage = isImageAttachment(attachment);
  const name = attachment.originalName || t("support.attachment.file");

  // Keep the latest onClose without re-running the lock effect on every render
  // (an unstable onClose re-locks/unlocks scroll and can jump the viewport).
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevBodyOverflow = document.body.style.overflow;
    const prevHtmlOverflow = document.documentElement.style.overflow;

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";

    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevBodyOverflow;
      document.documentElement.style.overflow = prevHtmlOverflow;
      document.removeEventListener("keydown", onKeyDown);

      // Restore the exact viewport the user had before opening the viewer and
      // return focus to the trigger without scrolling it into view.
      const restore = () => {
        if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
          window.scrollTo({ left: scrollX, top: scrollY, behavior: "auto" });
        }
      };
      restore();
      window.requestAnimationFrame(() => {
        restore();
        try {
          previouslyFocused?.focus?.({ preventScroll: true });
        } catch {
          /* focus restore is best-effort */
        }
      });
    };
  }, []);

  return createPortal(
    <div className="modal attachViewer" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="attachViewer__card" onClick={(ev) => ev.stopPropagation()}>
        <div className="attachViewer__head">
          <span className="attachViewer__name">{name}</span>
          <div className="attachViewer__actions">
            {!isImage ? (
              <a
                className="btn btn--soft attachViewer__download"
                href={url}
                download={attachment.originalName || undefined}
              >
                {t("support.attachment.download")}
              </a>
            ) : null}
            <button
              type="button"
              className="btn btn--soft attachViewer__close"
              onClick={onClose}
              aria-label={t("common.close")}
            >
              ✕
            </button>
          </div>
        </div>
        <div className={isImage ? "attachViewer__body" : "attachViewer__body attachViewer__body--pdf"}>
          {isImage ? (
            <img
              className="attachViewer__image"
              src={url}
              alt={attachment.originalName || t("support.attachment.image_alt")}
            />
          ) : (
            <iframe className="attachViewer__frame" src={url} title={name} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function AttachmentView({
  attachment,
  onOpen,
}: {
  attachment: TicketAttachment;
  onOpen: (attachment: TicketAttachment) => void;
}) {
  const { t, formatBytes } = useI18n();

  if (attachment.deletedAt) {
    return (
      <div className="attachItem attachItem--expired">
        <span className="attachItem__icon"></span>
        <span className="attachItem__main">
          <span className="attachItem__name">{attachment.originalName || t("support.attachment.file")}</span>
          <span className="attachItem__note">{t("support.attachment.expired")}</span>
        </span>
      </div>
    );
  }

  if (isImageAttachment(attachment)) {
    return (
      <button
        type="button"
        className="attachImage"
        onClick={() => onOpen(attachment)}
        aria-label={t("support.attachment.open")}
      >
        <img
          src={attachmentUrl(attachment.id)}
          alt={attachment.originalName || t("support.attachment.image_alt")}
          loading="lazy"
        />
      </button>
    );
  }

  if (isPdfAttachment(attachment)) {
    return (
      <button
        type="button"
        className="attachItem attachItem--pdf"
        onClick={() => onOpen(attachment)}
        aria-label={t("support.attachment.open")}
      >
        <span className="attachItem__icon">📄</span>
        <span className="attachItem__main">
          <span className="attachItem__name">{attachment.originalName || t("support.attachment.file")}</span>
          <span className="attachItem__size">{formatBytes(attachment.sizeBytes)}</span>
        </span>
      </button>
    );
  }

  // Generic files are downloaded in place; the SPA never navigates.
  return (
    <a
      className="attachItem"
      href={attachmentUrl(attachment.id)}
      download={attachment.originalName || undefined}
    >
      <span className="attachItem__icon">📄</span>
      <span className="attachItem__main">
        <span className="attachItem__name">{attachment.originalName || t("support.attachment.file")}</span>
        <span className="attachItem__size">{formatBytes(attachment.sizeBytes)}</span>
      </span>
    </a>
  );
}

export function AttachmentList({ attachments }: { attachments?: TicketAttachment[] | null }) {
  const [viewer, setViewer] = useState<TicketAttachment | null>(null);

  if (!attachments || attachments.length === 0) return null;

  return (
    <div className="attachList">
      {attachments.map((a) => (
        <AttachmentView key={a.id} attachment={a} onOpen={setViewer} />
      ))}
      {viewer ? <AttachmentViewer attachment={viewer} onClose={() => setViewer(null)} /> : null}
    </div>
  );
}

export function PendingFiles({ files, onRemove, disabled }: { files: PendingFile[]; onRemove: (id: string) => void; disabled?: boolean }) {
  const { t, formatBytes } = useI18n();
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
            aria-label={t("support.attachment.remove")}
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