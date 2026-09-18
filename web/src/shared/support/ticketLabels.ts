// web/src/shared/support/ticketLabels.ts
//
// Single source of truth for context-aware ticket status labels.
//
// The internal enum stays `open / in_progress / waiting_staff / waiting_user /
// resolved / closed`. The visible label depends on the audience:
//   - user: "Получено" for a freshly created ticket reads better than "Открыт";
//   - admin: "Открыт" is the accurate operational label.
// Keeping the mapping here avoids sprinkling hardcoded labels across screens.

import type { useI18n } from "../i18n";

export type TicketStatus =
  | "open"
  | "in_progress"
  | "waiting_user"
  | "waiting_staff"
  | "resolved"
  | "closed";

export type TicketAudience = "user" | "admin";

export const TICKET_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "waiting_user",
  "waiting_staff",
  "resolved",
  "closed",
];

type TFn = ReturnType<typeof useI18n>["t"];

const ADMIN_KEYS: Record<TicketStatus, string> = {
  open: "ticket.status.admin.open",
  in_progress: "ticket.status.admin.in_progress",
  waiting_user: "ticket.status.admin.waiting_user",
  waiting_staff: "ticket.status.admin.waiting_staff",
  resolved: "ticket.status.admin.resolved",
  closed: "ticket.status.admin.closed",
};

const USER_KEYS: Record<TicketStatus, string> = {
  open: "ticket.status.user.open",
  in_progress: "ticket.status.user.in_progress",
  waiting_user: "ticket.status.user.waiting_user",
  waiting_staff: "ticket.status.user.waiting_staff",
  resolved: "ticket.status.user.resolved",
  closed: "ticket.status.user.closed",
};

export function ticketStatusLabel(status: string, audience: TicketAudience, t: TFn): string {
  const keys = audience === "admin" ? ADMIN_KEYS : USER_KEYS;
  const key = keys[status as TicketStatus];
  return key ? t(key) : status;
}