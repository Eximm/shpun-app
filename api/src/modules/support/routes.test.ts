import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-support-routes-"));
process.env.SHM_SUPPORT_SECRET = "test-support-secret";

const Fastify = (await import("fastify")).default;
const { supportRoutes } = await import("./routes.js");
const { supportInternalRoutes } = await import("./internalRoutes.js");
const { supportAdminRoutes } = await import("./adminRoutes.js");
const { setSupportShmPort } = await import("./snapshot.js");
const { setSupportAdminChecker } = await import("./adminGuard.js");
const { putSession } = await import("../../shared/session/sessionStore.js");
const { registerTolerantJsonBodyParser } = await import("../../app/plugins/jsonBody.js");

const SUPPORT_SECRET = "test-support-secret";

const identities: Record<string, any> = {
  "shm-user-201": { userId: 201, login: "user201", displayName: "User 201", balance: 100, bonus: 0 },
  "shm-user-202": { userId: 202, login: "user202", displayName: "User 202", balance: 0, bonus: 0 },
  "shm-admin": { userId: 900, login: "admin", displayName: "Admin", balance: 0, bonus: 0 },
};

setSupportShmPort({
  async resolveIdentity(sessionId: string) {
    const value = identities[sessionId];
    if (!value) throw new Error("support_shm_identity_failed:401");
    return value;
  },
  async resolveOwnedService(_sessionId: string, userServiceId: number) {
    if (userServiceId !== 501) return null;
    return {
      user_service_id: 501,
      service_id: 5,
      name: "VPN Basic",
      category: "marzban",
      status: "ACTIVE",
      expire: "2026-05-05",
      period: 1,
      cost: 300,
    };
  },
});

setSupportAdminChecker(async (shmSessionId) => shmSessionId === "shm-admin");

putSession("sid-user-201", {
  shmSessionId: "shm-user-201",
  shmUserId: 201,
  login: "user201",
  createdAt: Date.now(),
});
putSession("sid-user-202", {
  shmSessionId: "shm-user-202",
  shmUserId: 202,
  login: "user202",
  createdAt: Date.now(),
});
putSession("sid-admin", {
  shmSessionId: "shm-admin",
  shmUserId: 900,
  login: "admin",
  createdAt: Date.now(),
});

const app = Fastify();
registerTolerantJsonBodyParser(app);
await app.register(
  async (api) => {
    await supportRoutes(api);
    await supportInternalRoutes(api);
    await supportAdminRoutes(api);
  },
  { prefix: "/api" }
);

function userHeaders(sid: string) {
  return { "x-app-sid": sid, "content-type": "application/json" };
}

async function createUserTicket(sid: string, body: Record<string, unknown> = {}) {
  return app.inject({
    method: "POST",
    url: "/api/support/tickets",
    headers: userHeaders(sid),
    payload: {
      categoryKey: "connection",
      text: "Не подключается VPN после обновления",
      ...body,
    },
  });
}

test("user API creates and lists own tickets", async () => {
  const created = await createUserTicket("sid-user-201");
  assert.equal(created.statusCode, 201);
  const createdJson = created.json();
  assert.equal(createdJson.ok, true);
  assert.equal(createdJson.ticket.userId, 201);
  assert.ok(createdJson.ticket.publicNo);

  const list = await app.inject({
    method: "GET",
    url: "/api/support/tickets",
    headers: userHeaders("sid-user-201"),
  });
  assert.equal(list.statusCode, 200);
  assert.ok(list.json().items.some((t: any) => t.id === createdJson.ticket.id));
});

test("user API enforces tenant isolation (no IDOR)", async () => {
  const created = await createUserTicket("sid-user-201");
  const ticketId = created.json().ticket.id;

  const foreign = await app.inject({
    method: "GET",
    url: `/api/support/tickets/${ticketId}`,
    headers: userHeaders("sid-user-202"),
  });
  assert.equal(foreign.statusCode, 404);
});

test("internal notes never reach the user API", async () => {
  const created = await createUserTicket("sid-user-201");
  const ticketId = created.json().ticket.id;

  const note = await app.inject({
    method: "POST",
    url: `/api/admin/support/tickets/${ticketId}/messages`,
    headers: userHeaders("sid-admin"),
    payload: { text: "Внутренняя заметка оператора", internal: true },
  });
  assert.equal(note.statusCode, 201);

  const userView = await app.inject({
    method: "GET",
    url: `/api/support/tickets/${ticketId}`,
    headers: userHeaders("sid-user-201"),
  });
  assert.equal(userView.statusCode, 200);
  assert.ok(
    userView.json().ticket.messages.every((m: any) => m.isInternalNote === false)
  );

  const adminView = await app.inject({
    method: "GET",
    url: `/api/admin/support/tickets/${ticketId}`,
    headers: userHeaders("sid-admin"),
  });
  assert.equal(adminView.statusCode, 200);
  assert.ok(adminView.json().ticket.messages.some((m: any) => m.isInternalNote === true));
});

test("user API rejects an inactive/unknown category", async () => {
  const response = await createUserTicket("sid-user-201", { categoryKey: "nope" });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invalid_category");
});

test("user API rejects a service that is not owned", async () => {
  const response = await createUserTicket("sid-user-201", { userServiceId: 999 });
  assert.equal(response.statusCode, 404);
  assert.equal(response.json().error, "service_not_owned");
});

test("user API snapshots an owned service", async () => {
  const response = await createUserTicket("sid-user-201", { userServiceId: 501 });
  assert.equal(response.statusCode, 201);
  const ticket = response.json().ticket;
  assert.equal(ticket.userServiceId, 501);
  assert.equal(ticket.serviceSnapshot.status, "ACTIVE");
  assert.equal(ticket.balanceSnapshot, 100);
});

test("user API creates a no-service general question (ShpunApp)", async () => {
  const response = await createUserTicket("sid-user-201", {
    categoryKey: "other",
    userServiceId: null,
  });
  assert.equal(response.statusCode, 201);
  const ticket = response.json().ticket;
  assert.equal(ticket.userServiceId, null);
  assert.equal(ticket.serviceId, null);
  assert.equal(ticket.serviceSnapshot, null);
});

test("user API treats an empty userServiceId as no service", async () => {
  const response = await createUserTicket("sid-user-201", {
    categoryKey: "other",
    userServiceId: "",
  });
  assert.equal(response.statusCode, 201);
  const ticket = response.json().ticket;
  assert.equal(ticket.userServiceId, null);
  assert.equal(ticket.serviceId, null);
  assert.equal(ticket.serviceSnapshot, null);
});

test("internal API rejects missing and wrong secret", async () => {
  const missing = await app.inject({
    method: "POST",
    url: "/api/internal/support/tickets",
    headers: { "content-type": "application/json" },
    payload: { session_id: "shm-user-201", category_key: "connection", text: "Привет" },
  });
  assert.equal(missing.statusCode, 401);

  const wrong = await app.inject({
    method: "POST",
    url: "/api/internal/support/tickets",
    headers: { "content-type": "application/json", "x-support-secret": "wrong" },
    payload: { session_id: "shm-user-201", category_key: "connection", text: "Привет" },
  });
  assert.equal(wrong.statusCode, 401);
});

test("internal API creates a ticket for the session user", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/internal/support/tickets",
    headers: { "content-type": "application/json", "x-support-secret": SUPPORT_SECRET },
    payload: {
      session_id: "shm-user-201",
      source: "telegram",
      telegram_chat_id: 555001,
      category_key: "connection",
      text: "Бот: VPN не работает",
    },
  });
  assert.equal(response.statusCode, 201);
  const ticket = response.json().ticket;
  assert.equal(ticket.userId, 201);
  assert.equal(ticket.source, "telegram");
  assert.equal(ticket.telegramChatId, 555001);
});

test("internal API creates a ticket through the GET action endpoint", async () => {
  const response = await app.inject({
    method: "GET",
    url:
      "/api/internal/support/tickets/create?session_id=shm-user-201&category_key=connection&telegram_chat_id=555002&text=" +
      encodeURIComponent("Бот: создание через GET action") +
      "&secret=" +
      SUPPORT_SECRET,
  });
  assert.equal(response.statusCode, 200);
  const ticket = response.json().ticket;
  assert.equal(ticket.userId, 201);
  assert.equal(ticket.source, "telegram");
  assert.equal(ticket.telegramChatId, 555002);
  assert.ok(ticket.publicNo);
});

test("internal Telegram route succeeds without user_service_id (general question)", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/internal/support/tickets",
    headers: { "content-type": "application/json", "x-support-secret": SUPPORT_SECRET },
    payload: {
      session_id: "shm-user-201",
      source: "telegram",
      category_key: "other",
      text: "Бот: общий вопрос без услуги",
    },
  });
  assert.equal(response.statusCode, 201);
  const ticket = response.json().ticket;
  assert.equal(ticket.userServiceId, null);
  assert.equal(ticket.serviceId, null);
  assert.equal(ticket.serviceSnapshot, null);
});

test("internal Telegram route normalizes user_service_id=\"\" to no service", async () => {
  const response = await app.inject({
    method: "GET",
    url:
      "/api/internal/support/tickets/create?session_id=shm-user-201&category_key=other&user_service_id=" +
      "&text=" +
      encodeURIComponent("Бот: пустой user_service_id") +
      "&secret=" +
      SUPPORT_SECRET,
  });
  assert.equal(response.statusCode, 200);
  const ticket = response.json().ticket;
  assert.equal(ticket.userServiceId, null);
  assert.equal(ticket.serviceId, null);
  assert.equal(ticket.serviceSnapshot, null);
});

test("internal Telegram route rejects a malformed non-empty user_service_id", async () => {
  const response = await app.inject({
    method: "GET",
    url:
      "/api/internal/support/tickets/create?session_id=shm-user-201&category_key=other&user_service_id=abc" +
      "&text=" +
      encodeURIComponent("Бот: плохой user_service_id") +
      "&secret=" +
      SUPPORT_SECRET,
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invalid_service");
});

test("GET create action is not shadowed by the ticket view route", async () => {
  const response = await app.inject({
    method: "GET",
    url: `/api/internal/support/tickets/create?session_id=shm-user-201&category_key=connection&text=${encodeURIComponent(
      "route precedence"
    )}&secret=${SUPPORT_SECRET}`,
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().error, undefined);
  assert.ok(response.json().ticket?.id > 0);
});

test("internal action tolerates an empty JSON body (SHM client behaviour)", async () => {
  // Exact production failure: POST with Content-Type: application/json and an
  // empty body (query carries all params).
  const response = await app.inject({
    method: "POST",
    url:
      "/api/internal/support/tickets?session_id=shm-user-201&category_key=connection&text=" +
      encodeURIComponent("empty json body") +
      "&secret=" +
      SUPPORT_SECRET,
    headers: { "content-type": "application/json" },
    payload: "",
  });
  assert.equal(response.statusCode, 201);
  assert.ok(response.json().ticket?.id > 0);
});

test("internal API replies through the GET action endpoint", async () => {
  const created = await app.inject({
    method: "GET",
    url: `/api/internal/support/tickets/create?session_id=shm-user-201&category_key=other&text=${encodeURIComponent(
      "GET reply flow"
    )}&secret=${SUPPORT_SECRET}`,
  });
  assert.equal(created.statusCode, 200);
  const ticketId = created.json().ticket.id;

  const reply = await app.inject({
    method: "GET",
    url: `/api/internal/support/tickets/${ticketId}/reply?session_id=shm-user-201&text=${encodeURIComponent(
      "Уточнение по обращению"
    )}&secret=${SUPPORT_SECRET}`,
  });
  assert.equal(reply.statusCode, 200);
  const body = reply.json();
  assert.equal(body.ticket.status, "waiting_staff");
  assert.ok(
    body.ticket.messages.some((m: any) => m.authorType === "user" && m.text === "Уточнение по обращению")
  );
});

test("internal API requires session_id and keeps requests session-scoped", async () => {
  const noSession = await app.inject({
    method: "POST",
    url: "/api/internal/support/tickets",
    headers: { "content-type": "application/json", "x-support-secret": SUPPORT_SECRET },
    payload: { category_key: "connection", text: "Без сессии" },
  });
  assert.equal(noSession.statusCode, 400);

  const created = await app.inject({
    method: "POST",
    url: "/api/internal/support/tickets",
    headers: { "content-type": "application/json", "x-support-secret": SUPPORT_SECRET },
    payload: { session_id: "shm-user-201", category_key: "other", text: "Scope тест" },
  });
  const ticketId = created.json().ticket.id;

  const foreign = await app.inject({
    method: "GET",
    url: `/api/internal/support/tickets/${ticketId}?session_id=shm-user-202`,
    headers: { "x-support-secret": SUPPORT_SECRET },
  });
  assert.equal(foreign.statusCode, 404);

  const own = await app.inject({
    method: "GET",
    url: `/api/internal/support/tickets/${ticketId}?session_id=shm-user-201`,
    headers: { "x-support-secret": SUPPORT_SECRET },
  });
  assert.equal(own.statusCode, 200);
});

test("admin API rejects non-admin and unknown sessions", async () => {
  const anon = await app.inject({ method: "GET", url: "/api/admin/support/tickets" });
  assert.equal(anon.statusCode, 401);

  const nonAdmin = await app.inject({
    method: "GET",
    url: "/api/admin/support/tickets",
    headers: userHeaders("sid-user-201"),
  });
  assert.equal(nonAdmin.statusCode, 403);

  const admin = await app.inject({
    method: "GET",
    url: "/api/admin/support/tickets",
    headers: userHeaders("sid-admin"),
  });
  assert.equal(admin.statusCode, 200);
});

test("support recipient registry does not grant admin access", async () => {
  const { recordSupportNotifyRecipient } = await import("./notifyRepo.js");

  // A non-admin is written into the delivery registry...
  recordSupportNotifyRecipient(201);

  // ...but the existing admin guard is still the only source of truth.
  const unread = await app.inject({
    method: "GET",
    url: "/api/admin/support/unread",
    headers: userHeaders("sid-user-201"),
  });
  assert.equal(unread.statusCode, 403);

  const tickets = await app.inject({
    method: "GET",
    url: "/api/admin/support/tickets",
    headers: userHeaders("sid-user-201"),
  });
  assert.equal(tickets.statusCode, 403);
});

test("admin API handles staff replies, status updates and filtering", async () => {
  const created = await createUserTicket("sid-user-201");
  const ticketId = created.json().ticket.id;

  const reply = await app.inject({
    method: "POST",
    url: `/api/admin/support/tickets/${ticketId}/messages`,
    headers: userHeaders("sid-admin"),
    payload: { text: "Здравствуйте, уточните устройство" },
  });
  assert.equal(reply.statusCode, 201);
  assert.equal(reply.json().ticket.status, "waiting_user");

  const patched = await app.inject({
    method: "PATCH",
    url: `/api/admin/support/tickets/${ticketId}`,
    headers: userHeaders("sid-admin"),
    payload: { status: "in_progress", priority: "high", assigned_to: 900 },
  });
  assert.equal(patched.statusCode, 200);
  assert.equal(patched.json().ticket.status, "in_progress");
  assert.equal(patched.json().ticket.priority, "high");
  assert.equal(patched.json().ticket.assignedTo, 900);

  const filtered = await app.inject({
    method: "GET",
    url: "/api/admin/support/tickets?status=in_progress&priority=high",
    headers: userHeaders("sid-admin"),
  });
  assert.equal(filtered.statusCode, 200);
  assert.ok(filtered.json().items.some((t: any) => t.id === ticketId));
});

test("admin support unread endpoint returns a kind breakdown", async () => {
  await createUserTicket("sid-user-201");

  const partnership = await app.inject({
    method: "POST",
    url: "/api/support/partnership",
    headers: userHeaders("sid-user-201"),
    payload: {
      proposalType: "channel",
      platformUrl: "@example",
      offer: "Предлагаю размещение в канале.",
    },
  });
  assert.equal(partnership.statusCode, 201);

  const response = await app.inject({
    method: "GET",
    url: "/api/admin/support/unread",
    headers: userHeaders("sid-admin"),
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.ok(Number(body.support) >= 1, "support unread expected");
  assert.ok(Number(body.partnership) >= 1, "partnership unread expected");
  assert.equal(Number(body.total), Number(body.support) + Number(body.partnership));
  assert.equal(Number(body.count), Number(body.total));
});

test("categories endpoint is available to authenticated users", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/support/categories",
    headers: userHeaders("sid-user-201"),
  });
  assert.equal(response.statusCode, 200);
  assert.ok(response.json().items.some((c: any) => c.key === "connection"));
});

function pngBuffer(width = 4, height = 3): Buffer {
  const buf = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buf, 0);
  buf.writeUInt32BE(13, 8);
  Buffer.from("IHDR").copy(buf, 12);
  buf.writeUInt32BE(width, 16);
  buf.writeUInt32BE(height, 20);
  return buf;
}

test("admin ticket detail, staff reply and patch are forbidden for non-admin", async () => {
  const created = await createUserTicket("sid-user-201");
  const ticketId = created.json().ticket.id;

  const anon = await app.inject({ method: "GET", url: `/api/admin/support/tickets/${ticketId}` });
  assert.equal(anon.statusCode, 401);

  const detail = await app.inject({
    method: "GET",
    url: `/api/admin/support/tickets/${ticketId}`,
    headers: userHeaders("sid-user-201"),
  });
  assert.equal(detail.statusCode, 403);

  const reply = await app.inject({
    method: "POST",
    url: `/api/admin/support/tickets/${ticketId}/messages`,
    headers: userHeaders("sid-user-201"),
    payload: { text: "Попытка ответить от лица оператора" },
  });
  assert.equal(reply.statusCode, 403);

  const patch = await app.inject({
    method: "PATCH",
    url: `/api/admin/support/tickets/${ticketId}`,
    headers: userHeaders("sid-user-201"),
    payload: { status: "closed" },
  });
  assert.equal(patch.statusCode, 403);
});

test("attachment download is owner/admin scoped (no IDOR)", async () => {
  const { addUserMessageWithAttachments } = await import("./service.js");

  const created = await createUserTicket("sid-user-201");
  const ticketId = created.json().ticket.id;

  const ticket = addUserMessageWithAttachments(ticketId, 201, "Файл к обращению", [
    { filename: "photo.png", mimetype: "image/png", buffer: pngBuffer() },
  ]);
  const attachment = (ticket.messages ?? []).flatMap((m: any) => m.attachments ?? [])[0];
  assert.ok(attachment, "expected a stored attachment");

  const anon = await app.inject({ method: "GET", url: `/api/support/attachments/${attachment.id}` });
  assert.equal(anon.statusCode, 401);

  const foreign = await app.inject({
    method: "GET",
    url: `/api/support/attachments/${attachment.id}`,
    headers: userHeaders("sid-user-202"),
  });
  assert.equal(foreign.statusCode, 403);

  const owner = await app.inject({
    method: "GET",
    url: `/api/support/attachments/${attachment.id}`,
    headers: userHeaders("sid-user-201"),
  });
  assert.equal(owner.statusCode, 200);
});

test.after(async () => {
  await app.close();
});

/* ─── User close + partnership API ───────────────────────────────────────── */

test("user can close own ticket and cannot close another user's ticket", async () => {
  const created = await createUserTicket("sid-user-201");
  const ticketId = created.json().ticket.id;

  const foreign = await app.inject({
    method: "POST",
    url: `/api/support/tickets/${ticketId}/close`,
    headers: userHeaders("sid-user-202"),
  });
  assert.equal(foreign.statusCode, 404);

  const closed = await app.inject({
    method: "POST",
    url: `/api/support/tickets/${ticketId}/close`,
    headers: userHeaders("sid-user-201"),
  });
  assert.equal(closed.statusCode, 200);
  assert.equal(closed.json().ticket.status, "closed");

  const replyAfterClose = await app.inject({
    method: "POST",
    url: `/api/support/tickets/${ticketId}/messages`,
    headers: userHeaders("sid-user-201"),
    payload: { text: "После закрытия" },
  });
  assert.equal(replyAfterClose.statusCode, 409);
});

test("user can create a partnership proposal via API", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/support/partnership",
    headers: userHeaders("sid-user-201"),
    payload: {
      proposalType: "channel",
      platformUrl: "@example",
      audienceSize: "~15 000",
      offer: "Предлагаю размещение в тематическом канале.",
    },
  });
  assert.equal(response.statusCode, 201);
  const ticket = response.json().ticket;
  assert.equal(ticket.kind, "partnership");
  assert.match(ticket.publicNo, /^P\d+$/);
});

test("partnership proposal validation returns a domain error", async () => {
  const response = await app.inject({
    method: "POST",
    url: "/api/support/partnership",
    headers: userHeaders("sid-user-201"),
    payload: { proposalType: "channel", platformUrl: "@example", offer: "no" },
  });
  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error, "invalid_offer");
});

/* ─── Message soft delete ───────────────────────────────────────────────── */

test("admin soft-deletes a message; user hides it; admin sees an audit placeholder", async () => {
  const { addUserMessageWithAttachments } = await import("./service.js");
  const created = await createUserTicket("sid-user-201");
  const ticketId = created.json().ticket.id;

  const withFile = addUserMessageWithAttachments(ticketId, 201, "Сообщение с файлом", [
    { filename: "photo.png", mimetype: "image/png", buffer: pngBuffer() },
  ]);
  const message = withFile.messages[withFile.messages.length - 1];
  const attachment = (message.attachments ?? [])[0];
  assert.ok(attachment, "expected a stored attachment");

  const del = await app.inject({
    method: "DELETE",
    url: `/api/admin/support/messages/${message.id}`,
    headers: userHeaders("sid-admin"),
  });
  assert.equal(del.statusCode, 200);
  const adminMsg = del.json().ticket.messages.find((m: any) => m.id === message.id);
  assert.ok(adminMsg, "admin still sees the row for audit");
  assert.ok(adminMsg.deletedAt, "deleted_at is set");
  assert.equal(adminMsg.deletedBy, 900);
  assert.equal(adminMsg.text, "", "admin never receives the deleted body");
  assert.deepEqual(adminMsg.attachments, [], "admin never receives deleted attachments");

  const userView = await app.inject({
    method: "GET",
    url: `/api/support/tickets/${ticketId}`,
    headers: userHeaders("sid-user-201"),
  });
  assert.ok(userView.json().ticket.messages.every((m: any) => m.id !== message.id), "deleted message hidden from user");

  // Attachment is no longer addressable by anyone.
  const att = await app.inject({
    method: "GET",
    url: `/api/support/attachments/${attachment.id}`,
    headers: userHeaders("sid-user-201"),
  });
  assert.equal(att.statusCode, 404);

  // Repeat delete is idempotent and keeps the audit trail.
  const again = await app.inject({
    method: "DELETE",
    url: `/api/admin/support/messages/${message.id}`,
    headers: userHeaders("sid-admin"),
  });
  assert.equal(again.statusCode, 200);
  const againMsg = again.json().ticket.messages.find((m: any) => m.id === message.id);
  assert.equal(againMsg.deletedAt, adminMsg.deletedAt);
});

test("message delete is admin-only and unknown messages are rejected", async () => {
  const created = await createUserTicket("sid-user-201");
  const ticketId = created.json().ticket.id;
  const ticket = await app.inject({
    method: "GET",
    url: `/api/support/tickets/${ticketId}`,
    headers: userHeaders("sid-user-201"),
  });
  const msg = ticket.json().ticket.messages[0];

  const forbidden = await app.inject({
    method: "DELETE",
    url: `/api/admin/support/messages/${msg.id}`,
    headers: userHeaders("sid-user-201"),
  });
  assert.equal(forbidden.statusCode, 403);

  const missing = await app.inject({
    method: "DELETE",
    url: "/api/admin/support/messages/999999",
    headers: userHeaders("sid-admin"),
  });
  assert.equal(missing.statusCode, 404);
});

/* ─── User-centric history ──────────────────────────────────────────────── */

test("user history aggregates all tickets, compensations, notes and timeline", async () => {
  const { getTicketRepository } = await import("./repository.js");
  const repo = getTicketRepository();

  // Same user, different services (Germany / Moscow / Germany again).
  const a = repo.createTicket({ userId: 777, source: "app", categoryKey: "connection", subject: "Germany down", status: "closed", serviceId: 11, serviceSnapshot: { user_service_id: 911, service_id: 11, name: "Germany", status: "ACTIVE" } });
  const b = repo.createTicket({ userId: 777, source: "app", categoryKey: "connection", subject: "Moscow slow", status: "closed", serviceId: 22, serviceSnapshot: { user_service_id: 922, service_id: 22, name: "Moscow", status: "ACTIVE" } });
  const c = repo.createTicket({ userId: 777, source: "app", categoryKey: "connection", subject: "Germany again", status: "open", serviceId: 11, serviceSnapshot: { user_service_id: 911, service_id: 11, name: "Germany", status: "ACTIVE" } });
  repo.addMessage({ ticketId: c.id, authorType: "user", text: "Germany снова не работает" });

  await app.inject({ method: "POST", url: "/api/admin/support/users/777/compensations", headers: userHeaders("sid-admin"), payload: { ticketId: a.id, serviceId: 11, serviceTitle: "Germany", kind: "days", amountDays: 14, description: "+14 дней" } });
  await app.inject({ method: "POST", url: "/api/admin/support/users/777/compensations", headers: userHeaders("sid-admin"), payload: { ticketId: b.id, serviceId: 22, serviceTitle: "Moscow", kind: "days", amountDays: 7, description: "+7 дней" } });
  await app.inject({ method: "POST", url: "/api/admin/support/users/777/notes", headers: userHeaders("sid-admin"), payload: { text: "Germany уже компенсирована 18.09.2026." } });

  const res = await app.inject({ method: "GET", url: "/api/admin/support/users/777/history", headers: userHeaders("sid-admin") });
  assert.equal(res.statusCode, 200);
  const history = res.json().history;

  assert.equal(history.summary.ticketsTotal, 3, "all past tickets are visible");
  assert.equal(history.summary.ticketsOpen, 1);
  assert.equal(history.summary.compensationsTotal, 2);
  assert.equal(history.summary.notesTotal, 1);
  assert.ok(history.tickets.some((t: any) => t.id === a.id), "ticket A visible from ticket C");
  assert.ok(history.tickets.some((t: any) => t.id === b.id), "ticket B (other service) visible");
  assert.ok(history.tickets.every((t: any) => t.userId === 777), "history is scoped by stable user id");
  assert.equal(history.compensations.length, 2);
  assert.ok(history.notes.some((n: any) => n.text.includes("Germany")));
  assert.ok(history.timeline.some((e: any) => e.kind === "ticket"));
  assert.ok(history.timeline.some((e: any) => e.kind === "compensation"));
  assert.ok(history.timeline.some((e: any) => e.kind === "note"));
});

test("user history is admin-only and never leaks via the public ticket API", async () => {
  const history = await app.inject({ method: "GET", url: "/api/admin/support/users/777/history", headers: userHeaders("sid-user-201") });
  assert.equal(history.statusCode, 403);

  const note = await app.inject({ method: "POST", url: "/api/admin/support/users/777/notes", headers: userHeaders("sid-user-201"), payload: { text: "nope" } });
  assert.equal(note.statusCode, 403);

  const comp = await app.inject({ method: "POST", url: "/api/admin/support/users/777/compensations", headers: userHeaders("sid-user-201"), payload: { description: "nope" } });
  assert.equal(comp.statusCode, 403);

  // A normal user's own ticket payload carries no internal history fields.
  const created = await createUserTicket("sid-user-201");
  const own = await app.inject({ method: "GET", url: `/api/support/tickets/${created.json().ticket.id}`, headers: userHeaders("sid-user-201") });
  const body = own.json().ticket;
  assert.equal(body.compensations, undefined);
  assert.equal(body.notes, undefined);
  assert.equal(body.history, undefined);
});

test("user history isolates different users by shm user id", async () => {
  const { getTicketRepository } = await import("./repository.js");
  const repo = getTicketRepository();
  const other = repo.createTicket({ userId: 888, source: "app", categoryKey: "connection", subject: "Other user", status: "open" });

  const res = await app.inject({ method: "GET", url: "/api/admin/support/users/888/history", headers: userHeaders("sid-admin") });
  const history = res.json().history;
  assert.equal(history.summary.ticketsTotal, 1);
  assert.equal(history.tickets[0].id, other.id);

  const foreign = await app.inject({ method: "GET", url: "/api/admin/support/users/777/history", headers: userHeaders("sid-admin") });
  assert.ok(foreign.json().history.tickets.every((t: any) => t.id !== other.id), "other user's ticket is not in the history");
});
