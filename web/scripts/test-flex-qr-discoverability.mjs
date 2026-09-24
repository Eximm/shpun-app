#!/usr/bin/env node
// Regression for the Flex connector "connection options" entry point.
//
// History:
//   v1 - QR/backup options hidden behind an ambiguous circular "i" button.
//   v2 - a separate "QR и резервные способы" pill duplicated the selector.
//   v3 - consolidated to one selector, but with too many permanent captions.
//   v4 - one self-explanatory selector ("Happ · QR и резервы"), layout-bound
//        first-run callout.
//   v5 - the QR/links section simplified: one short helper, no per-group
//        headings, no routing explanation, a 2x2 action grid.
//
// Usage: npm run test:flex-qr-discoverability

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

const connector = read("src/pages/connect/ConnectMarzban.tsx");
const css = read("src/index.css");
const dict = read("src/shared/i18n/dict.ts");

/* ── One entry point, no duplication ──────────────────────────────────────── */

assert("no separate QR pill button", !connector.includes("cm__qrBtn"));
assert("no leftover circular info button", !connector.includes("cm__selectorInfo"));
assert("no second modal state", !connector.includes("clientHelpOpen"));
assert("no second modal markup", !connector.includes("cm__clientHelpModal"));
assert("the app selector is the only connection entry", connector.includes("onClick={() => setClientPickerOpen(true)}"));
assert("QR/backup content has a single source", count(connector, "const manualQrBlock") === 1);
assert("QR/backup content is rendered once", count(connector, "{manualQrBlock}") === 1);

/* ── Self-explanatory selector, no permanent captions ─────────────────────── */

assert("selector shows the app + QR/backup suffix", connector.includes("selectedClient.title") && connector.includes('t("connectMarzban.client.qr_suffix")'));
assert("no permanent helper line", !connector.includes("cm__selectorHelper") && !connector.includes('t("connectMarzban.client.helper")'));
assert("no permanent connection-options label", !connector.includes('t("connectMarzban.client.label")'));

/* ── One modal, logically grouped (functionality unchanged) ───────────────── */

assert("modal groups recommended app", connector.includes('t("connectMarzban.client.recommended_title")'));
assert("modal groups other apps", connector.includes('t("connectMarzban.client.other_title")'));
assert("modal groups QR and links", connector.includes('t("connectMarzban.client.qr_title")'));

/* ── QR/links section simplified ──────────────────────────────────────────── */

assert("one short helper line", connector.includes('t("connectMarzban.qr.helper")'));
assert("no routing explanation text", !connector.includes('t("connectMarzban.manual.desc")') && !connector.includes('t("connectMarzban.manual.happ_only_desc")'));
assert("no per-group headings", !connector.includes('t("connectMarzban.qr.primary_title")') && !connector.includes('t("connectMarzban.qr.reserve_title")'));
assert("no old reserve sub-block", !connector.includes("cm__manualReserve"));
assert("2x2 action grid", connector.includes('className="cm__qrGrid"'));
assert("four clear actions present", ["manual.primary_link", "manual.reserve_link", "manual.primary_qr", "manual.reserve_qr"].every((k) => connector.includes(`connectMarzban.${k}`)));
assert("reserve actions are optional (collapse when absent)", count(connector, "reserveSubscriptionUrl && (") === 2);

/* ── First-run callout: kept, dismissible, layout-bound pointer ───────────── */

assert("first-run callout exists", connector.includes('className="cm__qrHint"'));
assert("hint is gated on first run", connector.includes("ready && !qrHintSeen"));
assert("hint has a dismiss handler", connector.includes("dismissQrHint") && connector.includes("onClick={dismissQrHint}"));
assert("dismiss persists locally", connector.includes("localStorage.setItem(QR_HINT_STORAGE_KEY"));
assert("storage key is versioned", connector.includes('"shpun.connect.qr_hint_seen_v1"'));
assert("hint is not hover-only", !connector.includes("onMouseEnter") && connector.includes('role="status"'));
assert("pointer is layout-bound, not a left-edge glyph", !connector.includes("cm__qrHintArrow"));
assert("pointer uses a selector-column variable", css.includes("--cm-qr-hint-arrow-x") && css.includes("left: var(--cm-qr-hint-arrow-x)"));
assert("pointer targets the right column on wide screens", /\.cm__qrHint \{[\s\S]*?--cm-qr-hint-arrow-x: 75%;/.test(css));
assert("pointer follows the single-column mobile layout", /@media \(max-width: 560px\) \{[\s\S]*?\.cm__qrHint \{ --cm-qr-hint-arrow-x: 50%; \}/.test(css));

/* ── Responsive / mobile-safe CSS ─────────────────────────────────────────── */

assert("selector item aligns to the bottom (no jump)", /\.cm__selectorItem \{[\s\S]*?align-content: end;/.test(css));
assert("QR grid can shrink without overflow", /\.cm__qrAction \{[\s\S]*?min-width: 0;[\s\S]*?overflow-wrap: anywhere;/.test(css));
assert("QR grid collapses on the narrowest screens", /@media \(max-width: 380px\) \{[\s\S]*?\.cm__qrGrid \{ grid-template-columns: 1fr; \}/.test(css));
assert("hint exists in CSS", css.includes(".cm__qrHint {") && css.includes(".cm__qrHintClose {"));
assert("dead pill CSS is removed", !css.includes(".cm__qrBtn"));
assert("dead helper CSS is removed", !css.includes(".cm__selectorHelper"));
assert("dead reserve-block CSS is removed", !css.includes(".cm__manualReserve"));

/* ── i18n: new key present, dead keys removed ─────────────────────────────── */

for (const key of [
  "connectMarzban.client.qr_suffix",
  "connectMarzban.client.modal_title",
  "connectMarzban.client.recommended_title",
  "connectMarzban.client.other_title",
  "connectMarzban.client.qr_title",
  "connectMarzban.qr.helper",
  "connectMarzban.qr.hint_title",
  "connectMarzban.qr.hint_text",
]) {
  assert(`RU has ${key}`, dict.includes(`"${key}":`));
}
for (const key of [
  "connectMarzban.client.label",
  "connectMarzban.client.helper",
  "connectMarzban.qr.button",
  "connectMarzban.qr.button_aria",
  "connectMarzban.qr.title",
  "connectMarzban.qr.primary_title",
  "connectMarzban.qr.reserve_title",
  "connectMarzban.manual.title",
  "connectMarzban.manual.desc",
  "connectMarzban.manual.happ_only_desc",
  "connectMarzban.client.button",
  "connectMarzban.client.help_aria",
  "connectMarzban.client.help_title",
  "connectMarzban.client.help_text",
  "connectMarzban.client.help_route",
  "connectMarzban.client.help_action",
]) {
  assert(`dead key removed: ${key}`, !dict.includes(`"${key}":`));
}
assert("RU QR helper wording", dict.includes('"connectMarzban.qr.helper": "Здесь можно скопировать ссылку'));
assert("EN QR helper wording", dict.includes('"connectMarzban.qr.helper": "Copy a link for manual import'));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: Flex connection options (one selector, simplified QR grid, layout-bound callout) verified");