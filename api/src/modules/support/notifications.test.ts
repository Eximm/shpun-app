import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-support-notify-"));

const service = await import("./service.js");
const notifyRepo = await import("./notifyRepo.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

const adminUserId = 900;

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

function adminSupportEvents() {
  return linkDb
    .prepare(
      `SELECT * FROM notif_events
       WHERE user_id = ? AND type LIKE 'support.%'
       ORDER BY ts ASC, event_id ASC`
    )
    .all(adminUserId) as any[];
}

test("ticket creation notifies registered admins in-app", async () => {
  notifyRepo.recordSupportNotifyRecipient(adminUserId);

  await service.createTicket({
    userId: 42,
    source: "app",
    categoryKey: "connection",
    text: "Не подключается VPN",
  });
  await flush();

  const rows = adminSupportEvents();
  assert.ok(rows.length >= 1);
  assert.ok(rows.some((r) => r.type === "support.ticket.created" && r.target === "user"));
});

test("user message notifies admins; internal note and status change do not", async () => {
  const ticket = await service.createTicket({
    userId: 43,
    source: "app",
    categoryKey: "other",
    text: "Первый вопрос",
  });
  await flush();
  const before = adminSupportEvents().length;

  service.addUserMessage(ticket.id, 43, "Ещё один вопрос");
  await flush();
  const afterUser = adminSupportEvents().length;
  assert.ok(afterUser > before);

  // Internal note must not notify the user; status-only change must not notify anyone.
  service.addStaffMessage({
    ticketId: ticket.id,
    operatorId: adminUserId,
    text: "Внутренняя заметка",
    internal: true,
  });
  service.updateTicketByAdmin(ticket.id, { status: "in_progress" });
  await flush();

  assert.equal(adminSupportEvents().length, afterUser);
});

test("unread tracks user messages and resets when the admin opens the ticket", async () => {
  const ticket = await service.createTicket({
    userId: 44,
    source: "app",
    categoryKey: "speed",
    text: "Низкая скорость",
  });

  assert.ok(notifyRepo.listSupportUnreadTicketIds(adminUserId).includes(ticket.id));

  notifyRepo.markSupportTicketRead(adminUserId, ticket.id);
  assert.ok(!notifyRepo.listSupportUnreadTicketIds(adminUserId).includes(ticket.id));
});

test("staff reply does not create in-app admin events", async () => {
  const ticket = await service.createTicket({
    userId: 45,
    source: "app",
    categoryKey: "app",
    text: "Проблема в приложении",
  });
  await flush();
  const before = adminSupportEvents().length;

  service.addStaffMessage({
    ticketId: ticket.id,
    operatorId: adminUserId,
    text: "Публичный ответ оператора",
  });
  await flush();

  assert.equal(adminSupportEvents().length, before);
});
