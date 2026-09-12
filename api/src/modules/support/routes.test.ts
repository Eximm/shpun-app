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

test("admin support unread endpoint returns a count", async () => {
  await createUserTicket("sid-user-201");

  const response = await app.inject({
    method: "GET",
    url: "/api/admin/support/unread",
    headers: userHeaders("sid-admin"),
  });
  assert.equal(response.statusCode, 200);
  assert.ok(Number(response.json().count) >= 1);
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
