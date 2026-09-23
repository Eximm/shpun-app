// api/src/modules/referrals/analytics.test.ts
//
// Coverage for the referral acquisition analytics layer:
//   - attribution isolation (source A never sees source B's users)
//   - cohort-period registration counts
//   - ad cost persistence + validation
//   - top-ups / service revenue / partner commission via the finance seam
//   - CAC / ARPPU / ROAS / ROI and every division-by-zero branch
//
// The local DB (linkdb.sqlite) is the only real source. Finance values are
// injected through the provider seam because ShpunApp has no local ledger.

import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test, { after } from "node:test";
import type { ReferralAlias } from "../../shared/linkdb/referralAliasesRepo.js";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-referral-analytics-"));
process.env.NODE_ENV = "test";

const { linkDb } = await import("../../shared/linkdb/db.js");
const {
  saveReferralAlias,
  recordReferralAliasRegistrationForUser,
} = await import("../../shared/linkdb/referralAliasesRepo.js");
const { computeReferralAnalytics, buildReferralAnalytics, periodSince, normalizePeriod } =
  await import("./analytics.js");
const { aggregateReferralFinance } = await import("./financeAggregation.js");

function fakeAlias(over: Partial<ReferralAlias> = {}): ReferralAlias {
  return {
    id: 1,
    alias: "src",
    link_type: "campaign",
    partner_id: 0,
    campaign_code: null,
    billing_comment: "Ads",
    first_payment_bonus_percent: 0,
    partner_reward_percent: 0,
    ad_cost_minor: 0,
    enabled: true,
    visits_count: 0,
    registrations_count: 0,
    created_at: "2026-01-01 00:00:00",
    updated_at: "2026-01-01 00:00:00",
    ...over,
  };
}

/* ── Formula layer ─────────────────────────────────────────────────────────── */

test("campaign: ad cost drives CAC/ROAS/ROI and contribution", () => {
  const out = computeReferralAnalytics({
    alias: fakeAlias({ link_type: "campaign", ad_cost_minor: 1_000_00, visits_count: 200 }),
    registrations: 20,
    period: "all",
    payingUsers: 10,
    finance: {
      totalTopups: 4000,
      serviceRevenue: 2500,
      bonusDebits: 300,
      partnerCommissionAccrued: null,
      partnerCommissionPaid: null,
    },
  });

  assert.equal(out.acquisition.clicks, 200);
  assert.equal(out.acquisition.registrations, 20);
  assert.equal(out.acquisition.registrationsConversionPct, 10);
  assert.equal(out.acquisition.payingConversionPct, 50);
  assert.equal(out.finance.adCost, 1000);
  assert.equal(out.finance.totalTopups, 4000);
  assert.equal(out.finance.serviceRevenue, 2500);
  assert.equal(out.finance.bonusDebits, 300);
  assert.equal(out.finance.acquisitionCost, 1000);
  assert.equal(out.finance.result, 1500);
  assert.equal(out.efficiency.cac, 100);
  assert.equal(out.efficiency.arppu, 250);
  assert.equal(out.efficiency.roasPct, 250);
  assert.equal(out.efficiency.roiPct, 150);
  assert.equal(out.availability.finance, true);
});

test("clicks are period-scoped: conversion is null for sub-periods", () => {
  const alias = fakeAlias({ link_type: "campaign", visits_count: 100 });

  const all = computeReferralAnalytics({ alias, registrations: 20, period: "all" });
  assert.equal(all.acquisition.clicks, 100);
  assert.equal(all.acquisition.allTimeClicks, 100);
  assert.equal(all.acquisition.registrations, 20);
  assert.equal(all.acquisition.registrationsConversionPct, 20);
  assert.equal(all.availability.clicksPeriodLimited, false);

  const week = computeReferralAnalytics({ alias, registrations: 5, period: "7d" });
  assert.equal(week.acquisition.clicks, null);
  assert.equal(week.acquisition.allTimeClicks, 100);
  assert.equal(week.acquisition.registrations, 5);
  // Must NOT be 5 / 100 = 5% - that would mix a cohort with a lifetime counter.
  assert.equal(week.acquisition.registrationsConversionPct, null);
  assert.equal(week.availability.clicksPeriodLimited, true);
});

test("campaign ad cost only participates in the all-time period", () => {
  const alias = fakeAlias({ link_type: "campaign", ad_cost_minor: 10_000_00, visits_count: 500 });
  const finance = {
    totalTopups: 30000,
    serviceRevenue: 25000,
    bonusDebits: 0,
    partnerCommissionAccrued: null,
    partnerCommissionPaid: null,
  };

  const all = computeReferralAnalytics({ alias, registrations: 20, period: "all", payingUsers: 10, finance });
  assert.equal(all.finance.adCost, 10000);
  assert.equal(all.finance.allTimeAdCost, 10000);
  assert.equal(all.finance.acquisitionCost, 10000);
  assert.equal(all.finance.result, 15000);
  assert.equal(all.efficiency.cac, 1000);
  assert.equal(all.efficiency.roasPct, 250);
  assert.equal(all.efficiency.roiPct, 150);
  assert.equal(all.availability.adCostPeriodLimited, false);

  const month = computeReferralAnalytics({ alias, registrations: 5, period: "30d", payingUsers: 2, finance });
  assert.equal(month.finance.adCost, null);
  assert.equal(month.finance.allTimeAdCost, 10000);
  assert.equal(month.finance.acquisitionCost, null);
  assert.equal(month.finance.result, null);
  assert.equal(month.efficiency.cac, null);
  assert.equal(month.efficiency.roasPct, null);
  assert.equal(month.efficiency.roiPct, null);
  assert.equal(month.availability.adCostPeriodLimited, true);
});

test("partner with unavailable finance produces no fake ROI/result", () => {
  const out = computeReferralAnalytics({
    alias: fakeAlias({ link_type: "partner", partner_id: 7 }),
    registrations: 4,
    period: "all",
    finance: null,
  });

  assert.equal(out.finance.adCost, null);
  assert.equal(out.finance.allTimeAdCost, null);
  assert.equal(out.finance.acquisitionCost, null);
  assert.equal(out.finance.result, null);
  assert.equal(out.efficiency.cac, null);
  assert.equal(out.efficiency.roasPct, null);
  assert.equal(out.efficiency.roiPct, null);
  assert.equal(out.availability.adCostPeriodLimited, false);
});

test("division by zero never yields NaN/Infinity", () => {
  const out = computeReferralAnalytics({
    alias: fakeAlias({ visits_count: 0, ad_cost_minor: 0 }),
    registrations: 0,
    period: "all",
    payingUsers: 0,
    finance: {
      totalTopups: 500,
      serviceRevenue: 100,
      bonusDebits: 0,
      partnerCommissionAccrued: null,
      partnerCommissionPaid: null,
    },
  });

  assert.equal(out.acquisition.registrationsConversionPct, null);
  assert.equal(out.acquisition.payingConversionPct, null);
  assert.equal(out.efficiency.cac, null);
  assert.equal(out.efficiency.arppu, null);
  assert.equal(out.efficiency.roasPct, null);
  assert.equal(out.efficiency.roiPct, null);
  // With a real zero cost, contribution is still revenue - 0.
  assert.equal(out.finance.result, 100);
  for (const value of [out.efficiency.cac, out.efficiency.roasPct, out.efficiency.roiPct]) {
    assert.ok(value === null || Number.isFinite(value));
  }
});

test("partner acquisition cost comes from accrued commission, never ad_spend", () => {
  const out = computeReferralAnalytics({
    alias: fakeAlias({ link_type: "partner", partner_id: 7, ad_cost_minor: 9_999_00 }),
    registrations: 5,
    period: "all",
    payingUsers: 2,
    finance: {
      totalTopups: 3000,
      serviceRevenue: 2000,
      bonusDebits: 0,
      partnerCommissionAccrued: 800,
      partnerCommissionPaid: 300,
    },
  });

  assert.equal(out.finance.adCost, null);
  assert.equal(out.finance.partnerCommissionAccrued, 800);
  assert.equal(out.finance.partnerCommissionPaid, 300);
  assert.equal(out.finance.acquisitionCost, 800);
  assert.equal(out.finance.result, 1200);
  assert.equal(out.efficiency.roiPct, 150);
});

test("no finance provider -> finance is flagged unavailable, not faked", () => {
  const out = computeReferralAnalytics({
    alias: fakeAlias({ visits_count: 10 }),
    registrations: 3,
    period: "all",
    finance: null,
  });

  assert.equal(out.availability.finance, false);
  assert.equal(out.availability.reason, "external_billing_not_exposed");
  assert.equal(out.availability.periodModel, "cohort_registrations");
  assert.equal(out.finance.totalTopups, null);
  assert.equal(out.finance.serviceRevenue, null);
  assert.equal(out.finance.result, null);
  assert.equal(out.efficiency.roiPct, null);
});

test("period helper normalizes unknown values to all-time", () => {
  assert.equal(normalizePeriod("30d"), "30d");
  assert.equal(normalizePeriod("bogus"), "all");
  assert.equal(normalizePeriod(undefined), "all");
  assert.equal(periodSince("all"), null);
  assert.match(String(periodSince("7d")), /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

/* ── DB-backed attribution ─────────────────────────────────────────────────── */

test("ad cost is persisted for campaigns and forced to 0 for partners", () => {
  const campaign = saveReferralAlias({
    alias: "ads_one",
    linkType: "campaign",
    partnerId: 0,
    billingComment: "Ads one",
    adCostMinor: 123_45,
  });
  assert.equal(campaign.ad_cost_minor, 123_45);

  const partner = saveReferralAlias({
    alias: "partner_one",
    linkType: "partner",
    partnerId: 11,
    adCostMinor: 500_00,
  });
  assert.equal(partner.ad_cost_minor, 0);

  assert.throws(
    () => saveReferralAlias({ alias: "ads_neg", linkType: "campaign", billingComment: "x", adCostMinor: -1 }),
    /invalid_ad_cost/
  );
});

test("buildReferralAnalytics isolates sources and applies cohort periods", async () => {
  const a = saveReferralAlias({ alias: "camp_a", linkType: "campaign", billingComment: "A", adCostMinor: 10_00 });
  const b = saveReferralAlias({ alias: "camp_b", linkType: "campaign", billingComment: "B" });

  recordReferralAliasRegistrationForUser("camp_a", 1001);
  recordReferralAliasRegistrationForUser("camp_a", 1002);
  recordReferralAliasRegistrationForUser("camp_b", 2001);

  const all = await buildReferralAnalytics("all");
  const rowA = all.find((r) => r.aliasId === a.id)!;
  const rowB = all.find((r) => r.aliasId === b.id)!;

  assert.equal(rowA.acquisition.registrations, 2);
  assert.equal(rowB.acquisition.registrations, 1);
  assert.equal(rowA.finance.adCost, 10);
  assert.equal(rowB.finance.adCost, 0);
  // No provider -> financial metrics are explicitly unavailable.
  assert.equal(rowA.availability.finance, false);
  assert.equal(rowA.finance.totalTopups, null);

  // Move one of camp_a's registrations outside the 7d window.
  linkDb
    .prepare(`UPDATE referral_alias_registrations SET created_at = datetime('now', '-100 days') WHERE alias_id = ? AND shm_user_id = ?`)
    .run(a.id, 1001);

  const week = await buildReferralAnalytics("7d");
  const weekA = week.find((r) => r.aliasId === a.id)!;
  assert.equal(weekA.acquisition.registrations, 1);
  assert.equal(week.find((r) => r.aliasId === b.id)!.acquisition.registrations, 1);

  let weekCohort: number[] = [];
  await buildReferralAnalytics("7d", (cohorts) => {
    weekCohort = cohorts.find((cohort) => cohort.alias.id === a.id)?.attributedUserIds ?? [];
    return new Map();
  });
  assert.deepEqual(weekCohort, [1002], "finance cohort must use the same period cutoff as registrations");
});

test("buildReferralAnalytics uses a batch finance provider when present", async () => {
  const alias = saveReferralAlias({ alias: "camp_fin", linkType: "campaign", billingComment: "F", adCostMinor: 50_00 });
  recordReferralAliasRegistrationForUser("camp_fin", 3001);

  let seenUserIds: number[] | null = null;
  let providerCalls = 0;
  const rows = await buildReferralAnalytics("all", (cohorts) => {
    providerCalls += 1;
    const input = cohorts.find((cohort) => cohort.alias.id === alias.id)!;
    seenUserIds = input.attributedUserIds;
    return new Map([[alias.id, {
      finance: {
        totalTopups: 1000,
        serviceRevenue: 700,
        bonusDebits: 100,
        partnerCommissionAccrued: null,
        partnerCommissionPaid: null,
      },
      firstTopups: 1,
      payingUsers: 1,
      activeUsers: 1,
    }]]);
  });

  assert.equal(providerCalls, 1, "finance provider must be called once for all aliases");
  assert.deepEqual(seenUserIds, [3001], "finance seam must receive the alias cohort");

  const row = rows.find((r) => r.aliasId === alias.id)!;
  assert.equal(row.availability.finance, true);
  assert.equal(row.finance.totalTopups, 1000);
  assert.equal(row.finance.serviceRevenue, 700);
  assert.equal(row.finance.acquisitionCost, 50);
  assert.equal(row.finance.result, 650);
  assert.equal(row.efficiency.roasPct, 1400);
  assert.equal(row.efficiency.roiPct, 1300);
});

test("SHM finance aggregation uses ledger semantics and isolates aliases", () => {
  const partner = fakeAlias({ id: 700, alias: "partner_fin", link_type: "partner", partner_id: 77 });
  const campaign = fakeAlias({ id: 701, alias: "campaign_fin", link_type: "campaign", partner_id: 0 });
  const cohorts = [
    { alias: partner, attributedUserIds: [10, 11], period: "all" as const, since: null },
    { alias: campaign, attributedUserIds: [20], period: "all" as const, since: null },
  ];
  const result = aggregateReferralFinance(cohorts, {
    pays: [
      { id: 1, user_id: 10, money: 100, date: "", pay_system_id: "manual" },
      { id: 2, user_id: 10, money: -20, date: "", pay_system_id: "manual" },
      { id: 3, user_id: 11, money: 0, date: "", pay_system_id: "declined" },
      { id: 4, user_id: 20, money: 250, date: "", pay_system_id: "manual" },
    ],
    withdraws: [
      { withdraw_id: 1, user_id: 10, total: 70, bonus: 10, paid: 1, withdraw_date: "2026-01-01" },
      { withdraw_id: 2, user_id: 11, total: 50, bonus: 0, paid: 0, withdraw_date: "" },
      { withdraw_id: 3, user_id: 20, total: 200, bonus: 25, paid: 1, withdraw_date: "2026-01-02" },
    ],
    bonuses: [
      { id: 1, user_id: 77, bonus: 30, from_user_id: 10, percent: 30, partner_commission: 1 },
      { id: 2, user_id: 77, bonus: 40, from_user_id: 999, percent: 30, partner_commission: 1 },
      { id: 3, user_id: 77, bonus: -5, from_user_id: 11, percent: 30, partner_commission: 1 },
    ],
  });

  assert.deepEqual(result.get(700), {
    finance: {
      totalTopups: 100,
      serviceRevenue: 80,
      bonusDebits: 10,
      partnerCommissionAccrued: 30,
      partnerCommissionPaid: null,
    },
    firstTopups: 1,
    payingUsers: 1,
    activeUsers: null,
  });
  assert.equal(result.get(701)?.finance.totalTopups, 250);
  assert.equal(result.get(701)?.finance.serviceRevenue, 225);
  assert.equal(result.get(701)?.finance.partnerCommissionAccrued, null);
});

/* ── HTTP route: admin-only + DTO shape ─────────────────────────────────── */

const shm = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const params = new URLSearchParams(body);
    res.setHeader("content-type", "application/json");
    if (params.get("action") === "admin.status") {
      return res.end(JSON.stringify({ is_admin: params.get("session_id") === "shm-admin" ? 1 : 0 }));
    }
    return res.end(JSON.stringify({ ok: 1 }));
  });
});
await new Promise<void>((resolve) => shm.listen(0, "127.0.0.1", resolve));
process.env.SHM_BASE = `http://127.0.0.1:${(shm.address() as { port: number }).port}/shm/`;

const Fastify = (await import("fastify")).default;
const { adminRoutes } = await import("../admin/routes.js");
const { putSession } = await import("../../shared/session/sessionStore.js");

putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 900, login: "admin", createdAt: Date.now() });
putSession("sid-user", { shmSessionId: "shm-user", shmUserId: 901, login: "user", createdAt: Date.now() });

const app = Fastify();
await app.register(async (api) => { await adminRoutes(api); }, { prefix: "/api" });

test("analytics endpoint is admin-only", async () => {
  const anon = await app.inject({ method: "GET", url: "/api/admin/referral-aliases/analytics" });
  assert.equal(anon.statusCode, 401);

  const user = await app.inject({
    method: "GET",
    url: "/api/admin/referral-aliases/analytics",
    headers: { "x-app-sid": "sid-user" },
  });
  assert.equal(user.statusCode, 403);
});

test("analytics endpoint returns DTO with explicit finance availability", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/admin/referral-aliases/analytics?period=all",
    headers: { "x-app-sid": "sid-admin" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.period, "all");
  assert.equal(body.periodModel, "cohort_registrations");
  assert.equal(body.financeAvailable, false);
  assert.ok(Array.isArray(body.items));

  const row = body.items.find((r: any) => r.alias === "camp_a");
  assert.ok(row, "known alias must be present");
  assert.equal(row.finance.totalTopups, null);
  assert.equal(row.finance.serviceRevenue, null);
  assert.equal(row.availability.finance, false);
  assert.equal(row.availability.reason, "external_billing_not_exposed");
});

test("analytics endpoint marks clicks/ad cost as period-limited for 7d", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/admin/referral-aliases/analytics?period=7d",
    headers: { "x-app-sid": "sid-admin" },
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.period, "7d");
  const row = body.items.find((r: any) => r.alias === "camp_a");
  assert.ok(row);
  // Clicks are not period-filterable -> null, never a lifetime value reused as period data.
  assert.equal(row.acquisition.clicks, null);
  assert.equal(row.acquisition.registrationsConversionPct, null);
  assert.equal(row.availability.clicksPeriodLimited, true);
  assert.equal(typeof row.acquisition.allTimeClicks, "number");
  // Campaign total spend must not be attributed to the period.
  assert.equal(row.finance.adCost, null);
  assert.equal(row.finance.acquisitionCost, null);
  assert.equal(row.availability.adCostPeriodLimited, true);
});

after(async () => {
  await app.close();
  await new Promise<void>((resolve) => shm.close(() => resolve()));
});
