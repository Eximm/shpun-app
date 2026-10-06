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

/* ── Frontend UX (operator-friendly redesign) ─────────────────────────────── */

assert("history endpoint is fetched from the admin API", section.includes("/admin/support/users/${") && section.includes("/history"));
assert("history loads when a ticket is opened", section.includes("void loadUserHistory(response.ticket.userId)"));

// 1. Compact summary: name + id + 3 numbers, no notes noise.
const modal = section.slice(section.indexOf("historyOpen && opened"));
assert("summary shows the user name and id", section.includes("supportHistory__user") && section.includes("· #{userHistory.user.id}"));
assert("summary has exactly 3 compact stats", modal.includes("supportHistory__stats") && section.includes('t("support.history.stat.tickets"') && section.includes('t("support.history.stat.open"') && section.includes('t("support.history.stat.compensations"'));
assert("summary does not render a notes metric", !section.includes('support.history.stat.notes'));

// 2. Tickets are the main block, rendered as compact cards.
assert("tickets render as cards", modal.includes("supportHistory__ticket") && modal.includes('t("support.history.section.tickets")'));
assert("ticket card shows #no · service, date and status", modal.includes("#{ht.publicNo} · {historyServiceTitle(ht)}") && modal.includes("formatDateTime(ht.createdAt") && modal.includes("statusLabel(ht.status"));
assert("ticket card has an open action", modal.includes("void openTicket(ht.id)"));
assert("compensation is shown inline inside its ticket card", modal.includes("supportHistory__ticketComp") && modal.includes("compForTicket(ht)"));

// 3. Human-readable service names, never a raw code.
assert("service title prefers a human-readable name", section.includes("const historyServiceTitle") && section.includes("ticket.serviceTitle || ticket.subject"));
assert("ticket title never renders a technical service code", !modal.includes("serviceCategory") && !modal.includes("userServiceId"));

// 4. Compensation form is collapsed by default.
assert("compensation form is gated behind a flag", section.includes("compFormOpen") && section.includes("compFormOpen ?"));
assert("empty compensation state offers the create action", modal.includes('t("support.history.comp.none")') && modal.includes('t("support.history.comp.create")') && modal.includes("setCompFormOpen(true)"));
assert("compensation days/description inputs only render when opened", section.includes("{compFormOpen ? (") && modal.includes("setCompFormOpen(false)"));

// 5. Notes form is collapsed by default, notes are cards, pinned highlighted.
assert("note form is gated behind a flag", section.includes("noteFormOpen") && section.includes("noteFormOpen ?"));
assert("empty notes state offers the create action", modal.includes('t("support.history.note.none")') && modal.includes('t("support.history.note.create")') && modal.includes("setNoteFormOpen(true)"));
assert("note textarea only renders inside the opened form", section.includes("{noteFormOpen ? (") && modal.includes("setNoteFormOpen(false)"));
assert("notes render as cards with author + date", modal.includes("supportHistory__note") && modal.includes("formatDateTime(n.createdAt") && modal.includes("n.createdBy"));
assert("pinned note is highlighted", modal.includes("supportHistory__note--pinned") && modal.includes("pinnedNote"));

// 6. Timeline removed from the UI (data stays in the API).
assert("no duplicate timeline section in the UI", !section.includes("supportHistory__timeline") && !section.includes("userHistory.timeline"));

// 7. Same-service warning is visible above the fold, with a concrete event.
assert("same-service warning is prominent", section.includes("supportHistory__warning--strong") && section.includes("latestSameCompensation"));
assert("same-service warning shows date · amount · service · ticket no", section.includes("formatCompAmount(latestSameCompensation)") && section.includes("compPublicNo(latestSameCompensation)"));
assert("same-service warning can open the previous ticket", section.includes("void openTicket(latestSameCompensation.ticketId as number)"));
assert("inline ticket summary shows the same-service warning too", section.includes("supportUserSummary__warn--strong") && section.includes("supportUserSummary__warnBody"));

// 8. Generic previous-compensation hint stays calm and is separate from same-service.
assert("generic warning is not the red alert", section.includes('t("support.history.warn.previous_other")') && !section.includes('supportUserSummary__warn--strong">{t("support.history.warn.previous'));
assert("generic warning offers a View action", section.includes('t("support.history.warn.view")') && section.includes("scrollIntoView"));

// 9. Layout + modal size.
assert("wide modal uses the dedicated modifier", section.includes('cardClassName="admin-modal__card--wide"'));
assert("wide modal is 700-800px and dvh-capped", css.includes("admin-modal__card--wide") && css.includes("width: min(780px, 100%)") && css.includes("max-height: calc(100dvh - 32px)"));
assert("history layout is single-column", css.includes(".supportHistory { display: flex; flex-direction: column"));
assert("mobile rules avoid overflow", css.includes("@media (max-width: 640px)") && css.includes("max-height: 92dvh"));

assert("operator can add a compensation", section.includes("addHistoryCompensation") && section.includes("/compensations"));
assert("operator can add a note", section.includes("addHistoryNote") && section.includes("/notes"));
assert("history state is cleared on ticket close", section.includes("setUserHistory(null)") && section.includes("setHistoryOpen(false)"));

/* ── i18n parity ──────────────────────────────────────────────────────────── */

for (const key of ["support.history.title", "support.history.warn.same_title", "support.history.warn.previous_other", "support.history.warn.view", "support.history.comp.none", "support.history.comp.create", "support.history.note.none", "support.history.note.create", "support.history.action.open_ticket", "support.history.comp.in_ticket"]) {
  const count = dict.split(`"${key}"`).length - 1;
  assert(`i18n ${key} has RU+EN`, count === 2);
}

console.log(`\n${failures === 0 ? "OK" : "FAILED"}: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
