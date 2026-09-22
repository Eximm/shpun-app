#!/usr/bin/env node
// Regression for the admin Referral/Partner card layout.
//
// Bug history: the partner stats grid used `repeat(5, minmax(118px, 1fr))`.
// The 5x118px hard minimum (622px + gaps) exceeded the card content width on
// medium desktop, so the grid overflowed the card and `overflow: hidden` on
// the card clipped the last metric ("Активные по услугам").
//
// This static check locks in the responsive, shrinkable grid:
//   - columns are `minmax(0, 1fr)` (never a hard pixel minimum)
//   - grid items can shrink (`min-width: 0`)
//   - labels/values wrap instead of expanding the column
//   - 5 / 3 / 2 columns across wide / medium / mobile breakpoints
//
// Usage: npm run test:partner-layout

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

let failures = 0;
function assert(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}

const css = fs.readFileSync(path.join(webRoot, "src", "index.css"), "utf8").replace(/\r\n/g, "\n");
const src = fs.readFileSync(
  path.join(webRoot, "src", "pages", "admin", "ReferralAliasesSection.tsx"),
  "utf8",
);

/* ── Base grid: shrinkable, no hard pixel minimum ─────────────────────────── */

assert(
  "stats grid is five fluid columns",
  css.includes(".refPartnerCard__metrics {\n  display: grid;\n  grid-template-columns: repeat(5, minmax(0, 1fr));"),
);
assert(
  "no hard pixel minimum remains in the stats grid",
  !/\.refPartnerCard__metrics\s*\{[^}]*minmax\(\s*[1-9]/.test(css),
);
assert(
  "old 118px minimum is gone",
  !css.includes("minmax(118px"),
);
assert(
  "stats grid itself can shrink",
  /\.refPartnerCard__metrics\s*\{[^}]*min-width:\s*0/.test(css),
);
assert(
  "each metric can shrink",
  /\.refPartnerCard__metric\s*\{[^}]*min-width:\s*0/.test(css),
);

/* ── Children wrap instead of pushing the layout ──────────────────────────── */

assert(
  "metric labels wrap/break long words",
  /\.refPartnerCard__metric span\s*\{[^}]*overflow-wrap:\s*anywhere/.test(css),
);
assert(
  "metric values wrap/break long words",
  /\.refPartnerCard__metric strong\s*\{[^}]*overflow-wrap:\s*anywhere/.test(css),
);
assert(
  "labels are no longer clipped by overflow:hidden",
  !/\.refPartnerCard__metric span\s*\{[^}]*overflow:\s*hidden/.test(css),
);
assert(
  "partner title wraps",
  /\.refPartnerCard__title\s*\{[^}]*overflow-wrap:\s*anywhere/.test(css),
);
assert(
  "campaign label wraps",
  /\.refPartnerCard__campaign\s*\{[^}]*overflow-wrap:\s*anywhere/.test(css),
);

/* ── Responsive breakpoints ───────────────────────────────────────────────── */

assert(
  "medium screens collapse the stats grid to three columns",
  css.includes("@media (max-width: 1100px) { .refPartnerCard__metrics { grid-template-columns: repeat(3, minmax(0,1fr)); } }"),
);
assert(
  "mobile collapses the stats grid to two columns",
  css.includes(".refPartnerCard__metrics { grid-template-columns: repeat(2, minmax(0,1fr)); }"),
);

/* ── Component wiring (static) ────────────────────────────────────────────── */

assert(
  "partner card renders the five metric tiles",
  (src.match(/refPartnerCard__metric\b/g) || []).length >= 5,
);
assert(
  "active services tile keeps its modifier",
  src.includes("refPartnerCard__metric refPartnerCard__metric--active"),
);
assert(
  "stats grid is inside the partner card",
  src.indexOf('className="refPartnerCard__metrics"') > src.indexOf('className="refPartnerCard"'),
);

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: partner card layout stays inside the card");