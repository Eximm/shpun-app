// api/src/modules/support/notifications.ts
//
// Best-effort support notification layer.
//
//  - notifySupportTicketCreated  -> admins (Telegram + ShpunApp in-app)
//  - notifySupportUserMessage    -> admins (Telegram + ShpunApp in-app)
//  - notifySupportStaffReply     -> user   (Telegram only for now; source-extensible)
//
// Notifications must NEVER block or roll back the ticket/message write. Every
// public function catches its own errors. Callers may safely `void` them.
//
// Admin Telegram recipients: see telegram.ts (SUPPORT_ADMIN_CHAT_IDS, optionally
// routed into the single SUPPORT_ADMIN_THREAD_ID topic). Admin in-app recipients:
// the local delivery registry (see notifyRepo.ts); it is populated only after the
// existing billing/auth admin check has already confirmed admin access.

import { getTicketRepository } from "./repository.js";
import { listSupportNotifyRecipients } from "./notifyRepo.js";
import { putNotifEvent, type NotifEvent } from "../../shared/linkdb/notificationsRepo.js";
import { sendWebPushToUser } from "../notifications/webpush.js";
import {
  sendSupportAdminTelegramMessage,
  sendSupportTelegramMessage,
  supportTicketAdminUrl,
} from "./telegram.js";
import type { Ticket, TicketMessage } from "./types.js";

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

function nowTs(): number {
  return Math.floor(Date.now() / 1000);
}

/* ─── Admin Telegram ─────────────────────────────────────────────────────── */

async function sendAdminTelegram(text: string, ticketId: number): Promise<void> {
  const replyMarkup = {
    inline_keyboard: [[{ text: "Открыть в ShpunApp", url: supportTicketAdminUrl(ticketId) }]],
  };
  await sendSupportAdminTelegramMessage(text, replyMarkup);
}

/* ─── Admin ShpunApp in-app ──────────────────────────────────────────────── */

function emitAdminInApp(base: {
  eventBaseId: string;
  type: string;
  title: string;
  message: string;
  ticketId: number;
  publicNo: string;
  messageId?: number;
}): void {
  const recipients = listSupportNotifyRecipients();
  if (recipients.length === 0) return;

  const ts = nowTs();
  const to = `/admin?tab=support&ticket=${base.ticketId}`;

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
        ticketId: base.ticketId,
        publicNo: base.publicNo,
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

/* ─── Public API ─────────────────────────────────────────────────────────── */

export async function notifySupportTicketCreated(
  ticket: Ticket,
  _firstMessage?: TicketMessage | null
): Promise<void> {
  try {
    const lines = [
      `🛟 <b>Новый тикет #${esc(ticket.publicNo)}</b>`,
      userLine(ticket),
      esc(categoryTitle(ticket)),
      serviceLine(ticket),
    ].filter(Boolean);
    await sendAdminTelegram(lines.join("\n"), ticket.id);
  } catch {
    // best-effort
  }

  try {
    emitAdminInApp({
      eventBaseId: `support:ticket:${ticket.id}:created`,
      type: "support.ticket.created",
      title: `🛟 Новый тикет #${ticket.publicNo}`,
      message: [ticket.displayNameSnapshot || `#${ticket.userId}`, categoryTitle(ticket)]
        .filter(Boolean)
        .join(" · "),
      ticketId: ticket.id,
      publicNo: ticket.publicNo,
    });
  } catch {
    // best-effort
  }
}

export async function notifySupportUserMessage(
  ticket: Ticket,
  message: TicketMessage
): Promise<void> {
  try {
    const lines = [
      `💬 <b>Новый ответ в тикете #${esc(ticket.publicNo)}</b>`,
      userLine(ticket),
      esc(clip(message.text, 200)),
    ].filter(Boolean);
    await sendAdminTelegram(lines.join("\n"), ticket.id);
  } catch {
    // best-effort
  }

  try {
    emitAdminInApp({
      eventBaseId: `support:ticket:${ticket.id}:msg:${message.id}`,
      type: "support.message",
      title: `💬 Новый ответ в тикете #${ticket.publicNo}`,
      message: clip(message.text, 160),
      ticketId: ticket.id,
      publicNo: ticket.publicNo,
      messageId: message.id,
    });
  } catch {
    // best-effort
  }
}

export async function notifySupportStaffReply(
  ticket: Ticket,
  _message: TicketMessage
): Promise<void> {
  // User notification is source-extensible: Telegram now, app/web push later.
  if (ticket.source !== "telegram") return;
  if (!ticket.telegramChatId) return;

  const text =
    `🛟 По обращению #${esc(ticket.publicNo)} есть новый ответ.\n\n` +
    `Откройте «Мои обращения», чтобы посмотреть сообщение поддержки.`;

  const replyMarkup = {
    inline_keyboard: [[{ text: "🎫 Открыть обращение", callback_data: `support:view ${ticket.id}` }]],
  };

  try {
    await sendSupportTelegramMessage(ticket.telegramChatId, text, replyMarkup);
  } catch {
    // best-effort: never roll back the staff reply
  }
}
