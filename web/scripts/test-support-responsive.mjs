#!/usr/bin/env node
// Responsive regression for Admin Support ticket cards.
//
// Screenshot case: #1028 · nastya.imaikina@gmail.com · "Ждём пользователя" at ~390px.
//
// Usage: npm run test:support-responsive

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

const section = read("src/pages/admin/SupportSection.tsx");
const css = read("src/index.css");

/* ── Markup: header is a grid, not a hard row ─────────────────────────────── */

assert("ticket card uses the dedicated responsive class", section.includes("admin-ticketCard\"") || section.includes("admin-ticketCard"));
assert("header is split into title + badges blocks", section.includes("admin-ticketCard__head") && section.includes("admin-ticketCard__title") && section.includes("admin-ticketCard__badges"));
assert("ticket id and user name are separate inline spans", section.includes("admin-ticketCard__id") && section.includes("admin-ticketCard__user"));
assert("ticket id is not part of the wrapping name", section.includes('<span className="admin-ticketCard__id">#{ticket.publicNo}</span>'));
assert("status is no longer absolutely positioned over the name", !section.includes('className="list__side"') && !section.includes("list__title"));

/* ── CSS: grid + flex safety ──────────────────────────────────────────────── */

assert("header uses grid minmax(0,1fr) + auto", css.includes(".admin-ticketCard__head") && css.includes("grid-template-columns: minmax(0, 1fr) auto"));
assert("title cell has min-width: 0", /\.admin-ticketCard__title\s*\{[^}]*min-width:\s*0/.test(css));
assert("name wraps with overflow-wrap: anywhere", /\.admin-ticketCard__user[^}]*overflow-wrap:\s*anywhere/.test(css));
assert("name uses word-break: break-word", /\.admin-ticketCard__user[^}]*word-break:\s*break-word/.test(css));
assert("ticket id never breaks", /\.admin-ticketCard__id[^}]*white-space:\s*nowrap/.test(css));
assert("badges do not shrink into the text", /\.admin-ticketCard__badges\s*\{[^}]*flex-shrink:\s*0/.test(css));
assert("badge is fit-content and capped", /\.admin-ticketCard__badges \.chip\s*\{[^}]*width:\s*fit-content/.test(css) && /\.admin-ticketCard__badges \.chip\s*\{[^}]*max-width:\s*100%/.test(css));
assert("badge keeps short statuses on one line", /\.admin-ticketCard__badges \.chip\s*\{[^}]*white-space:\s*nowrap/.test(css));

/* ── Mobile stacking (covers 360 / 390 / 412) ─────────────────────────────── */

const mobile = css.slice(css.indexOf("@media (max-width: 640px)", css.indexOf(".admin-ticketCard")));
assert("mobile breakpoint exists at 640px (covers 360/390/412)", css.includes("@media (max-width: 640px)") && mobile.length > 0);
assert("mobile stacks header into one column", /\.admin-ticketCard__head\s*\{\s*grid-template-columns:\s*1fr/.test(mobile));
assert("mobile lets the name wrap normally", /\.admin-ticketCard__title\s*\{[^}]*white-space:\s*normal/.test(mobile));
assert("mobile aligns badges to the start of their own row", /\.admin-ticketCard__badges\s*\{[^}]*align-items:\s*flex-start/.test(mobile) && /\.admin-ticketCard__badges\s*\{[^}]*flex-wrap:\s*wrap/.test(mobile));

/* ── Metadata row wraps, card grows by content ────────────────────────────── */

assert("meta row exists as its own block", section.includes("admin-ticketCard__meta"));
assert("meta has relaxed line-height", /\.admin-ticketCard__meta\s*\{[^}]*line-height:/.test(css));
assert("meta wraps long values", /\.admin-ticketCard__meta\s*\{[^}]*overflow-wrap:\s*anywhere/.test(css));
assert("card grows by content (no fixed height)", !/\.admin-ticketCard\s*\{[^}]*height:/.test(css) && !/\.admin-ticketCard\s*\{[^}]*min-height:/.test(css));

/* ── No horizontal overflow ───────────────────────────────────────────────── */

assert("card clips any accidental overflow", /\.admin-ticketCard\s*\{[^}]*overflow:\s*hidden/.test(css));
assert("support card no longer relies on the fixed-width list hack", !section.includes("list__title") && !section.includes("list__side"));

console.log(`\n${failures === 0 ? "OK" : "FAILED"}: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
