#!/usr/bin/env node
// Regression for the unified attachment-open flow (user + admin support).
//
// Bug history: attachments rendered as `<a href="/api/..." target="_blank">`.
// On desktop that opened a new tab; inside mobile webviews (no real new tab)
// it navigated the current SPA, which looked like an app reload/re-launch.
//
// This static check locks in one platform-independent flow:
//   - previewable attachments (images, PDF) open in an in-app viewer/modal
//   - no target="_blank", no window.open, no location/href navigation
//   - closing restores the exact scroll position
//   - generic files download in place (SPA stays)
//
// Usage: npm run test:attachment-open

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.join(__dirname, "..");

// Windows checkouts may be CRLF; normalize so multiline checks are stable.
const read = (rel) => fs.readFileSync(path.join(webRoot, rel), "utf8").replace(/\r\n?/g, "\n");

let failures = 0;
function assert(name, cond) {
  console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
  if (!cond) failures++;
}

const views = read("src/shared/support/AttachmentViews.tsx");
// Strip comments so documentation of the removed patterns (in the file header)
// cannot be mistaken for actual navigation escape hatches.
const viewsCode = views.replace(/^\s*\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
const helpers = read("src/shared/support/attachments.ts");
const css = read("src/index.css");
const dict = read("src/shared/i18n/dict.ts");

/* ── No navigation / new-window escape hatches ────────────────────────────── */

assert("no target=_blank with a raw href", !/href=\{[^}]*\}[^>]*target="_blank"/.test(viewsCode));
assert("no target=_blank string at all", !viewsCode.includes('target="_blank"'));
assert("no window.open", !viewsCode.includes("window.open"));
assert("no location navigation", !viewsCode.includes("location.href") && !viewsCode.includes("location.assign"));

/* ── Single in-app viewer/lightbox ────────────────────────────────────────── */

assert("viewer renders through a portal", views.includes("createPortal"));
assert("viewer is an accessible dialog", views.includes('role="dialog"') && views.includes('aria-modal="true"'));
assert("viewer locks body/html scroll", views.includes('document.body.style.overflow = "hidden"') && views.includes('document.documentElement.style.overflow = "hidden"'));
assert("viewer restores the exact scroll position", views.includes("window.scrollTo({ left: scrollX, top: scrollY"));
assert("viewer restores focus without scrolling", views.includes("preventScroll: true"));
assert("escape closes the viewer", views.includes('ev.key === "Escape"'));
assert("viewer keeps the latest onClose without re-locking", views.includes("onCloseRef.current"));

/* ── Images + PDF use the viewer; generic files download in place ─────────── */

assert("images open the viewer instead of a link", views.includes("onClick={() => onOpen(attachment)}") && !views.includes("<a className=\"attachImage\""));
assert("PDF has a dedicated preview branch", views.includes("isPdfAttachment(attachment)"));
assert("PDF renders inside an iframe viewer", views.includes("attachViewer__frame") && views.includes("<iframe"));
assert("generic files use a same-origin download link", /className="attachItem"[\s\S]*?download=/.test(views));
assert("pdf helper is shared", helpers.includes("export function isPdfAttachment"));
assert("viewer styles exist", css.includes(".attachViewer {") && css.includes(".attachViewer__card"));

/* ── Shared across user + admin + partnership ─────────────────────────────── */

for (const rel of [
  "src/pages/Support.tsx",
  "src/pages/admin/SupportSection.tsx",
  "src/pages/Partnership.tsx",
]) {
  const page = read(rel);
  assert(`${rel}: uses the shared AttachmentList`, page.includes("AttachmentList"));
}

/* ── i18n keys exist in both locales ──────────────────────────────────────── */

assert("RU has attachment.open", dict.includes('"support.attachment.open": "Открыть"'));
assert("RU has attachment.download", dict.includes('"support.attachment.download": "Скачать"'));
assert("EN has attachment.open", dict.includes('"support.attachment.open": "Open"'));
assert("EN has attachment.download", dict.includes('"support.attachment.download": "Download"'));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: unified in-app attachment-open flow verified");