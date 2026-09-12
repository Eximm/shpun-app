// api/src/modules/support/notifications.ts
//
// Best-effort notification layer for support tickets AND partnership proposals.
//
//  - notifyTicketCreated     -> admins (Telegram topic + ShpunApp in-app)
//  - notifyTicketUserMessage -> admins (Telegram topic + ShpunApp in-app)
//  - notifyTicketStaffReply  -> applicant, SOURCE-AWARE:
//      * source=telegram -> short Telegram message (+ attachments via Bot API)
//      * source=app      -> owner notif_event + web push (deep link to ticket)
//
// The ticket `source` is the single source of truth for the reply channel.
// A telegram_chat_id on an app-source ticket is NEVER used as a fallback.
//
// Support and partnership share the same infrastructure but use different
// Telegram topics (SUPPORT_ADMIN_THREAD_ID / PARTNERSHIP_ADMIN_THREAD_ID).
// Notifications never block or roll back a write; every public function catches
// its own errors and callers may safely `void` them.

import { getTicketRepository } from "./repository.js";
import { listSupportNotifyRecipients } from "./notifyRepo.js";
import { putNotifEvent, type NotifEvent } from "../../shared/linkdb/notificationsRepo.js";
import { sendWebPushToUser } from "../notifications/webpush.js";
import {
  sendPartnershipAdminTelegramMessage,
  sendSupportAdminTelegramMessage,
  sendSupportTelegramAttachment,
  sendSupportTelegramMessage,
  supportTicketAdminUrl,
} from "./telegram.js";
import { getAttachmentStorage } from "./attachmentStorage.js";
import { partnershipTypeLabel, type PartnershipContext, type Ticket, type TicketMessage } from "./types.js";

function esc(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function clip(value: unknown, max = 200): string {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function categoryTitle(ticket: Ticket): string {
  try {
    return getTicketRepository().getCategory(ticket.categoryKey)?.title || ticket.categoryKey;
  } catch {
    return ticket.categoryKey;
  }
}

function userLine(ticket: Ticket): string {
  const name = ticket.displayNameSnapshot || ticket.userLoginSnapshot || `Пользователь #${ticket.userId}`;
  return `${esc(name)} · #${ticket.userId}`;
}

function serviceLine(ticket: Ticket): string {
  const usi = ticket.userServiceId ? `#${ticket.userServiceId}` : "";
  const name = ticket.serviceSnapshot?.name || "";
  if (!usi && !name) return "";
  const head = usi ? `Услуга ${usi}` : "Услуга";
  return name ? `${head} · ${esc(name)}` : head;
}

function partnershipContext(ticket: Ticket): PartnershipContext | null {
  const raw = (ticket.contextSnapshot as any)?.partnership;
  return raw && typeof raw === "object" ? (raw as PartnershipContext) : null;
}

function nowTs(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Concise delivery logging (no secrets, no file contents).
 * Use it to confirm in production that a reply was saved and whether delivery
 * to Telegram / in-app succeeded.
 */
function logDelivery(event: string, data: Record<string, unknown>): void {
  try {
    console.info(`SUPPORT_NOTIFY ${event}`, data);
  } catch {
    // ignore
  }
}

function logDeliveryFailure(event: string, data: Record<string, unknown>): void {
  try {
    console.warn(`SUPPORT_NOTIFY ${event}`, data);
  } catch {
    // ignore
  }
}

function adminTab(kind: Ticket["kind"]): string {
  return kind === "partnership" ? "partnership" : "support";
}

/* ─── Admin Telegram ─────────────────────────────────────────────────────── */

async function sendAdminTelegram(ticket: Ticket, text: string): Promise<void> {
  const replyMarkup = {
    inline_keyboard: [[{ text: "Открыть в ShpunApp", url: supportTicketAdminUrl(ticket.id, ticket.kind) }]],
  };
  if (ticket.kind === "partnership") {
    await sendPartnershipAdminTelegramMessage(text, replyMarkup);
  } else {
    await sendSupportAdminTelegramMessage(text, replyMarkup);
  }
}

/* ─── Admin ShpunApp in-app ──────────────────────────────────────────────── */

function emitAdminInApp(base: {
  eventBaseId: string;
  type: string;
  title: string;
  message: string;
  ticket: Ticket;
  messageId?: number;
}): void {
  const recipients = listSupportNotifyRecipients();
  if (recipients.length === 0) return;

  const ts = nowTs();
  const to = `/admin?tab=${adminTab(base.ticket.kind)}&ticket=${base.ticket.id}`;

  for (const uid of recipients) {
    const event: NotifEvent = {
      event_id: `u:${uid}:${base.eventBaseId}`,
      ts,
      type: base.type,
      level: "info",
      title: base.title,
      message: base.message,
      target: "user",
      user_id: uid,
      toast: true,
      meta: {
        ticketId: base.ticket.id,
        publicNo: base.ticket.publicNo,
        kind: base.ticket.kind,
        ...(base.messageId ? { messageId: base.messageId } : {}),
        action: { kind: "nav", to, label: "Открыть" },
        short: { title: base.title, message: base.message },
      },
    };

    const stored = putNotifEvent(event);
    if (stored.ok && !stored.dedup) {
      void sendWebPushToUser(uid, event).catch(() => {});
    }
  }
}

function emitOwnerInApp(ticket: Ticket, base: {
  eventBaseId: string;
  type: string;
  title: string;
  message: string;
  messageId?: number;
}): void {
  const uid = Math.trunc(Number(ticket.userId));
  if (!Number.isFinite(uid) || uid <= 0) return;

  const ts = nowTs();
  const to = `/support?ticket=${ticket.id}`;
  const event: NotifEvent = {
    event_id: `u:${uid}:${base.eventBaseId}`,
    ts,
    type: base.type,
    level: "info",
    title: base.title,
    message: base.message,
    target: "user",
    user_id: uid,
    toast: true,
    meta: {
      ticketId: ticket.id,
      publicNo: ticket.publicNo,
      kind: ticket.kind,
      ...(base.messageId ? { messageId: base.messageId } : {}),
      action: { kind: "nav", to, label: "Открыть" },
      short: { title: base.title, message: base.message },
    },
  };

  const stored = putNotifEvent(event);
  if (!stored.ok) {
    logDeliveryFailure("owner_inapp_store_failed", {
      ticket: ticket.publicNo,
      kind: ticket.kind,
      source: ticket.source,
      error: stored.error,
    });
    return;
  }
  logDelivery("owner_inapp_ok", {
    ticket: ticket.publicNo,
    kind: ticket.kind,
    source: ticket.source,
    user_id: uid,
    dedup: stored.dedup,
  });
  if (!stored.dedup) {
    void sendWebPushToUser(uid, event).catch(() => {});
  }
}

/* ─── Text builders ──────────────────────────────────────────────────────── */

function createdTelegramText(ticket: Ticket): string {
  if (ticket.kind === "partnership") {
    const p = partnershipContext(ticket);
    return [
      `🤝 <b>Новое предложение #${esc(ticket.publicNo)}</b>`,
      p ? esc(partnershipTypeLabel(p.proposal_type)) : "",
      p?.platform_url ? `Площадка: ${esc(p.platform_url)}` : "",
      p?.audience_size ? `Аудитория: ${esc(p.audience_size)}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return [
    `🛟 <b>Новый тикет #${esc(ticket.publicNo)}</b>`,
    userLine(ticket),
    esc(categoryTitle(ticket)),
    serviceLine(ticket),
  ]
    .filter(Boolean)
    .join("\n");
}

function createdInAppTitle(ticket: Ticket): string {
  return ticket.kind === "partnership"
    ? `🤝 Новое предложение #${ticket.publicNo}`
    : `🛟 Новый тикет #${ticket.publicNo}`;
}

function createdInAppMessage(ticket: Ticket): string {
  if (ticket.kind === "partnership") {
    const p = partnershipContext(ticket);
    return [partnershipTypeLabel(p?.proposal_type), p?.platform_url].filter(Boolean).join(" · ");
  }
  return [ticket.displayNameSnapshot || `#${ticket.userId}`, categoryTitle(ticket)].filter(Boolean).join(" · ");
}

/* ─── Public API ─────────────────────────────────────────────────────────── */

export async function notifyTicketCreated(ticket: Ticket): Promise<void> {
  try {
    await sendAdminTelegram(ticket, createdTelegramText(ticket));
  } catch {
    // best-effort
  }

  try {
    emitAdminInApp({
      eventBaseId: `${ticket.kind}:${ticket.id}:created`,
      type: ticket.kind === "partnership" ? "partnership.created" : "support.ticket.created",
      title: createdInAppTitle(ticket),
      message: createdInAppMessage(ticket),
      ticket,
    });
  } catch {
    // best-effort
  }
}

export async function notifyTicketUserMessage(ticket: Ticket, message: TicketMessage): Promise<void> {
  const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
  const preview = clip(message.text, 200) || (hasAttachments ? "📎 Пользователь отправил вложение" : "");

  try {
    const head =
      ticket.kind === "partnership"
        ? `💬 <b>Новый ответ по предложению #${esc(ticket.publicNo)}</b>`
        : `💬 <b>Новый ответ в тикете #${esc(ticket.publicNo)}</b>`;
    const text = [head, userLine(ticket), esc(preview)].filter(Boolean).join("\n");
    await sendAdminTelegram(ticket, text);
  } catch {
    // best-effort
  }

  try {
    emitAdminInApp({
      eventBaseId: `${ticket.kind}:${ticket.id}:msg:${message.id}`,
      type: ticket.kind === "partnership" ? "partnership.message" : "support.message",
      title:
        ticket.kind === "partnership"
          ? `💬 Новый ответ по предложению #${ticket.publicNo}`
          : `💬 Новый ответ в тикете #${ticket.publicNo}`,
      message: preview || "📎 Вложение",
      ticket,
      messageId: message.id,
    });
  } catch {
    // best-effort
  }
}

export async function notifyTicketStaffReply(ticket: Ticket, message: TicketMessage): Promise<void> {
  const hasAttachments = Array.isArray(message.attachments) && message.attachments.length > 0;
  const preview = clip(message.text, 200) || (hasAttachments ? "📎 Поддержка отправила вложение" : "Новый ответ");

  // SOURCE-AWARE: the ticket source decides the reply channel.
  if (ticket.source === "telegram") {
    const chatId = ticket.telegramChatId;
    if (!chatId) {
      logDeliveryFailure("staff_reply_skipped", {
        ticket: ticket.publicNo,
        kind: ticket.kind,
        source: ticket.source,
        reason: "missing_telegram_chat_id",
      });
      return;
    }

    const text =
      ticket.kind === "partnership"
        ? `🤝 По предложению #${esc(ticket.publicNo)} есть новый ответ.\n\n` +
          `Откройте «Мои обращения», чтобы посмотреть ответ.`
        : `🛟 По обращению #${esc(ticket.publicNo)} есть новый ответ.\n\n` +
          `Откройте «Мои обращения», чтобы посмотреть сообщение поддержки.`;

    const replyMarkup = {
      inline_keyboard: [[{ text: "🎫 Открыть обращение", callback_data: `support:view ${ticket.id}` }]],
    };

    try {
      const result = await sendSupportTelegramMessage(chatId, text, replyMarkup);
      if (result.ok) {
        logDelivery("staff_reply_telegram_ok", {
          ticket: ticket.publicNo,
          kind: ticket.kind,
          source: ticket.source,
          chat_id: chatId,
        });
      } else {
        logDeliveryFailure("staff_reply_telegram_failed", {
          ticket: ticket.publicNo,
          kind: ticket.kind,
          source: ticket.source,
          chat_id: chatId,
          error: result.error,
        });
      }
    } catch (error: any) {
      logDeliveryFailure("staff_reply_telegram_error", {
        ticket: ticket.publicNo,
        kind: ticket.kind,
        source: ticket.source,
        chat_id: chatId,
        error: String(error?.message ?? error ?? "unknown"),
      });
    }

    // Forward staff attachments directly to the user's Telegram chat (no public URLs).
    const attachments = message.attachments ?? [];
    if (attachments.length === 0) return;

    const storage = getAttachmentStorage();
    let delivered = 0;
    let failed = 0;
    for (const attachment of attachments) {
      if (attachment.deletedAt) continue;
      try {
        const buffer = storage.read(attachment.storageKey);
        if (!buffer) {
          failed++;
          continue;
        }
        const result = await sendSupportTelegramAttachment(chatId, {
          buffer,
          filename: attachment.originalName || "file",
          mimeType: attachment.mimeType,
        });
        if (result.ok) delivered++;
        else failed++;
      } catch {
        failed++;
      }
    }
    logDelivery("staff_reply_attachments", {
      ticket: ticket.publicNo,
      kind: ticket.kind,
      source: ticket.source,
      chat_id: chatId,
      delivered,
      failed,
    });
    return;
  }

  // source=app (or any non-telegram source): in-app notification + web push only.
  // Never fall back to Telegram just because a chat id happens to exist.
  if (ticket.source === "app") {
    emitOwnerInApp(ticket, {
      eventBaseId: `${ticket.kind}:${ticket.id}:staff:${message.id}`,
      type: ticket.kind === "partnership" ? "partnership.reply" : "support.reply",
      title:
        ticket.kind === "partnership"
          ? `Ответ по предложению #${ticket.publicNo}`
          : `Ответ по обращению #${ticket.publicNo}`,
      message: preview,
      messageId: message.id,
    });
    return;
  }

  logDeliveryFailure("staff_reply_skipped", {
    ticket: ticket.publicNo,
    kind: ticket.kind,
    source: ticket.source,
    reason: "unsupported_source",
  });
}
