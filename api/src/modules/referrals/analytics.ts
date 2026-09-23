// api/src/modules/referrals/analytics.ts
//
// Acquisition + (where available) financial analytics for referral aliases.
//
// Data sources (audit of ShpunApp's own SQLite, linkdb.sqlite):
//   - referral_aliases               -> alias config, all-time `visits_count`
//   - referral_alias_registrations   -> canonical user↔alias attribution
//
// NOTE ON MONEY: ShpunApp does not store any financial/ledger tables locally.
// Balance, top-ups, service debits, bonuses and partner commissions live in the
// external SHM billing system. `shmFinanceProvider.ts` reads its bounded,
// admin-only `admin.finance.feed` and maps ledger rows to this domain model.
// If that feed is unavailable or on an incompatible template version, the
// route deliberately falls back to `null` financial metrics.
//
// PERIOD MODEL: "cohort of registrations". A selected period means "users whose
// attribution row was created during that period", NOT "financial events during
// the period".
//
// TWO VALUES HAVE NO HISTORY:
//   - visits_count (clicks) is a lifetime counter only. For 7d/30d/90d the
//     period-scoped `clicks` is null and `registrationConversionPct` is null;
//     the lifetime value is exposed separately as `allTimeClicks` (display only).
//   - ad_cost_minor (campaign spend) is one total per campaign with no spend
//     history. For 7d/30d/90d the period `adCost`/`acquisitionCost` are null and
//     CAC/ROAS/ROI/result collapse to null; the total is exposed as
//     `allTimeAdCost` (display only). Spend is never pro-rated over a period.

import {
  listReferralAliases,
  countReferralRegistrationsByAliasSince,
  listReferralAliasUserIdsByAlias,
  type ReferralAlias,
} from "../../shared/linkdb/referralAliasesRepo.js";

export type AnalyticsPeriod = "7d" | "30d" | "90d" | "all";
export const ANALYTICS_PERIODS: readonly AnalyticsPeriod[] = ["7d", "30d", "90d", "all"] as const;

export function normalizePeriod(value: unknown): AnalyticsPeriod {
  const raw = String(value ?? "").trim().toLowerCase();
  return (ANALYTICS_PERIODS as readonly string[]).includes(raw)
    ? (raw as AnalyticsPeriod)
    : "all";
}

/** UTC cutoff in the same textual format SQLite `datetime('now')` produces. */
export function periodSince(period: AnalyticsPeriod, now: Date = new Date()): string | null {
  const days = period === "7d" ? 7 : period === "30d" ? 30 : period === "90d" ? 90 : 0;
  if (!days) return null;
  const cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return cutoff.toISOString().slice(0, 19).replace("T", " ");
}

/** Money values are major units (RUB). `null` means "unknown / not available". */
export type ReferralFinance = {
  totalTopups: number | null;
  serviceRevenue: number | null;
  bonusDebits: number | null;
  partnerCommissionAccrued: number | null;
  partnerCommissionPaid: number | null;
};

/**
 * Finance seam. This is deliberately a DOMAIN contract (normalized aggregate
 * values per alias), not a transport/DTO contract: it never mentions SHM
 * actions, feed pages or response field names. When the billing contract is
 * final, exactly one adapter (elsewhere) maps SHM -> ReferralFinance and is
 * passed here. An adapter may aggregate per-user events (topups, service debits,
 * bonus debits, commission) but the seam only receives the domain result.
 */
export type FinanceCohort = {
  alias: ReferralAlias;
  attributedUserIds: number[];
  period: AnalyticsPeriod;
  since: string | null;
};

export type ReferralFinanceSnapshot = {
  finance: ReferralFinance;
  firstTopups: number;
  payingUsers: number;
  activeUsers: number | null;
};

/** A provider receives every cohort at once so SHM can be queried in batches. */
export type FinanceProvider = (
  cohorts: FinanceCohort[]
) => Promise<Map<number, ReferralFinanceSnapshot | null>> | Map<number, ReferralFinanceSnapshot | null>;

export type ReferralAnalytics = {
  aliasId: number;
  alias: string;
  linkType: "partner" | "campaign";
  period: AnalyticsPeriod;
  acquisition: {
    /** Period-scoped clicks. `null` for 7d/30d/90d (no click history). */
    clicks: number | null;
    /** Lifetime landing counter; display-only, never used in period math. */
    allTimeClicks: number;
    /** Attributed registrations within the selected cohort window. */
    registrations: number;
    firstTopups: number | null;
    payingUsers: number | null;
    activeUsers: number | null;
    /** Only defined when period-scoped clicks exist (period === "all"). */
    registrationsConversionPct: number | null;
    payingConversionPct: number | null;
  };
  finance: {
    totalTopups: number | null;
    serviceRevenue: number | null;
    bonusDebits: number | null;
    /** Period-scoped campaign spend. `null` unless period === "all". */
    adCost: number | null;
    /** Campaign total spend; display-only, never used in period math. */
    allTimeAdCost: number | null;
    partnerCommissionAccrued: number | null;
    partnerCommissionPaid: number | null;
    acquisitionCost: number | null;
    result: number | null;
  };
  efficiency: {
    cac: number | null;
    arppu: number | null;
    roasPct: number | null;
    roiPct: number | null;
  };
  availability: {
    finance: boolean;
    reason: "external_billing_not_exposed" | "no_finance_data" | null;
    periodModel: "cohort_registrations";
    /** True when period-scoped clicks are unavailable (7d/30d/90d). */
    clicksPeriodLimited: boolean;
    /** True when campaign spend is only available for the whole campaign. */
    adCostPeriodLimited: boolean;
  };
};

function divide(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null) return null;
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) return null;
  return numerator / denominator;
}

/** Pure formula layer. Kept side-effect free so every division-by-zero case is testable. */
export function computeReferralAnalytics(input: {
  alias: ReferralAlias;
  registrations: number;
  period: AnalyticsPeriod;
  activeUsers?: number | null;
  firstTopups?: number | null;
  payingUsers?: number | null;
  finance?: ReferralFinance | null;
}): ReferralAnalytics {
  const { alias, period } = input;
  const allTimeClicks = Math.max(0, Math.trunc(Number(alias.visits_count) || 0));
  // Period-scoped clicks exist only for the all-time view: the local model keeps
  // no timestamped click history, so a 7d/30d/90d click count would be a lie.
  const clicks = period === "all" ? allTimeClicks : null;
  const registrations = Math.max(0, Math.trunc(Number(input.registrations) || 0));
  const allTimeAdCost = alias.link_type === "campaign"
    ? Math.max(0, Number(alias.ad_cost_minor) || 0) / 100
    : null;
  // Campaign spend is stored once for the whole campaign; it must not be
  // attributed to a sub-period without a real spend history.
  const adCost = period === "all" ? allTimeAdCost : null;
  const finance = input.finance ?? null;

  const totalTopups = finance ? finance.totalTopups : null;
  const serviceRevenue = finance ? finance.serviceRevenue : null;
  const bonusDebits = finance ? finance.bonusDebits : null;
  const partnerCommissionAccrued = finance ? finance.partnerCommissionAccrued : null;
  const partnerCommissionPaid = finance ? finance.partnerCommissionPaid : null;

  const acquisitionCost =
    alias.link_type === "campaign"
      ? adCost
      : (partnerCommissionAccrued ?? null);

  const registrationsConversionPct = divide(registrations * 100, clicks);
  const payingConversionPct = divide(
    input.payingUsers === undefined || input.payingUsers === null ? null : input.payingUsers * 100,
    registrations || null
  );

  const result =
    serviceRevenue !== null && acquisitionCost !== null
      ? serviceRevenue - acquisitionCost
      : null;

  const cac = divide(acquisitionCost, input.payingUsers ?? null);
  const arppu = divide(serviceRevenue, input.payingUsers ?? null);
  const roasPct =
    acquisitionCost !== null && acquisitionCost > 0
      ? divide(serviceRevenue, acquisitionCost / 100)
      : null;
  const roiPct =
    acquisitionCost !== null && acquisitionCost > 0 && serviceRevenue !== null
      ? ((serviceRevenue - acquisitionCost) / acquisitionCost) * 100
      : null;

  const financeAvailable = Boolean(finance);

  return {
    aliasId: alias.id,
    alias: alias.alias,
    linkType: alias.link_type,
    period,
    acquisition: {
      clicks,
      allTimeClicks,
      registrations,
      firstTopups: input.firstTopups ?? null,
      payingUsers: input.payingUsers ?? null,
      activeUsers: input.activeUsers ?? null,
      registrationsConversionPct,
      payingConversionPct,
    },
    finance: {
      totalTopups,
      serviceRevenue,
      bonusDebits,
      adCost,
      allTimeAdCost,
      partnerCommissionAccrued,
      partnerCommissionPaid,
      acquisitionCost,
      result,
    },
    efficiency: {
      cac,
      arppu,
      roasPct,
      roiPct,
    },
    availability: {
      finance: financeAvailable,
      reason: financeAvailable ? null : "external_billing_not_exposed",
      periodModel: "cohort_registrations",
      clicksPeriodLimited: period !== "all",
      adCostPeriodLimited: alias.link_type === "campaign" && period !== "all",
    },
  };
}

/**
 * Assemble analytics for every alias with a single grouped attribution query
 * (no N+1) plus an optional batched finance provider.
 */
export async function buildReferralAnalytics(
  period: AnalyticsPeriod,
  provider?: FinanceProvider
): Promise<ReferralAnalytics[]> {
  const aliases = listReferralAliases();
  const since = periodSince(period);
  const counts = countReferralRegistrationsByAliasSince(since);
  // Only needed when a finance adapter is in play; one grouped query, no N+1.
  const userIdsByAlias = provider ? listReferralAliasUserIdsByAlias(since) : null;
  const cohorts: FinanceCohort[] = provider
    ? aliases.map((alias) => ({
        alias,
        attributedUserIds: userIdsByAlias?.get(alias.id) ?? [],
        period,
        since,
      }))
    : [];
  const financeByAlias = provider ? await provider(cohorts) : new Map<number, ReferralFinanceSnapshot | null>();

  const results = aliases.map((alias) => {
    const registrations = counts.get(alias.id) ?? 0;
    const snapshot = financeByAlias.get(alias.id) ?? null;
    return computeReferralAnalytics({
      alias,
      registrations,
      period,
      finance: snapshot?.finance ?? null,
      firstTopups: snapshot?.firstTopups ?? null,
      payingUsers: snapshot?.payingUsers ?? null,
      activeUsers: snapshot?.activeUsers ?? null,
    });
  });

  return results;
}
