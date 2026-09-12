import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

// ---------------------------------------------------------------------------
// End-to-end notification routing for staff replies.
// Exercises the real admin reply route -> service -> notification dispatcher,
// with a mocked Telegram sender and the real notif_events repo.
// ---------------------------------------------------------------------------

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-staff-notify-"));
process.env.SHM_SUPPORT_SECRET = "test-secret";
process.env.TG_BOT_TOKEN = "test-token";
process.env.SUPPORT_ADMIN_CHAT_IDS = "-100support";
process.env.SUPPORT_ADMIN_THREAD_ID = "96487";
process.env.PARTNERSHIP_ADMIN_THREAD_ID = "55555";
process.env.SUPPORT_APP_URL = "https://app.shpun.net";

const Fastify = (await import("fastify")).default;
const { supportRoutes } = await import("./routes.js");
const { supportInternalRoutes } = await import("./internalRoutes.js");
const { supportAdminRoutes } = await import("./adminRoutes.js");
const { setSupportShmPort } = await import("./snapshot.js");
const { setSupportAdminChecker } = await import("./adminGuard.js");
const { putSession } = await import("../../shared/session/sessionStore.js");
const { linkDb } = await import("../../shared/linkdb/db.js");
const service = await import("./service.js");

const SECRET = "test-secret";
const SUPPORT_CHAT = "-100support";
const SUPPORT_THREAD = 96487;
const PARTNERSHIP_THREAD = 55555;

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

setSupportShmPort({
  async resolveIdentity(sessionId: string) {
    const map: Record<string, any> = {
      "shm-app": { userId: 501, login: "appuser", displayName: "App User", balance: 100, bonus: 0 },
      "shm-tg": { userId: 502, login: "tguser", displayName: "TG User", balance: 0, bonus: 0 },
    };
    const value = map[sessionId];
    if (!value) throw new Error("support_shm_identity_failed:401");
    return value;
  },
  async resolveOwnedService() {
    return null;
  },
});
setSupportAdminChecker(async (shmSessionId) => shmSessionId === "shm-admin");

putSession("sid-app", { shmSessionId: "shm-app", shmUserId: 501, login: "appuser", createdAt: Date.now() });
putSession("sid-tg", { shmSessionId: "shm-tg", shmUserId: 502, login: "tguser", createdAt: Date.now() });
putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 900, login: "admin", createdAt: Date.now() });

const app = Fastify();
await app.register(
  async (api) => {
    await supportRoutes(api);
    await supportInternalRoutes(api);
    await supportAdminRoutes(api);
  },
  { prefix: "/api" }
);

/* ─── Helpers ────────────────────────────────────────────────────────────── */

const originalFetch = globalThis.fetch;
let tgCalls: Array<{ url: string; body: any }> = [];

function stubFetch() {
  tgCalls = [];
  globalThis.fetch = (async (url: any, init: any) => {
    let body: any = null;
    if (init?.body) {
      if (typeof init.body === "string") {
        try { body = JSON.parse(init.body); } catch { body = init.body; }
      } else {
        body = { __formData: true };
      }
    }
    tgCalls.push({ url: String(url), body });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  }) as any;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}
function telegramCalls() {
  return tgCalls.filter((c) => c.url.includes("api.telegram.org"));
}
function sendMessageCalls() {
  return telegramCalls().filter((c) => /\/sendMessage$/.test(c.url));
}
function sendsTo(chatId: string) {
  return sendMessageCalls().filter((c) => String(c.body?.chat_id) === chatId);
}
function ownerEvents(userId: number, typePrefix = "support.") {
  return linkDb
    .prepare(`SELECT * FROM notif_events WHERE user_id = ? AND type LIKE ? ORDER BY ts ASC`)
    .all(userId, `${typePrefix}%`) as any[];
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 40));
const adminHeaders = { "x-app-sid": "sid-admin", "content-type": "application/json" };

async function adminReply(ticketId: number, text: string, extra: Record<string, any> = {}) {
  return app.inject({
    method: "POST",
    url: `/api/admin/support/tickets/${ticketId}/messages`,
    headers: adminHeaders,
    payload: { text, ...extra },
  });
}

async function createAppTicket(): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: "/api/support/tickets",
    headers: { "x-app-sid": "sid-app", "content-type": "application/json" },
    payload: { categoryKey: "other", text: "Обращение из приложения" },
  });
  return res.json().ticket.id;
}

async function createTelegramTicket(chatId: number): Promise<number> {
  const res = await app.inject({
    method: "POST",
    url: "/api/internal/support/tickets",
    headers: { "x-support-secret": SECRET, "content-type": "application/json" },
    payload: {
      session_id: "shm-tg",
      telegram_chat_id: chatId,
      category_key: "other",
      text: "Обращение из Telegram",
    },
  });
  return res.json().ticket.id;
}

/* ─── Support / Telegram ─────────────────────────────────────────────────── */

test("support telegram: staff reply notifies the user in Telegram", async () => {
  stubFetch();
  try {
    const ticketId = await createTelegramTicket(7654321);
    tgCalls = [];
    await adminReply(ticketId, "Оператор ответил");
    await flush();

    const userMsgs = sendsTo("7654321");
    assert.equal(userMsgs.length, 1, "exactly one Telegram message to the user");
    assert.match(String(userMsgs[0].body.text), /есть новый ответ/);
    assert.equal(
      userMsgs[0].body.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data,
      `support:view ${ticketId}`
    );
    // No in-app owner event for a telegram-source ticket (avoid double delivery).
    assert.equal(ownerEvents(502).length, 0);
  } finally {
    restoreFetch();
  }
});

test("support telegram: attachment-only staff reply forwards the file", async () => {
  stubFetch();
  try {
    const ticketId = await createTelegramTicket(7654322);
    tgCalls = [];
    service.addStaffMessage({
      ticketId,
      operatorId: 900,
      text: "",
      files: [{ filename: "shot.jpg", mimetype: "image/jpeg", buffer: JPEG }],
    });
    await flush();

    assert.equal(sendsTo("7654322").length, 1, "short notification expected");
    assert.ok(
      telegramCalls().some((c) => /\/sendPhoto$/.test(c.url)),
      "attachment should be forwarded via sendPhoto"
    );
  } finally {
    restoreFetch();
  }
});

/* ─── Support / App ──────────────────────────────────────────────────────── */

test("support app: staff reply notifies the owner in-app, not Telegram", async () => {
  stubFetch();
  try {
    const ticketId = await createAppTicket();
    tgCalls = [];
    const res = await adminReply(ticketId, "Ответ из приложения");
    assert.equal(res.statusCode, 201);
    await flush();

    const events = ownerEvents(501);
    const replyEvent = events.find(
      (e) => e.type === "support.reply" && Number(JSON.parse(String(e.meta_json)).ticketId) === ticketId
    );
    assert.ok(replyEvent, "owner support.reply event expected");
    const meta = JSON.parse(String(replyEvent.meta_json));
    assert.equal(meta.ticketId, ticketId);
    assert.equal(String(meta.action?.to), `/support?ticket=${ticketId}`);

    // No Telegram message to the owner (only admin notifications may exist).
    assert.equal(sendsTo("501").length, 0);
  } finally {
    restoreFetch();
  }
});

test("support app: attachment-only staff reply creates an in-app event with file preview", async () => {
  stubFetch();
  try {
    const ticketId = await createAppTicket();
    tgCalls = [];
    service.addStaffMessage({
      ticketId,
      operatorId: 900,
      text: "",
      files: [{ filename: "report.pdf", mimetype: "application/pdf", buffer: Buffer.from("%PDF-1.4 test") }],
    });
    await flush();

    const replyEvent = ownerEvents(501).find(
      (e) => e.type === "support.reply" && Number(JSON.parse(String(e.meta_json)).ticketId) === ticketId
    );
    assert.ok(replyEvent, "owner support.reply event expected");
    assert.match(String(replyEvent!.message), /Поддержка отправила вложение/);
  } finally {
    restoreFetch();
  }
});

test("support app with a telegram_chat_id still notifies app only", async () => {
  stubFetch();
  try {
    // Construct an app-source ticket that happens to have a Telegram chat id.
    const ticket = await service.createTicket({
      userId: 501,
      source: "app",
      telegramChatId: 999888777,
      categoryKey: "other",
      text: "App ticket with a stray chat id",
    });
    tgCalls = [];
    await adminReply(ticket.id, "Ответ только в приложение");
    await flush();

    assert.equal(sendsTo("999888777").length, 0, "must not send Telegram for app source");
    assert.ok(ownerEvents(501).some((e) => e.type === "support.reply"));
  } finally {
    restoreFetch();
  }
});

/* ─── Silence rules ──────────────────────────────────────────────────────── */

test("internal note does not notify the user", async () => {
  stubFetch();
  try {
    const ticketId = await createTelegramTicket(7654323);
    tgCalls = [];
    await adminReply(ticketId, "Внутренняя заметка", { internal: true });
    await flush();

    assert.equal(sendsTo("7654323").length, 0);
    assert.equal(ownerEvents(502).length, 0);
  } finally {
    restoreFetch();
  }
});

test("status-only change does not notify the user", async () => {
  stubFetch();
  try {
    const ticketId = await createTelegramTicket(7654324);
    tgCalls = [];
    await app.inject({
      method: "PATCH",
      url: `/api/admin/support/tickets/${ticketId}`,
      headers: adminHeaders,
      payload: { status: "in_progress", priority: "high" },
    });
    await flush();

    assert.equal(sendsTo("7654324").length, 0);
    assert.equal(ownerEvents(502).length, 0);
  } finally {
    restoreFetch();
  }
});

/* ─── Partnership ────────────────────────────────────────────────────────── */

test("partnership telegram: staff reply notifies the applicant in Telegram", async () => {
  stubFetch();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/internal/support/partnership",
      headers: { "x-support-secret": SECRET, "content-type": "application/json" },
      payload: {
        session_id: "shm-tg",
        telegram_chat_id: 7654325,
        proposal_type: "channel",
        platform_url: "@example",
        offer: "Предлагаю размещение в канале.",
      },
    });
    const ticketId = res.json().ticket.id;
    tgCalls = [];
    await adminReply(ticketId, "Ответ по предложению");
    await flush();

    assert.equal(sendsTo("7654325").length, 1);
    assert.match(String(sendsTo("7654325")[0].body.text), /По предложению/);
  } finally {
    restoreFetch();
  }
});

test("partnership app: staff reply notifies the owner in-app", async () => {
  stubFetch();
  try {
    const res = await app.inject({
      method: "POST",
      url: "/api/support/partnership",
      headers: { "x-app-sid": "sid-app", "content-type": "application/json" },
      payload: {
        proposalType: "channel",
        platformUrl: "@example",
        offer: "Предлагаю размещение в канале.",
      },
    });
    const ticketId = res.json().ticket.id;
    tgCalls = [];
    await adminReply(ticketId, "Ответ по предложению");
    await flush();

    const replyEvent = ownerEvents(501, "partnership.").find(
      (e) => e.type === "partnership.reply" && Number(JSON.parse(String(e.meta_json)).ticketId) === ticketId
    );
    assert.ok(replyEvent, "owner partnership.reply event expected");
    assert.equal(sendsTo("501").length, 0);
  } finally {
    restoreFetch();
  }
});

/* ─── Admin routing: support vs partnership topics ───────────────────────── */

test("support and partnership use different admin topics", async () => {
  stubFetch();
  try {
    tgCalls = [];
    const supportId = await createAppTicket();
    const partnershipRes = await app.inject({
      method: "POST",
      url: "/api/support/partnership",
      headers: { "x-app-sid": "sid-app", "content-type": "application/json" },
      payload: { proposalType: "channel", platformUrl: "@e", offer: "Предложение о рекламе в канале." },
    });
    await flush();

    const supportCreate = sendMessageCalls().find((c) => /Новый тикет/.test(String(c.body?.text)));
    const partnershipCreate = sendMessageCalls().find((c) => /Новое предложение/.test(String(c.body?.text)));
    assert.ok(supportCreate);
    assert.ok(partnershipCreate);
    assert.equal(supportCreate!.body.message_thread_id, SUPPORT_THREAD);
    assert.equal(partnershipCreate!.body.message_thread_id, PARTNERSHIP_THREAD);
    assert.notEqual(supportCreate!.body.message_thread_id, partnershipCreate!.body.message_thread_id);
    void supportId;
    void partnershipRes;
  } finally {
    restoreFetch();
  }
});

/* ─── User attachment-only reply -> admin preview ────────────────────────── */

test("attachment-only user reply notifies admins with a file preview", async () => {
  stubFetch();
  try {
    const ticketId = await createAppTicket();
    tgCalls = [];
    service.addUserMessageWithAttachments(ticketId, 501, "", [
      { filename: "shot.png", mimetype: "image/png", buffer: JPEG },
    ]);
    await flush();

    const adminMsg = sendMessageCalls().find((c) => c.body?.chat_id === SUPPORT_CHAT);
    assert.ok(adminMsg, "admin Telegram notification expected");
    assert.match(String(adminMsg!.body.text), /Пользователь отправил вложение/);
  } finally {
    restoreFetch();
  }
});

test.after(async () => {
  await app.close();
});
