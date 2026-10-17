import { useCallback } from "react";
import { useMe } from "../../app/auth/useMe";
import { useI18n } from "../i18n";

/** Formats amounts already denominated by the API in the account currency.
 * Currency conversion belongs to billing/API, never to a symbol replacement.
 */
export function useAccountMoney() {
  const { me } = useMe();
  const { formatCurrency } = useI18n();
  const currency = me?.balance?.currency || "RUB";
  return useCallback((amount: number) => formatCurrency(amount, currency), [currency, formatCurrency]);
}
