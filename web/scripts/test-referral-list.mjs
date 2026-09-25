#!/usr/bin/env node
// Regression for the compact Referral/Advertising list refactor.
//
// The old cards showed identity + comment + links + copy buttons + all metrics
// + finance + 4 action buttons at once. This locks in the compact list:
//   - collapsed card = identity/meta/status/created + 3-4 KPIs + 2 actions
//   - URLs and copy buttons live only in the Details modal
//   - Analytics stays a separate modal
//   - search / status+type filters / sort
//
// Usage: npm run test:referral-list

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
const count = (haystack, needle) => haystack.split(needle).length - 1;

const section = read("src/pages/admin/ReferralAliasesSection.tsx");
const css = read("src/index.css");
const dict = read("src/shared/i18n/dict.ts");

/* ── Compact collapsed card ───────────────────────────────────────────────── */

assert("compact card class is used", section.includes('className={`refCard'));
assert("old oversized card classes are gone", !section.includes("refPartnerCard__metrics") && !section.includes("refPartnerCard__finance") && !section.includes("refPartnerCard__head"));
assert("card has an expand summary with aria state", section.includes('className="refCard__summary"') && section.includes("aria-expanded={expanded}") && section.includes("aria-controls={`ref-card-"));
assert("card shows identity + meta", section.includes('className="refCard__identity"') && section.includes('className="refCard__meta"'));
assert("card meta includes the created date", section.includes("· ${created}"));
assert("card shows a compact KPI row", section.includes('className="refCard__kpis"') && section.includes('className="refCard__kpi"'));

/* ── No links/copy in the collapsed state ─────────────────────────────────── */

assert("links block renders only in the details modal", count(section, "placementLinks(") === 2 && section.includes("placementLinks(infoItem"));
const renderCardStart = section.indexOf("function renderCard");
const componentReturn = section.indexOf('return (\n    <div className="card">', renderCardStart);
const renderCardBody = renderCardStart >= 0 && componentReturn > renderCardStart ? section.slice(renderCardStart, componentReturn) : "";
assert("copy buttons are not inside the card renderer", !renderCardBody.includes("placementLinks"));
assert("no big copy buttons in collapsed cards", !renderCardBody.includes("refPartnerLinks__copy"));

/* ── Compact actions: Statistics + overflow menu ──────────────────────────── */

assert("card exposes a Statistics action", section.includes('t("admin.referral.action.stats")') && section.includes("openAnalytics(item)"));
assert("card exposes a ⋮ actions menu trigger", section.includes('className="refCard__menuBtn"') && section.includes('aria-haspopup="menu"'));
assert("actions menu has details/refresh/edit/delete", ["admin.referral.action.details", "common.refresh", "common.edit", "common.delete"].every((k) => section.includes(`t("${k}")`)) && section.includes("danger: true"));
assert("delete is confirmed", section.includes("window.confirm(t(\"admin.referral.confirm.delete\"") && dict.includes('"admin.referral.confirm.delete"'));

/* ── Details modal: links + settings + actions ────────────────────────────── */

assert("details modal exists", section.includes("detailsModal.title") && section.includes("infoItem"));
assert("details modal groups general/links/settings", ["general", "links", "settings"].every((g) => section.includes(`t("admin.referral.detailsModal.${g}")`)));
assert("details modal contains the links block", section.includes("placementLinks(infoItem"));
assert("details modal shows partner/campaign settings", section.includes('t("admin.referral.field.first_bonus")') && section.includes('t("admin.referral.field.reward")') && section.includes('t("admin.referral.field.ad_cost")'));

/* ── Analytics stays a separate modal ─────────────────────────────────────── */

assert("analytics modal is separate", section.includes("analyticsItem") && section.includes("refAnalytics__periods"));
assert("analytics funnel/finance/efficiency preserved", ["funnel", "finance", "efficiency"].every((s) => section.includes(`t("admin.referral.section.${s}")`)));
assert("analytics formulas/period semantics untouched", section.includes("registrationsConversionPct") && section.includes("roiPct") && section.includes("clicksPeriodLimited"));

/* ── Search / filters / sort ──────────────────────────────────────────────── */

assert("search input exists", section.includes('t("admin.referral.search.placeholder")') && section.includes("value={query}"));
assert("search covers name/partner/comment/campaign", section.includes("item.alias") && section.includes("item.partner_id") && section.includes("item.campaign_code") && section.includes("item.billing_comment"));
assert("status filters exist", ["all", "active", "inactive"].every((s) => section.includes("admin.referral.filter.status.${value}") || section.includes(`admin.referral.filter.status.${s}`)));
assert("type filters exist", section.includes("admin.referral.filter.type.${value}"));
assert("sort supports newest first", section.includes('t("admin.referral.sort.new")') && section.includes("setSort"));
assert("default sort is newest", section.includes('useState<SortKey>("new")'));

/* ── Responsive / no-overflow CSS ─────────────────────────────────────────── */

assert("card meta can wrap", /\.refCard__meta \{[^}]*overflow-wrap: anywhere;/.test(css));
assert("kpis wrap and shrink", /\.refCard__kpis \{[^}]*flex-wrap: wrap;/.test(css) && /\.refCard__kpi \{[^}]*min-width: 0;/.test(css));
assert("summary row is a real button reset", /\.refCard__summary \{[\s\S]*?border: 0;[\s\S]*?cursor: pointer;/.test(css));
assert("menu button is an accessible tap target", /\.refCard__menuBtn \{[\s\S]*?width: 40px;[\s\S]*?height: 40px;/.test(css));
assert("toolbar wraps on narrow screens", /@media \(max-width: 480px\) \{[\s\S]*?\.refToolbar__sort \{ margin-left: 0; width: 100%; \}/.test(css));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: compact referral list (cards, details modal, actions, search) verified");