// api/src/modules/serverStatus/monitoringNotifications.ts
//
// Delivers confirmed monitoring incidents through the EXISTING admin
// notification stack (no new bot / no new channel):
//   - in-app admin notifications -> `notif_events` + admin recipients
//     (`listSupportNotifyRecipients`), which also power the bell/inbox;
//   - Web Push -> `sendWebPushToUser` (used by support notifications too);
//   - Telegram -> the existing support admin chat list via
//     `sendSupportTelegramMessage` (sent WITHOUT the support topic so
//     monitoring does not pollute the support thread).
//
// Channels by severity:
//   - critical: in-app + Web Push + Telegram (opened / escalated / resolved /
//     reminder);
//   - warning:  in-app only (opened / reminder);
//   - info:     none (Recent Activity / monitoring_events only).
//
// Dedup is provided by the incident engine (one event per transition) plus a
// deterministic `event_id` so a re-delivery can never duplicate a notification.

import type { IncidentEvent } from "./incidents.js";
import { putNotifEvent, type NotifEvent } from "../../shared/linkdb/notificationsRepo.js";
import { listSupportNotifyRecipients } from "../support/notifyRepo.js";
import { sendWebPushToUser } from "../notifications/webpush.js";
import { sendSupportTelegramMessage, supportAdminChatIds } from "../support/telegram.js";

type Logger = { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };

function esc(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function levelFor(severity: string): NotifEvent["level"] {
  return severity === "critical" ? "error" : "info";
}

function titleFor(event: IncidentEvent): string {
  if (event.kind === "resolved") return ` Восстановлено: ${event.serverTitle}`;
  if (event.kind === "escalated") return `🔴 Критично: ${event.serverTitle}`;
  if (event.kind === "reminder") return `⚠️ Напоминание: ${event.serverTitle}`;
  return event.severity === "critical" ? `🔴 Критично: ${event.serverTitle}` : `⚠️ Предупреждение: ${event.serverTitle}`;
}

function bodyFor(event: IncidentEvent): string {
  if (event.kind === "resolved") {
    const mins = event.durationSec != null ? ` · длительность ${Math.max(1, Math.round(event.durationSec / 60))} мин` : "";
    return `${event.incident.message}${mins}`;
  }
  return event.incident.message;
}

function telegramText(event: IncidentEvent): string {
  const icon = event.kind === "resolved" ? "" : event.severity === "critical" ? "🔴" : "⚠️";
  const head = event.kind === "resolved" ? "Восстановлено" : event.severity === "critical" ? "Критический инцидент" : "Инцидент мониторинга";
  return [
    `${icon} <b>${head}</b>`,
    `<b>${esc(event.serverTitle)}</b>`,
    esc(event.incident.message),
    `Правило: ${esc(event.ruleType)}${event.incident.value != null ? ` · значение ${esc(event.incident.value)}` : ""}`,
  ].join("\n");
}

function shouldDeliver(event: IncidentEvent): boolean {
  if (event.kind === "resolved") return event.severity === "critical";
  if (event.kind === "opened" || event.kind === "escalated" || event.kind === "reminder") {
    return event.severity === "critical" || event.severity === "warning";
  }
  return false;
}

function eventId(event: IncidentEvent): string {
  const suffix = event.kind === "reminder" ? `reminder:${event.ts}` : event.kind;
  return `monitoring:${event.incident.id}:${suffix}`;
}

function deliverInApp(event: IncidentEvent, logger?: Logger): void {
  const recipients = listSupportNotifyRecipients();
  if (recipients.length === 0) return;

  const title = titleFor(event);
  const message = bodyFor(event);
  const notify: NotifEvent = {
    event_id: "", // set per recipient below
    ts: event.ts,
    type: event.kind === "resolved" ? "monitoring.resolved" : "monitoring.incident",
    level: levelFor(event.severity),
    title,
    message,
    target: "user",
    toast: event.kind !== "reminder",
    meta: {
      incidentId: event.incident.id,
      ruleType: event.ruleType,
      severity: event.severity,
      serverId: event.serverId,
      action: { kind: "nav", to: "/admin?tab=serverStatus", label: "Открыть" },
      short: { title, message },
    },
  };

  for (const uid of recipients) {
    const stored = putNotifEvent({ ...notify, event_id: `u:${uid}:${eventId(event)}`, user_id: uid });
    if (!stored.ok) {
      logger?.warn?.({ err: stored.error, incidentId: event.incident.id }, "MONITOR_NOTIFY_INAPP_STORE_FAIL");
      continue;
    }
    if (!stored.dedup && event.severity === "critical") {
      void sendWebPushToUser(uid, { ...notify, event_id: `u:${uid}:${eventId(event)}`, user_id: uid }).catch(() => {});
    }
  }
}

async function deliverTelegram(event: IncidentEvent, logger?: Logger): Promise<void> {
  const chats = supportAdminChatIds();
  if (chats.length === 0) return;
  const text = telegramText(event);
  await Promise.allSettled(
    chats.map((chatId) => sendSupportTelegramMessage(chatId, text, undefined, { threadId: null })),
  );
  logger?.info?.({ incidentId: event.incident.id, chats: chats.length }, "MONITOR_NOTIFY_TELEGRAM");
}

/** Deliver a batch of engine events. Best-effort; never throws. */
export function deliverMonitoringIncidentEvents(events: IncidentEvent[], logger?: Logger): void {
  for (const event of events) {
    if (!shouldDeliver(event)) continue;
    try {
      deliverInApp(event, logger);
    } catch (e) {
      logger?.warn?.({ err: e }, "MONITOR_NOTIFY_INAPP_FAIL");
    }
    if (event.severity === "critical") {
      void deliverTelegram(event, logger).catch(() => {});
    }
  }
}