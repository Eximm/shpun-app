#!/usr/bin/env node
// Regression for Admin Support: message soft-delete + background auto-refresh.
//
// Usage: npm run test:support-messages

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
const repo = read("../api/src/modules/support/sqliteRepository.ts");
const service = read("../api/src/modules/support/service.ts");
const adminRoutes = read("../api/src/modules/support/adminRoutes.ts");
const userRoutes = read("../api/src/modules/support/routes.ts");
const dict = read("src/shared/i18n/dict.ts");

/* ── Message soft delete ──────────────────────────────────────────────────── */

assert("message menu exists (ActionMenu + delete action)", section.includes("<ActionMenu") && section.includes('t("support.admin.action.delete_message")'));
assert("delete is confirmed", section.includes('window.confirm(t("support.admin.confirm_delete_message"))'));
assert("delete calls the admin message endpoint", section.includes("/admin/support/messages/${message.id}") && section.includes('method: "DELETE"'));
assert("deleted message renders an audit placeholder", section.includes("message.deletedAt") && section.includes("supportMsg--deleted") && section.includes('t("support.admin.message_deleted")'));
assert("placeholder shows who deleted it", section.includes('t("support.admin.deleted_by"'));
assert("no page reload after delete", !section.includes("window.location.reload"));

assert("backend stores soft-delete audit columns", repo.includes('ensureColumn("support_ticket_messages", "deleted_at"') && repo.includes('ensureColumn("support_ticket_messages", "deleted_by"'));
assert("backend softDeleteMessage is idempotent", repo.includes("softDeleteMessage") && repo.includes("COALESCE(deleted_at"));
assert("admin delete route exists", adminRoutes.includes('app.delete("/admin/support/messages/:messageId"') && adminRoutes.includes("deleteMessageByAdmin"));
assert("user API hides deleted messages", service.includes("filter((m) => !m.deletedAt)"));
assert("admin API redacts deleted body/attachments", service.includes('m.deletedAt ? { ...m, text: "", attachments: [] } : m'));
assert("attachment route denies deleted-message files", userRoutes.includes("message?.deletedAt"));
assert("i18n delete keys exist RU/EN", dict.includes('"support.admin.action.delete_message"') && dict.includes('"support.admin.confirm_delete_message"') && dict.includes('"support.admin.message_deleted"'));

/* ── Auto-refresh (polling) ───────────────────────────────────────────────── */

assert("open ticket polls frequently", section.includes("setInterval") && section.includes("}, 4000)"));
assert("ticket list polls periodically", section.includes("}, 12000)"));
assert("polling pauses when the tab is hidden", section.includes("document.hidden"));
assert("focus triggers an immediate refresh", section.includes('window.addEventListener("focus", onFocus)'));
assert("visibilitychange triggers an immediate refresh", section.includes('document.addEventListener("visibilitychange", onVisibility)'));
assert("no page reload for refresh", !section.includes("window.location.reload"));
assert("manual refresh calls refreshAll", section.includes("onClick={refreshAll}"));

/* ── Merge / race safety ──────────────────────────────────────────────────── */

assert("messages merge by canonical id", section.includes("function mergeMessages") && section.includes("map.set(m.id"));
assert("deleted messages are never resurrected by a stale response", section.includes("prev?.deletedAt && !m.deletedAt"));
assert("updates merge into the open ticket instead of replacing id-less state", section.includes("mergeTicket") && section.includes("applyTicketUpdate"));
assert("send/patch use the merge path", !/setOpened\(response\.ticket\)/.test(section));

/* ── Scroll behaviour ─────────────────────────────────────────────────────── */

assert("new-message indicator exists", section.includes("supportNewBelow") && section.includes('t("support.admin.new_message")'));
assert("indicator scrolls to newest on click", section.includes("function scrollToNewest") && section.includes("onClick={scrollToNewest}"));
assert("reader away from bottom is not force-scrolled", section.includes("nearBottomRef"));
assert("indicator styles exist", css.includes(".supportNewBelow {") && css.includes(".supportMsg--deleted {") && css.includes(".supportMsg__menuBtn {"));

if (failures > 0) {
  console.error(`\nFAILED: ${failures} check(s)`);
  process.exit(1);
}
console.log("\nOK: support message soft-delete + auto-refresh verified");