// api/src/modules/serverStatus/monitoringNotifications.ts
//
// Delivers confirmed monitoring incidents through the app's admin
// notification stack:
//   - in-app admin notifications -> `notif_events` + admin recipients
//     (`listSupportNotifyRecipients`), which also power the bell/inbox;
//   - Web Push -> `sendWebPushToUser` (used by support notifications too);
//   - Telegram is intentionally not a monitoring delivery channel.
//
// Channels by severity:
//   - critical: in-app + Web Push (opened / escalated / resolved / reminder);
//   - warning:  in-app only (opened / reminder);
//   - info:     none (Recent Activity / monitoring_events only).
//
// Dedup is provided by the incident engine (one event per transition) plus a
// deterministic `event_id` so a re-delivery can never duplicate a notification.

import type { IncidentEvent } from "./incidents.js";
import { putNotifEvent, type NotifEvent } from "../../shared/linkdb/notificationsRepo.js";
import { listSupportNotifyRecipients } from "../support/notifyRepo.js";
import { sendWebPushToUser } from "../notifications/webpush.js";

type Logger = { info: (obj: unknown, msg?: string) => void; warn: (obj: unknown, msg?: string) => void };

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

function shouldDeliver(event: IncidentEvent): boolean {
  if (event.kind === "resolved") return event.severity === "critical";
  if (event.kind === "opened" || event.kind === "escalated" || event.kind === "reminder") {
    return event.severity === "critical" || event.severity === "warning";
  }
  return false;
}

export function monitoringDeliveryChannels(event: IncidentEvent): Array<"in_app" | "web_push"> {
  if (!shouldDeliver(event)) return [];
  return event.severity === "critical" ? ["in_app", "web_push"] : ["in_app"];
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

/** Deliver a batch of engine events. Best-effort; never throws. */
export function deliverMonitoringIncidentEvents(events: IncidentEvent[], logger?: Logger): void {
  for (const event of events) {
    const channels = monitoringDeliveryChannels(event);
    if (!channels.includes("in_app")) continue;
    try {
      deliverInApp(event, logger);
    } catch (e) {
      logger?.warn?.({ err: e }, "MONITOR_NOTIFY_INAPP_FAIL");
    }
  }
}
