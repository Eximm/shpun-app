/** Formatting only. Values must already be denominated in the supplied currency. */
export function moneyText(value: unknown, currency: string = "RUB") {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  const code = /^[A-Z]{3}$/.test(String(currency).toUpperCase()) ? String(currency).toUpperCase() : "RUB";
  return new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: code, minimumFractionDigits: 0, maximumFractionDigits: 2,
  }).format(amount);
}
