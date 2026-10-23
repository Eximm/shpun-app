import { flexPrimaryService, visibleFlexServices } from "./flexPrimaryImport";

export const CONNECTION_ASSISTANT_SNOOZE_KEY = "connection-assistant.snoozed-until.v1";

export function selectConnectionService<T extends { userServiceId: number; category: string; parent?: number | null; status: string }>(items: readonly T[], targetUsi = 0): T | null {
  const targeted = items.find((item) => item.userServiceId === targetUsi && item.status !== "removed");
  if (targeted) return flexPrimaryService(targeted, items);
  const weight: Record<string, number> = { active: 0, pending: 1, init: 2, not_paid: 3, blocked: 4, error: 5 };
  return visibleFlexServices(items)
    .filter((item) => item.status !== "removed")
    .sort((a, b) => (weight[a.status] ?? 99) - (weight[b.status] ?? 99))[0] ?? null;
}

export function isConnectionAssistantSnoozed(): boolean {
  try { return Number(localStorage.getItem(CONNECTION_ASSISTANT_SNOOZE_KEY) || "0") > Date.now(); }
  catch { return false; }
}

export function shouldOfferConnectionAssistant(items: readonly { status: string }[]): boolean {
  return !items.some((item) => item.status === "active")
    || items.some((item) => ["not_paid", "pending", "init", "error"].includes(item.status));
}
