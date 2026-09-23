import type { FinanceCohort, ReferralFinanceSnapshot } from "./analytics.js";

export type FinanceFeed = {
  pays: Array<{ id: number; user_id: number; money: number; date: string; pay_system_id: string }>;
  withdraws: Array<{
    withdraw_id: number;
    user_id: number;
    total: number;
    bonus: number;
    paid: number | boolean;
    withdraw_date: string;
  }>;
  bonuses: Array<{
    id: number;
    user_id: number;
    bonus: number;
    from_user_id: number;
    percent: number;
    partner_commission: number | boolean;
  }>;
};

export function positiveFinanceId(value: unknown): number {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function finiteNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** Pure attribution/aggregation layer; no network or billing side effects. */
export function aggregateReferralFinance(
  cohorts: FinanceCohort[],
  feed: FinanceFeed
): Map<number, ReferralFinanceSnapshot | null> {
  const out = new Map<number, ReferralFinanceSnapshot | null>();

  for (const cohort of cohorts) {
    const userIds = new Set(cohort.attributedUserIds.map(positiveFinanceId).filter(Boolean));
    const payingUserIds = new Set<number>();
    let totalTopups = 0;
    let serviceRevenue = 0;
    let bonusDebits = 0;

    for (const row of feed.pays) {
      const userId = positiveFinanceId(row.user_id);
      const money = finiteNumber(row.money);
      if (userIds.has(userId) && money > 0) {
        totalTopups += money;
        payingUserIds.add(userId);
      }
    }

    for (const row of feed.withdraws) {
      const userId = positiveFinanceId(row.user_id);
      const paid = Boolean(row.paid) || Boolean(String(row.withdraw_date ?? "").trim());
      if (!userIds.has(userId) || !paid) continue;
      serviceRevenue += finiteNumber(row.total) + finiteNumber(row.bonus);
      bonusDebits += finiteNumber(row.bonus);
    }

    let partnerCommissionAccrued: number | null = null;
    if (cohort.alias.link_type === "partner") {
      const partnerId = positiveFinanceId(cohort.alias.partner_id);
      partnerCommissionAccrued = 0;
      for (const row of feed.bonuses) {
        if (!row.partner_commission || finiteNumber(row.bonus) <= 0) continue;
        if (positiveFinanceId(row.user_id) !== partnerId) continue;
        if (!userIds.has(positiveFinanceId(row.from_user_id))) continue;
        partnerCommissionAccrued += finiteNumber(row.bonus);
      }
    }

    out.set(cohort.alias.id, {
      finance: {
        totalTopups,
        serviceRevenue,
        bonusDebits,
        partnerCommissionAccrued,
        partnerCommissionPaid: null,
      },
      firstTopups: payingUserIds.size,
      payingUsers: payingUserIds.size,
      // A paid historical withdrawal does not prove the service is active now.
      // Keep this unknown until a batched current-service source exists.
      activeUsers: null,
    });
  }

  return out;
}
