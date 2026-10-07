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

/**
 * SHM returns the nearest charge date at the response root and its total in
 * the first data row. Keep that upstream shape inside the API and expose the
 * small, stable contract the application actually needs.
 */
export function normalizePaymentForecast(raw: unknown): PaymentForecast {
  const source = raw && typeof raw === "object" ? raw as Record<string, any> : {};
  const first = Array.isArray(source.data) && source.data.length > 0 && source.data[0] && typeof source.data[0] === "object"
    ? source.data[0] as Record<string, any>
    : {};

  return {
    amount: finiteNumber(first.total ?? source.total ?? source.amount),
    date: nonEmptyString(source.date ?? first.date),
    currency: nonEmptyString(first.currency ?? source.currency) || "RUB",
  };
}
