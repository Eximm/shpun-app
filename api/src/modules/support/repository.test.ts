import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// DATA_DIR must be set before the SQLite module is imported.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-support-repo-"));

const { sqliteTicketRepository: repo } = await import("./sqliteRepository.js");

test("creates a ticket with a stable public number and local storage metadata", () => {
  const first = repo.createTicket({
    userId: 1001,
    source: "app",
    categoryKey: "connection",
    subject: "Не подключается",
    userLoginSnapshot: "user1001",
    displayNameSnapshot: "User 1001",
    balanceSnapshot: 150,
  });
  const second = repo.createTicket({
    userId: 1001,
    source: "telegram",
    categoryKey: "billing",
  });

  assert.ok(first.id > 0);
  assert.equal(first.storageProvider, "local");
  assert.equal(first.externalId, null);
  assert.equal(first.status, "open");
  assert.equal(first.priority, "normal");
  assert.equal(first.source, "app");
  assert.equal(first.balanceSnapshot, 150);
  assert.match(first.publicNo, /^[0-9]+$/);
  assert.notEqual(first.publicNo, second.publicNo);

  const loaded = repo.getTicket(first.id);
  assert.equal(loaded?.publicNo, first.publicNo);
  assert.equal(repo.getTicketByPublicNo(first.publicNo)?.id, first.id);
});

test("lists only the requested user's tickets", () => {
  const created = repo.createTicket({
    userId: 2001,
    source: "app",
    categoryKey: "speed",
  });
  repo.createTicket({ userId: 2002, source: "app", categoryKey: "speed" });

  const page = repo.listUserTickets({ userId: 2001 });
  assert.equal(page.total, 1);
  assert.equal(page.items[0]?.id, created.id);
});

test("stores messages and keeps internal notes out of user-facing lists", () => {
  const ticket = repo.createTicket({
    userId: 3001,
    source: "app",
    categoryKey: "other",
  });

  repo.addMessage({
    ticketId: ticket.id,
    authorType: "user",
    authorUserId: 3001,
    authorName: "User 3001",
    text: "Первое сообщение",
  });
  repo.addInternalNote({
    ticketId: ticket.id,
    authorType: "staff",
    authorUserId: 900,
    authorName: "Operator",
    text: "Внутренняя заметка",
    isInternalNote: true,
  });
  repo.addMessage({
    ticketId: ticket.id,
    authorType: "staff",
    authorUserId: 900,
    authorName: "Operator",
    text: "Публичный ответ",
  });

  const userFacing = repo.listMessages(ticket.id, { includeInternalNotes: false });
  assert.equal(userFacing.length, 2);
  assert.ok(userFacing.every((m) => m.isInternalNote === false));

  const adminFacing = repo.listMessages(ticket.id, { includeInternalNotes: true });
  assert.equal(adminFacing.length, 3);
  assert.ok(adminFacing.some((m) => m.isInternalNote === true));

  // last_message_at must be refreshed by message writes.
  const refreshed = repo.getTicket(ticket.id);
  assert.ok(refreshed && refreshed.lastMessageAt >= ticket.lastMessageAt);
});

test("updateTicket changes status/priority/assignee and closes the ticket timestamp", () => {
  const ticket = repo.createTicket({
    userId: 4001,
    source: "app",
    categoryKey: "billing",
  });

  const assigned = repo.assignOperator(ticket.id, 55);
  assert.equal(assigned?.assignedTo, 55);

  const updated = repo.updateTicket(ticket.id, {
    status: "closed",
    priority: "high",
    assignedTo: null,
  });
  assert.equal(updated?.status, "closed");
  assert.equal(updated?.priority, "high");
  assert.equal(updated?.assignedTo, null);
  assert.ok(updated?.closedAt);

  const reopened = repo.updateTicket(ticket.id, { status: "waiting_staff" });
  assert.equal(reopened?.status, "waiting_staff");
  assert.equal(reopened?.closedAt, null);
});

test("admin listing supports status and category filters", () => {
  repo.createTicket({ userId: 5001, source: "app", categoryKey: "router", status: "waiting_user" });
  repo.createTicket({ userId: 5002, source: "app", categoryKey: "router", status: "open" });

  const filtered = repo.listAdminTickets({ status: ["waiting_user"], categoryKey: "router" });
  assert.ok(filtered.total >= 1);
  assert.ok(filtered.items.every((t) => t.status === "waiting_user" && t.categoryKey === "router"));
});

test("categories are seeded and resolvable", () => {
  const active = repo.listCategories({ activeOnly: true });
  assert.ok(active.length >= 7);
  assert.ok(active.some((c) => c.key === "connection"));

  const category = repo.getCategory("connection");
  assert.equal(category?.active, true);
  assert.equal(repo.getCategory("does-not-exist"), null);
});
