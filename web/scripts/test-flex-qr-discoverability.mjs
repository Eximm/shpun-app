#!/usr/bin/env node
// Regression for the Flex connector "connection options" entry point.
//
// History:
//   v1 - QR/backup options were hidden behind an ambiguous circular "i" button.
//   v2 - a separate "QR и резервные способы" pill was added next to the app
//        selector, which duplicated the selector and created a second modal.
//   v3 - consolidated: the app selector is the SINGLE entry point; the one
//        modal groups recommended app / other apps / QR + links / backups,
//        with a calm helper line and a dismissible first-run callout.
//
// This locks in:
//   - no second pill button, no second modal, no duplicated open path
//   - one source for the QR/backup content
//   - a descriptive label + clear selector value
//   - dismissible, local, mobile-safe first-run hint
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

/* ── No duplicate entry points ────────────────────────────────────────────── */

assert("no separate QR pill button", !connector.includes("cm__qrBtn"));
assert("no leftover circular info button", !connector.includes("cm__selectorInfo"));
assert("no second help modal state", !connector.includes("clientHelpOpen"));
assert("no second help modal markup", !connector.includes("cm__clientHelpModal"));
assert("the app selector is the only connection entry", connector.includes("onClick={() => setClientPickerOpen(true)}"));
assert("QR/backup content has a single source", count(connector, "const manualQrBlock") === 1);
assert("QR/backup content is rendered once", count(connector, "{manualQrBlock}") === 1);

/* ── Descriptive label + selector value ───────────────────────────────────── */

assert("label uses the connection-options key", connector.includes('t("connectMarzban.client.label")'));
assert("selector value shows the current app", connector.includes("selectedClient.title"));
assert("recommended app is marked in the selector value", connector.includes('t("connectMarzban.client.recommended")'));
assert("calm helper line under the selector", connector.includes('className="cm__selectorHelper"') && connector.includes('t("connectMarzban.client.helper")'));

/* ── One modal, logically grouped ─────────────────────────────────────────── */

assert("modal groups recommended app", connector.includes('t("connectMarzban.client.recommended_title")'));
assert("modal groups other apps", connector.includes('t("connectMarzban.client.other_title")'));
assert("modal groups QR and links", connector.includes('t("connectMarzban.client.qr_title")'));
assert("modal includes the shared QR/backup block", connector.includes("{manualQrBlock}"));
assert("QR block keeps primary + reserve groups", connector.includes('t("connectMarzban.qr.primary_title")') && connector.includes('t("connectMarzban.qr.reserve_title")'));

/* ── First-run hint: local, dismissible, not a second CTA ─────────────────── */

assert("first-run callout exists", connector.includes('className="cm__qrHint"'));
assert("hint is gated on first run", connector.includes("ready && !qrHintSeen"));
assert("hint has a dismiss handler", connector.includes("dismissQrHint") && connector.includes("onClick={dismissQrHint}"));
assert("dismiss persists locally", connector.includes("localStorage.setItem(QR_HINT_STORAGE_KEY"));
assert("seen state is read locally", connector.includes("localStorage.getItem(QR_HINT_STORAGE_KEY)"));
assert("storage key is versioned", connector.includes('"shpun.connect.qr_hint_seen_v1"'));
assert("hint is not hover-only", !connector.includes("onMouseEnter") && connector.includes('role="status"'));

/* ── Responsive / mobile-safe CSS ─────────────────────────────────────────── */

assert("helper line can shrink/break", /\.cm__selectorHelper \{[\s\S]*?overflow-wrap: anywhere;/.test(css));
assert("hint exists in CSS", css.includes(".cm__qrHint {") && css.includes(".cm__qrHintClose {"));
assert("hint text can shrink", /\.cm__qrHintText \{[^}]*min-width: 0;/.test(css));
assert("dismiss has a keyboard focus ring", css.includes(".cm__qrHintClose:focus-visible"));
assert("dead pill CSS is removed", !css.includes(".cm__qrBtn"));

/* ── i18n: new keys present, dead keys removed ────────────────────────────── */

for (const key of [
  "connectMarzban.client.label",
  "connectMarzban.client.recommended_title",
  "connectMarzban.client.other_title",
  "connectMarzban.client.qr_title",
  "connectMarzban.client.helper",
  "connectMarzban.qr.hint_title",
  "connectMarzban.qr.hint_text",
]) {
  assert(`RU has ${key}`, dict.includes(`"${key}":`));
}
for (const key of [
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
assert("RU label is connection options", dict.includes('"connectMarzban.client.label": "Способы подключения"'));
assert("EN label is connection options", dict.includes('"connectMarzban.client.label": "Connection options"'));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: Flex connection options (single entry, no duplication, dismissible hint) verified");