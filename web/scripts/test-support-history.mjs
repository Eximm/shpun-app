#!/usr/bin/env node
// Regression for Admin Support: user-centric (cross-ticket) history.
//
// Usage: npm run test:support-history

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
const dict = read("src/shared/i18n/dict.ts");
const historyRepo = read("../api/src/modules/support/historyRepo.ts");
const service = read("../api/src/modules/support/service.ts");
const adminRoutes = read("../api/src/modules/support/adminRoutes.ts");
const tests = read("../api/src/modules/support/routes.test.ts");

/* ── Backend: storage ─────────────────────────────────────────────────────── */

assert("compensations table exists", historyRepo.includes("CREATE TABLE IF NOT EXISTS support_compensations"));
assert("compensations are scoped by stable user id", historyRepo.includes("idx_support_compensations_user") && historyRepo.includes("user_id"));
assert("compensations keep a service snapshot", historyRepo.includes("service_title_snapshot") && historyRepo.includes("service_id"));
assert("compensations keep ticket + amount + description", historyRepo.includes("ticket_id") && historyRepo.includes("amount_days") && historyRepo.includes("description"));
assert("user notes table exists (user-level)", historyRepo.includes("CREATE TABLE IF NOT EXISTS support_user_notes"));
assert("notes are keyed by user id, never a ticket", historyRepo.includes("idx_support_user_notes_user") && !/support_user_notes[\s\S]*?ticket_id/.test(historyRepo.slice(historyRepo.indexOf("support_user_notes"), historyRepo.indexOf("support_user_notes") + 600)));
assert("history lists every ticket of the user", historyRepo.includes("listUserHistoryTickets") && historyRepo.includes("WHERE user_id = ?"));

/* ── Backend: aggregate service + routes ──────────────────────────────────── */

assert("one aggregate history builder", service.includes("export function getUserHistory"));
assert("history merges tickets/compensations/notes into a timeline", service.includes("const timeline: UserHistoryTimelineEvent[]") && service.includes("kind: \"compensation\"") && service.includes("kind: \"note\""));
assert("history counts open tickets", service.includes("OPEN_TICKET_STATUSES") && service.includes("ticketsOpen"));
assert("history is admin-only aggregate endpoint", adminRoutes.includes('app.get("/admin/support/users/:userId/history"') && adminRoutes.includes("getUserHistory"));
assert("compensation create endpoint exists", adminRoutes.includes('app.post("/admin/support/users/:userId/compensations"') && adminRoutes.includes("addCompensation"));
assert("note create endpoint exists", adminRoutes.includes('app.post("/admin/support/users/:userId/notes"') && adminRoutes.includes("addUserNote"));
assert("old tickets are picked up automatically (no parsing of past compensations)", historyRepo.includes("listUserHistoryTickets"));

/* ── Backend: regression fixture + security ───────────────────────────────── */

assert("regression fixture: User X with Ticket A/B/C", tests.includes("user history aggregates all tickets") && tests.includes("ticketsTotal, 3"));
assert("history never leaks via public ticket API", tests.includes("never leaks via the public ticket API"));
assert("history is denied for non-admins", tests.includes('assert.equal(history.statusCode, 403)'));
assert("history isolates users by shm user id", tests.includes("isolates different users by shm user id"));

/* ── Frontend ─────────────────────────────────────────────────────────────── */

assert("history endpoint is fetched from the admin API", section.includes("/admin/support/users/${") && section.includes("/history"));
assert("history loads when a ticket is opened", section.includes("void loadUserHistory(response.ticket.userId)"));
assert("inline operator summary is rendered", section.includes("supportUserSummary") && section.includes('t("support.history.stat.tickets"'));
assert("summary shows previous-compensation warning", section.includes('t("support.history.warn.previous")'));
assert("summary shows same-service warning", section.includes('t("support.history.warn.same_service"') && section.includes("sameServiceCompensations"));
assert("same-service highlight does not filter the list", section.includes("userHistory.compensations.filter((c) => c.serviceId === opened.serviceId)"));
assert("history button opens a modal/drawer", section.includes('t("support.history.open")') && section.includes("<ModalShell") && section.includes("historyOpen"));
assert("drawer lists previous tickets with an open action", section.includes('t("support.history.section.tickets")') && section.includes('t("support.history.action.open_ticket")') && section.includes("void openTicket(ht.id)"));
assert("drawer lists compensations", section.includes('t("support.history.section.compensations")') && section.includes("supportHistory__comp"));
assert("drawer lists internal notes", section.includes('t("support.history.section.notes")') && section.includes("supportHistory__note"));
assert("drawer has a merged timeline", section.includes('t("support.history.section.timeline")') && section.includes("userHistory.timeline"));
assert("operator can add a compensation", section.includes("addHistoryCompensation") && section.includes("/compensations") && section.includes('method: "POST"'));
assert("operator can add a note", section.includes("addHistoryNote") && section.includes("/notes"));
assert("history state is cleared on ticket close", section.includes("setUserHistory(null)") && section.includes("setHistoryOpen(false)"));
assert("history styles exist", css.includes(".supportUserSummary") && css.includes(".supportHistory__timeline") && css.includes(".supportUserSummary__warn--strong"));

/* ── i18n parity ──────────────────────────────────────────────────────────── */

for (const key of ["support.history.title", "support.history.warn.same_service", "support.history.section.timeline", "support.history.action.open_ticket", "support.history.comp.add", "support.history.note.add"]) {
  const count = dict.split(`"${key}"`).length - 1;
  assert(`i18n ${key} has RU+EN`, count === 2);
}

console.log(`\n${failures === 0 ? "OK" : "FAILED"}: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
