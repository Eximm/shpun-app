export const CONNECTION_ASSISTANT_SNOOZE_KEY = "connection-assistant.snoozed-until.v1";

export function isConnectionAssistantSnoozed(): boolean {
  try { return Number(localStorage.getItem(CONNECTION_ASSISTANT_SNOOZE_KEY) || "0") > Date.now(); }
  catch { return false; }
}

export function shouldOfferConnectionAssistant(items: readonly { status: string }[]): boolean {
  return !items.some((item) => item.status === "active")
    || items.some((item) => ["not_paid", "pending", "init", "error"].includes(item.status));
}
