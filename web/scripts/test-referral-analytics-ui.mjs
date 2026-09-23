#!/usr/bin/env node
// Regression for the admin Referral/Partner analytics UI (v1).
//
// Locks in:
//   - a compact financial summary on each card (ad spend / commission / ROI)
//   - a "Statistics" action that opens a details modal
//   - funnel / finance / efficiency sections with a period selector
//   - an explicit "finance source unavailable" note (ShpunApp has no ledger)
//   - a responsive, non-overflowing layout for the new blocks
//
// Usage: npm run test:referral-analytics-ui

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

const read = (rel) => fs.readFileSync(path.join(webRoot, rel), "utf8").replace(/\r\n?/g, "\n");

let failures = 0;
function assert(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}

const section = read("src/pages/admin/ReferralAliasesSection.tsx");
const css = read("src/index.css");
const dict = read("src/shared/i18n/dict.ts");

/* ── Card summary ─────────────────────────────────────────────────────────── */

assert("card shows a compact finance strip", section.includes('className="refPartnerCard__finance"'));
assert("campaign card exposes ad spend", section.includes('t("admin.referral.metric.ad_cost")'));
assert("partner card exposes accrued/paid commission", section.includes('t("admin.referral.metric.commission_accrued")') && section.includes('t("admin.referral.metric.commission_paid")'));
assert("card exposes a positive/negative tone helper", section.includes("is-positive") && section.includes("is-negative"));

/* ── Details action + modal ───────────────────────────────────────────────── */

assert("cards have a Statistics action", section.includes('t("admin.referral.action.stats")'));
assert("Statistics opens a modal", section.includes("<ModalShell") && section.includes("setDetailsItem(item)"));
assert("modal has a period selector", section.includes("ANALYTICS_PERIODS.map") && section.includes("setDetailsPeriod"));
assert("modal renders funnel section", section.includes('t("admin.referral.section.funnel")'));
assert("modal renders finance section", section.includes('t("admin.referral.section.finance")'));
assert("modal renders efficiency section", section.includes('t("admin.referral.section.efficiency")'));
assert("modal shows CAC / ARPPU / ROAS / ROI", ["cac", "arppu", "roas", "roi"].every((k) => section.includes(`admin.referral.metric.${k}`)));
assert("modal flags unavailable finance instead of faking it", section.includes('t("admin.referral.finance.unavailable")'));
assert("null values render as an em dash, not 0", section.includes('const dash = "—"') && section.includes("value === null ? dash"));
assert("zero is formatted, not dashed", section.includes("value === null ? dash : formatCurrency(value)") && section.includes("value === null ? dash : formatNumber(value)"));

/* ── Period semantics: clicks + ad cost are not leak across periods ──────── */

assert("UI reads clicksPeriodLimited from availability", section.includes("availability.clicksPeriodLimited"));
assert("UI reads adCostPeriodLimited from availability", section.includes("availability.adCostPeriodLimited"));
assert("all-time clicks row exists", section.includes('t("admin.referral.metric.clicks_all_time")'));
assert("all-time ad spend row exists", section.includes('t("admin.referral.metric.ad_cost_all_time")'));
assert("clicks-period note is shown", section.includes('t("admin.referral.period.clicks_note")'));
assert("ad-cost-period note is shown", section.includes('t("admin.referral.period.ad_cost_note")'));
assert("period model is explicitly described", section.includes('t("admin.referral.period.model")'));

/* ── Form: manual ad cost (campaign only) ─────────────────────────────────── */

assert("form has an ad cost field for campaigns", section.includes('t("admin.referral.field.ad_cost")'));
assert("ad cost is sent as integer minor units", section.includes("adCostMinor: form.linkType === \"campaign\""));
assert("ad cost input is sanitized to money", section.includes("sanitizeMoneyInput"));

/* ── Responsive, overflow-safe CSS ────────────────────────────────────────── */

assert("finance strip wraps instead of overflowing", /\.refPartnerCard__finance \{[\s\S]*?flex-wrap: wrap;/.test(css));
assert("finance items can shrink", /\.refPartnerCard__financeItem \{[^}]*min-width: 0;/.test(css));
assert("analytics rows allow label wrapping", /\.refAnalytics__row span \{[^}]*overflow-wrap: anywhere;/.test(css));
assert("analytics modal sections exist", css.includes(".refAnalytics__section") && css.includes(".refAnalytics__value"));
assert("period chip is a real button reset", css.includes(".refAnalytics__periods .chip { font: inherit;"));

/* ── i18n parity for the new keys ─────────────────────────────────────────── */

for (const key of [
  "admin.referral.action.stats",
  "admin.referral.section.funnel",
  "admin.referral.section.finance",
  "admin.referral.section.efficiency",
  "admin.referral.finance.unavailable",
  "admin.referral.field.ad_cost",
  "admin.referral.metric.clicks_all_time",
  "admin.referral.metric.ad_cost_all_time",
  "admin.referral.period.clicks_note",
  "admin.referral.period.ad_cost_note",
]) {
  assert(`RU has ${key}`, dict.includes(`"${key}":`));
}
assert("EN clicks_all_time present", dict.includes('"admin.referral.metric.clicks_all_time": "Clicks (all time)"'));
assert("EN ad_cost_all_time present", dict.includes('"admin.referral.metric.ad_cost_all_time": "Ad spend (all time)"'));
assert("EN action.stats present", dict.includes('"admin.referral.action.stats": "Statistics"'));
assert("EN finance.unavailable present", dict.includes('"admin.referral.finance.unavailable":'));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: referral analytics UI (summary + details + responsive) verified");