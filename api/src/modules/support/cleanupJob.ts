// api/src/modules/support/cleanupJob.ts
//
// Lightweight daily retention cleanup for support/partnership attachments.
// Runs at startup and every 24h. Idempotent and best-effort.

import { cleanupExpiredAttachments } from "./attachmentService.js";

const DAY_MS = 24 * 60 * 60 * 1000;
let started = false;

export function startSupportAttachmentCleanup(): void {
  if (started) return;
  started = true;

  const run = () => {
    try {
      const summary = cleanupExpiredAttachments();
      console.info("SUPPORT_ATTACHMENT_CLEANUP", summary);
    } catch (error: any) {
      console.warn("SUPPORT_ATTACHMENT_CLEANUP_FAIL", {
        msg: String(error?.message ?? error ?? "unknown"),
      });
    }
  };

  // First pass right away (best-effort), then daily.
  run();
  const timer = setInterval(run, DAY_MS);
  if (typeof timer.unref === "function") timer.unref();
}
