#!/usr/bin/env node
// Regression for the Flex connector "QR / backup options" discoverability fix.
//
// Bug history: the QR + backup links were hidden behind an ambiguous circular
// "i" info button (perceived as "Информация"). Users could not find the QR code
// or backup connection options.
//
// This locks in:
//   - a clearly named "QR и резервные способы" action (no "i" / "Информация")
//   - a dismissible, local-first first-run hint (works on mobile, not hover-only)
//   - consistent naming inside the QR/backup section
//   - responsive, non-overflowing layout
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

const connector = read("src/pages/connect/ConnectMarzban.tsx");
const css = read("src/index.css");
const dict = read("src/shared/i18n/dict.ts");

/* ── Old ambiguous control is gone ────────────────────────────────────────── */

assert("old circular info button is removed", !connector.includes("cm__selectorInfo"));
assert("old ambiguous 'i' label is removed", !connector.includes(">\n              i\n            </button>"));
assert("old help_aria trigger no longer used", !connector.includes('t("connectMarzban.client.help_aria")'));
assert("no 'Информация' label in the connector", !connector.includes("Информация"));

/* ── Clear, explicit action ───────────────────────────────────────────────── */

assert("labeled QR/backup button exists", connector.includes('className="cm__qrBtn"'));
assert("button uses the explicit i18n label", connector.includes('t("connectMarzban.qr.button")'));
assert("button has an accessible name", connector.includes('aria-label={t("connectMarzban.qr.button_aria")}'));
assert("button opens the QR/backup modal", connector.includes("onClick={() => setClientHelpOpen(true)}"));

/* ── First-run hint: dismissible, local, mobile-safe ──────────────────────── */

assert("hint callout exists", connector.includes('className="cm__qrHint"'));
assert("hint is gated on first run", connector.includes("ready && !qrHintSeen"));
assert("hint has a dismiss handler", connector.includes("dismissQrHint") && connector.includes("onClick={dismissQrHint}"));
assert("dismiss persists locally", connector.includes("localStorage.setItem(QR_HINT_STORAGE_KEY"));
assert("seen state is read locally", connector.includes("localStorage.getItem(QR_HINT_STORAGE_KEY)"));
assert("storage key is versioned", connector.includes('"shpun.connect.qr_hint_seen_v1"'));
assert("hint is not hover-only", !connector.includes("onMouseEnter") && connector.includes('role="status"'));
assert("hint text is i18n", connector.includes('t("connectMarzban.qr.hint_text")') && connector.includes('t("connectMarzban.qr.hint_title")'));

/* ── Consistent section content ───────────────────────────────────────────── */

assert("QR/backup controls are reusable inside the modal", connector.includes("const manualQrBlock"));
assert("primary/subheading groups exist", connector.includes('t("connectMarzban.qr.primary_title")') && connector.includes('t("connectMarzban.qr.reserve_title")'));
assert("modal title renamed", connector.includes('t("connectMarzban.qr.title")'));

/* ── Responsive / mobile-safe CSS ─────────────────────────────────────────── */

assert("label row can wrap", /\.cm__selectorLabelRow \{[\s\S]*?flex-wrap: wrap;/.test(css));
assert("hint exists in CSS", css.includes(".cm__qrHint {") && css.includes(".cm__qrHintClose {"));
assert("hint text can shrink", /\.cm__qrHintText \{[^}]*min-width: 0;/.test(css));
assert("hint text breaks long words", /\.cm__qrHintText span \{[^}]*overflow-wrap: anywhere;/.test(css));
assert("dismiss has a keyboard focus ring", css.includes(".cm__qrHintClose:focus-visible"));
assert("button has a keyboard focus ring", css.includes(".cm__qrBtn:focus-visible"));

/* ── i18n parity ──────────────────────────────────────────────────────────── */

for (const key of [
  "connectMarzban.qr.button",
  "connectMarzban.qr.button_aria",
  "connectMarzban.qr.title",
  "connectMarzban.qr.hint_title",
  "connectMarzban.qr.hint_text",
  "connectMarzban.qr.primary_title",
  "connectMarzban.qr.reserve_title",
]) {
  assert(`RU has ${key}`, dict.includes(`"${key}":`));
}
assert("RU hint text present", dict.includes('"connectMarzban.qr.hint_text": "Здесь можно открыть QR-код'));
assert("EN hint text present", dict.includes('"connectMarzban.qr.hint_text": "Open the QR code'));
assert("section title renamed (RU)", dict.includes('"connect.more_methods": "QR и резервные способы"'));
assert("section title renamed (EN)", dict.includes('"connect.more_methods": "QR and backup options"'));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: Flex QR/backup discoverability (naming + dismissible hint + responsive) verified");