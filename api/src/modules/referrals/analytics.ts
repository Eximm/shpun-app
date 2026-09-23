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
// external SHM billing system, whose client (shmClient.ts) currently exposes
// only acquisition aggregates (`admin.partner.stats` / `admin.campaign.stats`).
// There is no admin-wide, user-attributed top-up / debit / commission feed, so
// financial metrics are reported as `null` and flagged in `availability` rather
// than invented. The `FinanceProvider` seam is the single place to plug a real
// feed once SHM exposes one.
//
// PERIOD MODEL: "cohort of registrations". For a selected period we take the
// users whose attribution row was created during the period and report the
// registrations in that cohort. Clicks are a lifetime counter without
// timestamps, so they are always all-time; the UI labels this explicitly.

import {
  listReferralAliases,
  countReferralRegistrationsByAliasSince,
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

export type FinanceProvider = (input: {
  alias: ReferralAlias;
  attributedUserIds: number[];
  period: AnalyticsPeriod;
  since: string | null;
}) => Promise<ReferralFinance | null> | ReferralFinance | null;

export type ReferralAnalytics = {
  aliasId: number;
  alias: string;
  linkType: "partner" | "campaign";
  period: AnalyticsPeriod;
  acquisition: {
    /** Lifetime landing counter (no timestamps -> never period-filtered). */
    clicks: number;
    /** Attributed registrations within the selected cohort window. */
    registrations: number;
    firstTopups: number | null;
    payingUsers: number | null;
    activeUsers: number | null;
    registrationsConversionPct: number | null;
    payingConversionPct: number | null;
  };
  finance: {
    totalTopups: number | null;
    serviceRevenue: number | null;
    bonusDebits: number | null;
    adCost: number | null;
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
  const clicks = Math.max(0, Math.trunc(Number(alias.visits_count) || 0));
  const registrations = Math.max(0, Math.trunc(Number(input.registrations) || 0));
  const adCost = alias.link_type === "campaign" ? Math.max(0, Number(alias.ad_cost_minor) || 0) / 100 : null;
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

  const results = await Promise.all(
    aliases.map(async (alias) => {
      const registrations = counts.get(alias.id) ?? 0;
      const finance = provider
        ? await provider({ alias, attributedUserIds: [], period, since })
        : null;
      return computeReferralAnalytics({ alias, registrations, period, finance });
    })
  );

  return results;
}