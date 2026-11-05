export type ReturnBonusState = { pending: boolean; applied: boolean; tariffActivated: boolean; userServiceId: number; tariffId: number; days: number; percent: number };
export type ReturnBonusService = { userServiceId: number; serviceId: number; title: string; status: string; expireAt?: string | null; nextServiceId?: number | null; autoBill?: boolean };
export function returnBonusService(items: readonly ReturnBonusService[], bonus: ReturnBonusState | null | undefined) {
  if (!bonus?.tariffActivated || !bonus.userServiceId) return null;
  return items.find((item) => item.userServiceId === bonus.userServiceId && item.serviceId === bonus.tariffId && item.status !== 'removed') ?? null;
}
export function renewalCoverage(balance: number, price: number | null, discount = 0, bonus = 0, bonusLimitPercent = 0) {
  if (price == null || !Number.isFinite(price) || price < 0 || !Number.isFinite(balance)) return null;
  const total = Math.round(price * (1 - Math.max(0, Math.min(100, discount)) / 100) * 100) / 100;
  const bonusUsed = balance > 0 ? Math.min(Math.max(0, bonus), Math.floor(total * Math.max(0, Math.min(100, bonusLimitPercent))) / 100) : 0;
  const amount = Math.round((total - bonusUsed) * 100) / 100;
  return { amount, bonusUsed, total, sufficient: balance >= amount, shortage: Math.max(0, Math.ceil((amount - balance) * 100) / 100) };
}
