// api/src/modules/support/telegram.ts
//
// Outbound Telegram messages for support notifications.
//
// Reuses the existing bot token (TG_BOT_TOKEN). Admin notifications go to
// SUPPORT_ADMIN_CHAT_IDS; when no dedicated list is configured, the existing
// staff/receipts chat (TG_RECEIPTS_CHAT_ID / RECEIPTS_CHAT_ID) is used as a
// fallback so no duplicate list is required out of the box.
//
// Admin notifications may be routed into a single forum topic via
// SUPPORT_ADMIN_THREAD_ID (e.g. the "Support / Тикеты" topic). One topic for
// all admin support events — never per-event topics.
//
// All calls are best-effort: callers must not depend on their result.

function envStr(name: string, def = ""): string {
  const v = String(process.env[name] ?? "").trim();
  return v || def;
}

export function supportBotToken(): string {
  return envStr("TG_BOT_TOKEN");
}

/**
 * Admin/operator Telegram chats for support notifications.
 * Dedicated SUPPORT_ADMIN_CHAT_IDS wins; otherwise fall back to the existing
 * receipts/staff chat so no duplicate list is required out of the box.
 */
export function supportAdminChatIds(): string[] {
  const dedicated = envStr("SUPPORT_ADMIN_CHAT_IDS");
  if (dedicated) {
    return dedicated
      .split(/[,\s]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  const fallback = envStr("TG_RECEIPTS_CHAT_ID") || envStr("RECEIPTS_CHAT_ID");
  return fallback ? [fallback] : [];
}

/**
 * Forum topic id for admin support notifications.
 * Returns null when unset or invalid, so the message is sent without
 * `message_thread_id` (plain chat / General topic) as before.
 */
export function supportAdminThreadId(): number | null {
  const raw = envStr("SUPPORT_ADMIN_THREAD_ID");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/**
 * Forum topic id for partnership/advertising intake notifications.
 * Returns null when unset or invalid; the message is then sent to the general
 * admin chat (no thread) as a safe fallback.
 */
export function partnershipAdminThreadId(): number | null {
  const raw = envStr("PARTNERSHIP_ADMIN_THREAD_ID");
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

export function supportAppBaseUrl(): string {
  const explicit = envStr("SUPPORT_APP_URL");
  if (explicit) return explicit.replace(/\/+$/, "");

  const origins = envStr("APP_ORIGIN")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const https = origins.find((o) => o.startsWith("https://"));
  return (https || "https://app.shpun.net").replace(/\/+$/, "");
}

/** Deep link that opens a ticket/proposal in the ShpunApp admin. */
export function supportTicketAdminUrl(ticketId: number | string, kind?: string): string {
  const id = encodeURIComponent(String(ticketId ?? "").trim());
  const tab = kind === "partnership" ? "partnership" : "support";
  return `${supportAppBaseUrl()}/admin?tab=${tab}&ticket=${id}`;
}

export type TelegramSendResult = { ok: boolean; error?: string };

export type TelegramSendOptions = {
  /** Optional forum topic id. Ignored unless a positive integer. */
  threadId?: number | null;
};

export async function sendSupportTelegramMessage(
  chatId: string | number,
  text: string,
  replyMarkup?: Record<string, unknown>,
  options?: TelegramSendOptions
): Promise<TelegramSendResult> {
  const token = supportBotToken();
  if (!token) return { ok: false, error: "tg_token_missing" };

  try {
    const body: Record<string, unknown> = {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };

    const threadId = Number(options?.threadId ?? 0);
    if (Number.isFinite(threadId) && threadId > 0) {
      body.message_thread_id = Math.trunc(threadId);
    }

    if (replyMarkup) body.reply_markup = replyMarkup;

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      return { ok: false, error: String(json?.description ?? `http_${res.status}`) };
    }
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error ?? "tg_send_failed") };
  }
}

/**
 * Send a support notification to every configured admin chat, routed into the
 * single SUPPORT_ADMIN_THREAD_ID topic when configured.
 */
export async function sendSupportAdminTelegramMessage(
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<void> {
  const chats = supportAdminChatIds();
  if (chats.length === 0) return;

  const threadId = supportAdminThreadId();
  await Promise.allSettled(
    chats.map((chatId) => sendSupportTelegramMessage(chatId, text, replyMarkup, { threadId }))
  );
}

/**
 * Send a partnership notification to the same admin chats, routed into the
 * PARTNERSHIP_ADMIN_THREAD_ID topic when configured. Falls back to the general
 * chat (no thread) when the partnership topic is unset.
 */
export async function sendPartnershipAdminTelegramMessage(
  text: string,
  replyMarkup?: Record<string, unknown>
): Promise<void> {
  const chats = supportAdminChatIds();
  if (chats.length === 0) return;

  const threadId = partnershipAdminThreadId();
  await Promise.allSettled(
    chats.map((chatId) => sendSupportTelegramMessage(chatId, text, replyMarkup, { threadId }))
  );
}
/* ─── Incoming file download (Telegram Bot API) ──────────────────────────── */

export type TelegramDownload = { buffer: Buffer; filePath: string; size?: number };

/**
 * Download a Telegram file by file_id via Bot API (getFile + file download).
 * The binary never travels through the SHM billing DSL.
 */
export async function downloadTelegramFile(fileId: string): Promise<TelegramDownload | null> {
  const token = supportBotToken();
  const id = String(fileId ?? "").trim();
  if (!token || !id) return null;

  try {
    const metaRes = await fetch(
      `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(id)}`
    );
    const meta: any = await metaRes.json().catch(() => null);
    if (!metaRes.ok || !meta?.ok || !meta?.result?.file_path) return null;

    const filePath = String(meta.result.file_path);
    const fileRes = await fetch(`https://api.telegram.org/file/bot${token}/${filePath}`);
    if (!fileRes.ok) return null;

    const arrayBuffer = await fileRes.arrayBuffer();
    return {
      buffer: Buffer.from(arrayBuffer),
      filePath,
      size: Number(meta.result.file_size ?? 0) || undefined,
    };
  } catch {
    return null;
  }
}

/* ─── Outbound attachments (staff reply -> Telegram user) ────────────────── */

async function tgSendFile(
  endpoint: "sendPhoto" | "sendDocument",
  field: "photo" | "document",
  chatId: string | number,
  buffer: Buffer,
  filename: string,
  mimeType: string,
  caption?: string
): Promise<TelegramSendResult> {
  const token = supportBotToken();
  if (!token) return { ok: false, error: "tg_token_missing" };

  try {
    const fd = new FormData();
    fd.append("chat_id", String(chatId));
    if (caption) fd.append("caption", caption);
    const u8 = new Uint8Array(buffer);
    const blob = new Blob([u8], { type: mimeType || "application/octet-stream" });
    // @ts-ignore — undici supports filename
    fd.append(field, blob, filename || "file");

    const res = await fetch(`https://api.telegram.org/bot${token}/${endpoint}`, {
      method: "POST",
      body: fd as any,
    });
    const json: any = await res.json().catch(() => null);
    if (!res.ok || !json?.ok) {
      return { ok: false, error: String(json?.description ?? `http_${res.status}`) };
    }
    return { ok: true };
  } catch (error: any) {
    return { ok: false, error: String(error?.message ?? error ?? "tg_send_file_failed") };
  }
}

/**
 * Send a stored support attachment to a Telegram chat.
 * Images go as photos; everything else (incl. HEIC and PDF) as documents.
 */
export async function sendSupportTelegramAttachment(
  chatId: string | number,
  attachment: { buffer: Buffer; filename: string; mimeType: string },
  caption?: string
): Promise<TelegramSendResult> {
  const mime = String(attachment.mimeType || "").toLowerCase();
  const isPhoto = mime.startsWith("image/") && mime !== "image/heic" && mime !== "image/heif";
  return isPhoto
    ? tgSendFile("sendPhoto", "photo", chatId, attachment.buffer, attachment.filename, attachment.mimeType, caption)
    : tgSendFile("sendDocument", "document", chatId, attachment.buffer, attachment.filename, attachment.mimeType, caption);
}
