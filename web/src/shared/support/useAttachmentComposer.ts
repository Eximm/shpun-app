// web/src/shared/support/useAttachmentComposer.ts
//
// Shared pending-attachment state for support/partnership composers (user +
// admin). One implementation of: file picker, clipboard screenshot paste,
// client-side limits, preview lifecycle and object-URL cleanup.

import { useCallback, useEffect, useRef, useState } from "react";
import { releasePendingFiles, toPendingFiles, type PendingFile } from "./attachments";
import { extractClipboardImageFiles } from "./clipboardAttachments";

export const SUPPORT_MAX_FILES = 5;
export const SUPPORT_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB / file
export const SUPPORT_MAX_TOTAL_BYTES = 25 * 1024 * 1024; // 25 MB / message

export type AttachmentAddError = "too_many_files" | "file_too_large" | "total_too_large";

type Options = {
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  /** Called when an added file is rejected by a client-side limit. */
  onError?: (error: AttachmentAddError) => void;
};

export function useAttachmentComposer(options: Options = {}) {
  const maxFiles = options.maxFiles ?? SUPPORT_MAX_FILES;
  const maxFileBytes = options.maxFileBytes ?? SUPPORT_MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? SUPPORT_MAX_TOTAL_BYTES;
  const onError = options.onError;

  const [pending, setPending] = useState<PendingFile[]>([]);
  const pendingRef = useRef<PendingFile[]>([]);
  useEffect(() => {
    pendingRef.current = pending;
  }, [pending]);

  // Release object URLs if the composer unmounts with pending files.
  useEffect(() => {
    return () => {
      releasePendingFiles(pendingRef.current);
      pendingRef.current = [];
    };
  }, []);

  const applyPending = useCallback((next: PendingFile[]) => {
    pendingRef.current = next;
    setPending(next);
  }, []);

  const addFiles = useCallback(
    (files: File[]) => {
      if (!files || files.length === 0) return;
      const current = pendingRef.current;
      const next = [...current];
      let total = current.reduce((sum, f) => sum + f.file.size, 0);
      let error: AttachmentAddError | null = null;

      for (const file of files) {
        if (next.length >= maxFiles) {
          error = "too_many_files";
          break;
        }
        if (file.size > maxFileBytes) {
          error = "file_too_large";
          continue;
        }
        if (total + file.size > maxTotalBytes) {
          error = "total_too_large";
          continue;
        }
        total += file.size;
        next.push(...toPendingFiles([file]));
      }

      if (next.length !== current.length) applyPending(next);
      if (error) onError?.(error);
    },
    [applyPending, maxFiles, maxFileBytes, maxTotalBytes, onError]
  );

  const onPickFiles = useCallback(
    (event: { target: HTMLInputElement }) => {
      const picked = event.target.files ? Array.from(event.target.files) : [];
      addFiles(picked);
      event.target.value = "";
    },
    [addFiles]
  );

  /**
   * Textarea onPaste handler. When the clipboard has image file(s), they become
   * pending attachments. Plain text paste is NOT prevented, so normal text
   * paste (and text alongside an image) keeps working.
   */
  const onPaste = useCallback(
    (event: { clipboardData?: DataTransfer | null; defaultPrevented?: boolean }) => {
      const images = extractClipboardImageFiles(event);
      if (images.length === 0) return; // no image -> default text paste
      addFiles(images);
    },
    [addFiles]
  );

  const removePending = useCallback(
    (id: string) => {
      const current = pendingRef.current;
      const target = current.find((f) => f.id === id);
      if (target?.previewUrl) {
        try { URL.revokeObjectURL(target.previewUrl); } catch { /* ignore */ }
      }
      applyPending(current.filter((f) => f.id !== id));
    },
    [applyPending]
  );

  /** Release previews and drop all pending files (successful send / cancel). */
  const clearPending = useCallback(() => {
    releasePendingFiles(pendingRef.current);
    applyPending([]);
  }, [applyPending]);

  return {
    pending,
    addFiles,
    onPickFiles,
    onPaste,
    removePending,
    clearPending,
    maxFiles,
    atMaxFiles: pending.length >= maxFiles,
  };
}