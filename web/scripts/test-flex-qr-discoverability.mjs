#!/usr/bin/env node
// Regression for the Flex connector "connection options" entry point.
//
// History:
//   v1 - QR/backup options hidden behind an ambiguous circular "i" button.
//   v2 - a separate "QR и резервные способы" pill duplicated the selector.
//   v3 - consolidated to one selector, but with too many permanent captions
//        (label + helper + selector value) causing visual noise and height jumps.
//   v4 - one self-explanatory selector ("Happ · QR и резервы"), no permanent
//        helper/label; the only extra explanation is the first-run callout,
//        whose pointer is layout-bound to the selector column.
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
assert("star icon stays on the recommended client", connector.includes("selectedClient.icon"));

/* ── One modal, logically grouped (functionality unchanged) ───────────────── */

assert("modal groups recommended app", connector.includes('t("connectMarzban.client.recommended_title")'));
assert("modal groups other apps", connector.includes('t("connectMarzban.client.other_title")'));
assert("modal groups QR and links", connector.includes('t("connectMarzban.client.qr_title")'));
assert("modal includes the shared QR/backup block", connector.includes("{manualQrBlock}"));
assert("QR block keeps primary + reserve groups", connector.includes('t("connectMarzban.qr.primary_title")') && connector.includes('t("connectMarzban.qr.reserve_title")'));

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
assert("hint exists in CSS", css.includes(".cm__qrHint {") && css.includes(".cm__qrHintClose {"));
assert("hint text can shrink", /\.cm__qrHintText \{[^}]*min-width: 0;/.test(css));
assert("dismiss has a keyboard focus ring", css.includes(".cm__qrHintClose:focus-visible"));
assert("dead pill CSS is removed", !css.includes(".cm__qrBtn"));
assert("dead helper CSS is removed", !css.includes(".cm__selectorHelper"));

/* ── i18n: new key present, dead keys removed ─────────────────────────────── */

for (const key of [
  "connectMarzban.client.qr_suffix",
  "connectMarzban.client.modal_title",
  "connectMarzban.client.recommended_title",
  "connectMarzban.client.other_title",
  "connectMarzban.client.qr_title",
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
  "connectMarzban.client.button",
  "connectMarzban.client.help_aria",
  "connectMarzban.client.help_title",
  "connectMarzban.client.help_text",
  "connectMarzban.client.help_route",
  "connectMarzban.client.help_action",
]) {
  assert(`dead key removed: ${key}`, !dict.includes(`"${key}":`));
}
assert("RU suffix wording", dict.includes('"connectMarzban.client.qr_suffix": "QR и резервы"'));
assert("EN suffix wording", dict.includes('"connectMarzban.client.qr_suffix": "QR & backups"'));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: Flex connection options (one self-explanatory selector, layout-bound callout) verified");