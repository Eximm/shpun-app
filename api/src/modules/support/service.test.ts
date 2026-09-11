import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-support-service-"));

const service = await import("./service.js");
const { getTicketRepository } = await import("./repository.js");
const { SupportError } = service;

const fakeShm = {
  async resolveIdentity(sessionId: string) {
    if (sessionId !== "shm-ok") throw new Error("support_shm_identity_failed:401");
    return {
      userId: 42,
      login: "user42",
      displayName: "User 42",
      balance: 500,
      bonus: 10,
    };
  },
  async resolveOwnedService(sessionId: string, userServiceId: number) {
    if (sessionId === "shm-ok" && userServiceId === 77) {
      return {
        user_service_id: 77,
        service_id: 7,
        name: "VPN Basic",
        category: "marzban",
        status: "ACTIVE",
        expire: "2026-01-01",
        period: 1,
        cost: 200,
      };
    }
    return null;
  },
};

function assertSupportError(error: unknown, code: string): boolean {
  assert.ok(error instanceof SupportError, `expected SupportError, got ${String(error)}`);
  assert.equal((error as InstanceType<typeof SupportError>).code, code);
  return true;
}

test("creates a ticket and snapshots the owned service", async () => {
  const ticket = await service.createTicket(
    {
      userId: 42,
      source: "telegram",
      categoryKey: "connection",
      text: "Не поднимается туннель на телефоне",
      userServiceId: 77,
      shmSessionId: "shm-ok",
      telegramChatId: 555000,
    },
    { shm: fakeShm }
  );

  assert.equal(ticket.userId, 42);
  assert.equal(ticket.status, "open");
  assert.equal(ticket.userServiceId, 77);
  assert.equal(ticket.serviceId, 7);
  assert.equal(ticket.serviceCategory, "marzban");
  assert.equal(ticket.telegramChatId, 555000);
  assert.equal(ticket.displayNameSnapshot, "User 42");
  assert.equal(ticket.balanceSnapshot, 500);
  assert.equal(ticket.serviceSnapshot?.status, "ACTIVE");
  assert.equal(ticket.messages.length, 1);
  assert.equal(ticket.messages[0]?.authorType, "user");
});

test("rejects a service that does not belong to the requester", async () => {
  await assert.rejects(
    () =>
      service.createTicket(
        {
          userId: 42,
          source: "app",
          categoryKey: "connection",
          text: "Проверка чужой услуги",
          userServiceId: 78,
          shmSessionId: "shm-ok",
        },
        { shm: fakeShm }
      ),
    (error) => assertSupportError(error, "service_not_owned")
  );
});

test("rejects a service id when there is no session to verify ownership", async () => {
  await assert.rejects(
    () =>
      service.createTicket(
        {
          userId: 42,
          source: "app",
          categoryKey: "connection",
          text: "Без сессии",
          userServiceId: 77,
        },
        { shm: fakeShm }
      ),
    (error) => assertSupportError(error, "service_ownership_unavailable")
  );
});

test("rejects an unknown or inactive category", async () => {
  await assert.rejects(
    () =>
      service.createTicket(
        { userId: 42, source: "app", categoryKey: "does-not-exist", text: "Привет" },
        { shm: fakeShm }
      ),
    (error) => assertSupportError(error, "invalid_category")
  );

  const base = getTicketRepository();
  const inactiveRepo = new Proxy(base, {
    get(target, prop, receiver) {
      if (prop === "getCategory") {
        return () => ({
          key: "connection",
          title: "Не подключается",
          description: null,
          sortOrder: 10,
          active: false,
          createdAt: "",
          updatedAt: "",
        });
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  await assert.rejects(
    () =>
      service.createTicket(
        { userId: 42, source: "app", categoryKey: "connection", text: "Привет" },
        { repo: inactiveRepo, shm: fakeShm }
      ),
    (error) => assertSupportError(error, "invalid_category")
  );
});

test("user cannot read another user's ticket", async () => {
  const ticket = await service.createTicket(
    { userId: 71, source: "app", categoryKey: "other", text: "Тикет пользователя 71" },
    { shm: fakeShm }
  );

  assert.ok(service.getUserTicket(ticket.id, 71));
  assert.equal(service.getUserTicket(ticket.id, 72), null);

  assert.throws(
    () => service.addUserMessage(ticket.id, 72, "Чужое сообщение"),
    (error) => assertSupportError(error, "ticket_not_found")
  );
});

test("internal notes are hidden from the user but visible to admin", async () => {
  const ticket = await service.createTicket(
    { userId: 81, source: "app", categoryKey: "billing", text: "Вопрос по списанию" },
    { shm: fakeShm }
  );

  service.addStaffMessage({
    ticketId: ticket.id,
    operatorId: 900,
    operatorName: "Operator",
    text: "Публичный ответ оператора",
  });
  service.addStaffMessage({
    ticketId: ticket.id,
    operatorId: 900,
    operatorName: "Operator",
    text: "Внутренняя заметка",
    internal: true,
  });

  const userView = service.getUserTicket(ticket.id, 81);
  assert.equal(userView?.messages.length, 2);
  assert.ok(userView?.messages.every((m) => m.isInternalNote === false));

  const adminView = service.getAdminTicket(ticket.id);
  assert.equal(adminView?.messages.length, 3);
  assert.ok(adminView?.messages.some((m) => m.isInternalNote === true));
});

test("staff reply moves ticket to waiting_user; user reply moves it to waiting_staff", async () => {
  const ticket = await service.createTicket(
    { userId: 91, source: "app", categoryKey: "app", text: "Приложение падает" },
    { shm: fakeShm }
  );

  const afterStaff = service.addStaffMessage({
    ticketId: ticket.id,
    operatorId: 900,
    operatorName: "Operator",
    text: "Уточните версию приложения",
  });
  assert.equal(afterStaff.status, "waiting_user");

  const afterUser = service.addUserMessage(ticket.id, 91, "Версия 1.2.3");
  assert.equal(afterUser.status, "waiting_staff");
});

test("closed tickets reject user replies; resolved tickets reopen on reply", async () => {
  const ticket = await service.createTicket(
    { userId: 101, source: "app", categoryKey: "other", text: "Первый вопрос" },
    { shm: fakeShm }
  );

  service.updateTicketByAdmin(ticket.id, { status: "resolved" });
  const reopened = service.addUserMessage(ticket.id, 101, "Проблема вернулась");
  assert.equal(reopened.status, "waiting_staff");

  service.updateTicketByAdmin(ticket.id, { status: "closed" });
  assert.throws(
    () => service.addUserMessage(ticket.id, 101, "Ещё сообщение"),
    (error) => assertSupportError(error, "ticket_closed")
  );
});

test("admin can assign, reprioritize and validate status", async () => {
  const ticket = await service.createTicket(
    { userId: 111, source: "app", categoryKey: "other", text: "Тестовый тикет" },
    { shm: fakeShm }
  );

  const updated = service.updateTicketByAdmin(ticket.id, {
    status: "in_progress",
    priority: "urgent",
    assignedTo: 777,
  });
  assert.equal(updated.status, "in_progress");
  assert.equal(updated.priority, "urgent");
  assert.equal(updated.assignedTo, 777);

  assert.throws(
    () => service.updateTicketByAdmin(ticket.id, { status: "broken" }),
    (error) => assertSupportError(error, "invalid_status")
  );
});

test("user listing returns only that user's tickets", async () => {
  await service.createTicket(
    { userId: 121, source: "app", categoryKey: "other", text: "Тикет 121" },
    { shm: fakeShm }
  );
  await service.createTicket(
    { userId: 122, source: "app", categoryKey: "other", text: "Тикет 122" },
    { shm: fakeShm }
  );

  const page = service.listUserTickets(121);
  assert.equal(page.total, 1);
  assert.ok(page.items.every((t) => t.userId === 121));
});
