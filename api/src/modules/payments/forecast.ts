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
  const dates = items
    .map((item: any) => nonEmptyString(item?.expire))
    .filter((date: string | null): date is string => date !== null && Number.isFinite(Date.parse(date)))
    .sort((a: string, b: string) => Date.parse(a) - Date.parse(b));
  const date = dates[0] ?? null;

  return {
    amount: date ? finiteNumber(first.total) : null,
    date,
    currency: nonEmptyString(first.currency ?? source.currency) || "RUB",
  };
}
