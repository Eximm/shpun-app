import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-support-telegram-"));
process.env.TG_BOT_TOKEN = "test-token";
process.env.SUPPORT_ADMIN_CHAT_IDS = "-1003617067885";
process.env.SUPPORT_ADMIN_THREAD_ID = "96487";
process.env.SUPPORT_APP_URL = "https://app.shpun.net";

const telegram = await import("./telegram.js");
const service = await import("./service.js");

const SUPPORT_CHAT = "-1003617067885";
const SUPPORT_THREAD = 96487;

// Never hit the real network from tests.
const safeFetch = (async () => {
  throw new Error("network disabled in tests");
}) as unknown as typeof fetch;
globalThis.fetch = safeFetch;

let calls: Array<{ url: string; body: any }> = [];

function resetCalls() {
  calls = [];
}

function stubFetch(response: "ok" | "fail" | "throw" = "ok") {
  resetCalls();
  globalThis.fetch = (async (url: any, init: any) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    if (response === "throw") throw new Error("network down");
    calls.push({ url: String(url), body });
    return {
      ok: response === "ok",
      status: response === "ok" ? 200 : 400,
      json: async () => (response === "ok" ? { ok: true } : { ok: false, description: "bad_request" }),
    };
  }) as any;
}

function restoreFetch() {
  globalThis.fetch = safeFetch;
}

function telegramCalls() {
  return calls.filter((c) => c.url.includes("api.telegram.org"));
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 40));

/* ─── Thread routing ─────────────────────────────────────────────────────── */

test("admin thread id is parsed when configured", () => {
  process.env.SUPPORT_ADMIN_THREAD_ID = String(SUPPORT_THREAD);
  assert.equal(telegram.supportAdminThreadId(), SUPPORT_THREAD);
});

test("admin thread id is null when unset", () => {
  delete process.env.SUPPORT_ADMIN_THREAD_ID;
  assert.equal(telegram.supportAdminThreadId(), null);
});

test("invalid admin thread id is ignored", () => {
  for (const value of ["", "abc", "0", "-5", "1.5e999"]) {
    process.env.SUPPORT_ADMIN_THREAD_ID = value;
    assert.equal(telegram.supportAdminThreadId(), null, `value=${value}`);
  }
});

test("payload contains message_thread_id when thread id is configured", async () => {
  process.env.SUPPORT_ADMIN_THREAD_ID = String(SUPPORT_THREAD);
  stubFetch("ok");
  try {
    const result = await telegram.sendSupportTelegramMessage(SUPPORT_CHAT, "hi", undefined, {
      threadId: telegram.supportAdminThreadId(),
    });
    assert.equal(result.ok, true);
    assert.equal(telegramCalls()[0].body.message_thread_id, SUPPORT_THREAD);
  } finally {
    restoreFetch();
  }
});

test("payload has no message_thread_id when thread id is not configured", async () => {
  delete process.env.SUPPORT_ADMIN_THREAD_ID;
  stubFetch("ok");
  try {
    await telegram.sendSupportTelegramMessage(SUPPORT_CHAT, "hi", undefined, {
      threadId: telegram.supportAdminThreadId(),
    });
    assert.equal("message_thread_id" in telegramCalls()[0].body, false);
  } finally {
    restoreFetch();
  }
});

test("payload has no message_thread_id for an invalid thread id", async () => {
  process.env.SUPPORT_ADMIN_THREAD_ID = "not-a-number";
  stubFetch("ok");
  try {
    await telegram.sendSupportTelegramMessage(SUPPORT_CHAT, "hi", undefined, {
      threadId: telegram.supportAdminThreadId(),
    });
    assert.equal("message_thread_id" in telegramCalls()[0].body, false);
  } finally {
    restoreFetch();
  }
});

test("admin fan-out sends to every chat with the same topic", async () => {
  process.env.SUPPORT_ADMIN_CHAT_IDS = "-1003617067885,-1003999999999";
  process.env.SUPPORT_ADMIN_THREAD_ID = String(SUPPORT_THREAD);
  stubFetch("ok");
  try {
    await telegram.sendSupportAdminTelegramMessage("hi");
    const tg = telegramCalls();
    assert.equal(tg.length, 2);
    assert.ok(tg.every((c) => c.body.message_thread_id === SUPPORT_THREAD));
    assert.deepEqual(
      tg.map((c) => c.body.chat_id).sort(),
      ["-1003617067885", "-1003999999999"].sort()
    );
  } finally {
    process.env.SUPPORT_ADMIN_CHAT_IDS = SUPPORT_CHAT;
    restoreFetch();
  }
});

/* ─── Notification semantics ─────────────────────────────────────────────── */

test("new ticket triggers an admin Telegram notification with deep link", async () => {
  process.env.SUPPORT_ADMIN_THREAD_ID = String(SUPPORT_THREAD);
  stubFetch("ok");
  try {
    const ticket = await service.createTicket({
      userId: 501,
      source: "app",
      categoryKey: "connection",
      text: "Не подключается VPN",
    });
    await flush();

    const admin = telegramCalls().find((c) => c.body?.chat_id === SUPPORT_CHAT);
    assert.ok(admin, "admin Telegram message expected");
    assert.equal(admin!.body.message_thread_id, SUPPORT_THREAD);
    assert.match(String(admin!.body.text), /Новый тикет/);
    assert.equal(
      admin!.body.reply_markup?.inline_keyboard?.[0]?.[0]?.url,
      `https://app.shpun.net/admin?tab=support&ticket=${ticket.id}`
    );
  } finally {
    restoreFetch();
  }
});

test("user message triggers an admin Telegram notification", async () => {
  process.env.SUPPORT_ADMIN_THREAD_ID = String(SUPPORT_THREAD);
  stubFetch("ok");
  try {
    const ticket = await service.createTicket({
      userId: 502,
      source: "app",
      categoryKey: "other",
      text: "Первый вопрос",
    });
    resetCalls();

    service.addUserMessage(ticket.id, 502, "Уточняющий вопрос");
    await flush();

    const admin = telegramCalls().find((c) => c.body?.chat_id === SUPPORT_CHAT);
    assert.ok(admin, "admin Telegram message expected");
    assert.match(String(admin!.body.text), /Новый ответ в тикете/);
    assert.equal(admin!.body.message_thread_id, SUPPORT_THREAD);
  } finally {
    restoreFetch();
  }
});

test("staff reply notifies the user and does not notify admins as a new event", async () => {
  stubFetch("ok");
  try {
    const ticket = await service.createTicket({
      userId: 503,
      source: "telegram",
      telegramChatId: 555123,
      categoryKey: "connection",
      text: "Не работает на телефоне",
    });
    resetCalls();

    service.addStaffMessage({
      ticketId: ticket.id,
      operatorId: 900,
      text: "Здравствуйте, уточните устройство",
    });
    await flush();

    const tg = telegramCalls();
    const userMsg = tg.find((c) => String(c.body?.chat_id) === "555123");
    assert.ok(userMsg, "user Telegram message expected");
    assert.match(String(userMsg!.body.text), /есть новый ответ/);
    assert.equal(
      userMsg!.body.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data,
      `support:view ${ticket.id}`
    );
    assert.equal("message_thread_id" in userMsg!.body, false);

    const adminNewReply = tg.find(
      (c) => c.body?.chat_id === SUPPORT_CHAT && /Новый ответ в тикете/.test(String(c.body?.text))
    );
    assert.equal(adminNewReply, undefined, "staff message must not notify admins as a new user event");
  } finally {
    restoreFetch();
  }
});

test("internal note sends no user notification", async () => {
  stubFetch("ok");
  try {
    const ticket = await service.createTicket({
      userId: 504,
      source: "telegram",
      telegramChatId: 555124,
      categoryKey: "other",
      text: "Вопрос",
    });
    resetCalls();

    service.addStaffMessage({
      ticketId: ticket.id,
      operatorId: 900,
      text: "Внутренняя заметка",
      internal: true,
    });
    await flush();

    const userMsg = telegramCalls().find((c) => String(c.body?.chat_id) === "555124");
    assert.equal(userMsg, undefined);
  } finally {
    restoreFetch();
  }
});

test("status-only change sends no Telegram notification", async () => {
  stubFetch("ok");
  try {
    const ticket = await service.createTicket({
      userId: 505,
      source: "telegram",
      telegramChatId: 555125,
      categoryKey: "other",
      text: "Вопрос",
    });
    resetCalls();

    service.updateTicketByAdmin(ticket.id, { status: "in_progress" });
    await flush();
    assert.equal(telegramCalls().length, 0);
  } finally {
    restoreFetch();
  }
});

test("Telegram send failure does not break ticket creation", async () => {
  stubFetch("throw");
  try {
    const ticket = await service.createTicket({
      userId: 506,
      source: "app",
      categoryKey: "connection",
      text: "Проверка отказоустойчивости",
    });
    await flush();
    assert.ok(ticket.id > 0);
  } finally {
    restoreFetch();
  }
});

test("Telegram API error does not break user message", async () => {
  stubFetch("fail");
  try {
    const ticket = await service.createTicket({
      userId: 507,
      source: "app",
      categoryKey: "other",
      text: "Первый вопрос",
    });
    const result = service.addUserMessage(ticket.id, 507, "Ещё сообщение");
    await flush();
    assert.ok(result.messages.some((m) => m.text === "Ещё сообщение"));
  } finally {
    restoreFetch();
  }
});

/* ─── Partnership topic routing ──────────────────────────────────────────── */

test("partnership notification uses PARTNERSHIP_ADMIN_THREAD_ID", async () => {
  process.env.PARTNERSHIP_ADMIN_THREAD_ID = "55555";
  stubFetch("ok");
  try {
    await telegram.sendPartnershipAdminTelegramMessage("hi");
    assert.equal(telegramCalls()[0].body.message_thread_id, 55555);
  } finally {
    delete process.env.PARTNERSHIP_ADMIN_THREAD_ID;
    restoreFetch();
  }
});

test("partnership notification falls back to the general chat when topic is unset", async () => {
  delete process.env.PARTNERSHIP_ADMIN_THREAD_ID;
  stubFetch("ok");
  try {
    await telegram.sendPartnershipAdminTelegramMessage("hi");
    assert.equal("message_thread_id" in telegramCalls()[0].body, false);
  } finally {
    restoreFetch();
  }
});

test("partnership create notifies admins in the partnership topic", async () => {
  process.env.PARTNERSHIP_ADMIN_THREAD_ID = "55555";
  stubFetch("ok");
  try {
    const ticket = await service.createPartnership({
      userId: 508,
      source: "app",
      proposalType: "channel",
      platformUrl: "@example",
      audienceSize: "~15 000",
      offer: "Предлагаю сотрудничество по рекламе в канале.",
    });
    await flush();

    const admin = telegramCalls().find((c) => c.body?.chat_id === SUPPORT_CHAT);
    assert.ok(admin, "partnership admin Telegram message expected");
    assert.equal(admin!.body.message_thread_id, 55555);
    assert.match(String(admin!.body.text), /Новое предложение/);
    assert.ok(
      String(admin!.body.reply_markup?.inline_keyboard?.[0]?.[0]?.url).includes(
        `tab=partnership&ticket=${ticket.id}`
      )
    );
  } finally {
    delete process.env.PARTNERSHIP_ADMIN_THREAD_ID;
    restoreFetch();
  }
});
