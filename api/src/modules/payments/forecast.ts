export type PaymentForecast = {
  amount: number | null;
  date: string | null;
  currency: string;
};

function finiteNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmptyString(value: unknown): string | null {
  const result = typeof value === "string" ? value.trim() : "";
  return result || null;
}

/** SHM's root `date` is the response timestamp, not a charge date. */
export function normalizePaymentForecast(raw: unknown): PaymentForecast {
  const source = raw && typeof raw === "object" ? raw as Record<string, any> : {};
  const first = Array.isArray(source.data) && source.data.length > 0 && source.data[0] && typeof source.data[0] === "object"
    ? source.data[0] as Record<string, any>
    : {};
  const items = Array.isArray(first.items) ? first.items : [];
  const datedItems = items
    .map((item: any) => ({ date: nonEmptyString(item?.expire), amount: finiteNumber(item?.next?.total) }))
    .filter((item: { date: string | null; amount: number | null }): item is { date: string; amount: number | null } =>
      item.date !== null && Number.isFinite(Date.parse(item.date)))
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const date = datedItems[0]?.date ?? null;
  const nextDay = date?.slice(0, 10);
  const nextItems = datedItems.filter((item) => item.date.slice(0, 10) === nextDay);
  const nextCharge = nextItems.length > 0 && nextItems.every((item) => item.amount !== null)
    ? nextItems.reduce((sum, item) => sum + (item.amount ?? 0), 0)
    : null;
  const balance = finiteNumber(first.balance);

  return {
    amount: nextCharge === null || balance === null ? null : Math.max(0, nextCharge - balance),
    date,
    currency: nonEmptyString(first.currency ?? source.currency) || "RUB",
  };
}
