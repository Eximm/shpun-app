import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-partnership-"));
process.env.TG_BOT_TOKEN = "test-token";
process.env.SUPPORT_ADMIN_CHAT_IDS = "-1003617067885";
process.env.SUPPORT_ADMIN_THREAD_ID = "96487";
process.env.PARTNERSHIP_ADMIN_THREAD_ID = "55555";
process.env.SUPPORT_APP_URL = "https://app.shpun.net";

// Never hit the real network.
globalThis.fetch = (async () => {
  throw new Error("network disabled in tests");
}) as unknown as typeof fetch;

const service = await import("./service.js");
const notifyRepo = await import("./notifyRepo.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

const flush = () => new Promise((resolve) => setTimeout(resolve, 30));

const validInput = {
  userId: 701,
  source: "app" as const,
  proposalType: "channel",
  platformUrl: "@example",
  audienceSize: "~15 000",
  offer: "Предлагаю размещение в тематическом канале на 15000 подписчиков.",
  contact: "@owner",
};

test("creates a partnership proposal with a P-number and structured context", async () => {
  const ticket = await service.createPartnership(validInput);

  assert.equal(ticket.kind, "partnership");
  assert.match(ticket.publicNo, /^P\d+$/);
  assert.equal(ticket.categoryKey, "partnership");
  assert.ok(ticket.messages.length >= 1);
  assert.equal(ticket.userServiceId, null);

  const ctx = ticket.contextSnapshot as any;
  assert.equal(ctx.partnership.proposal_type, "channel");
  assert.equal(ctx.partnership.platform_url, "@example");
  assert.equal(ctx.partnership.audience_size, "~15 000");
});

test("partnership validation rejects invalid input", async () => {
  const rejectsWithCode = async (fn: () => Promise<unknown>, code: string) => {
    await assert.rejects(fn, (error: any) => error?.code === code);
  };

  await rejectsWithCode(
    () => service.createPartnership({ ...validInput, userId: 702, proposalType: "nope" }),
    "invalid_proposal_type"
  );
  await rejectsWithCode(
    () => service.createPartnership({ ...validInput, userId: 702, platformUrl: "" }),
    "invalid_platform"
  );
  await rejectsWithCode(
    () => service.createPartnership({ ...validInput, userId: 702, offer: "short" }),
    "invalid_offer"
  );
});

test("partnership does not require support service ownership", async () => {
  const ticket = await service.createPartnership({
    userId: 703,
    source: "app",
    proposalType: "site",
    platformUrl: "https://example.com",
    offer: "Баннер на сайте с технической аудиторией.",
  });
  assert.equal(ticket.kind, "partnership");
  assert.equal(ticket.userServiceId, null);
});

test("admin list can be filtered by kind", async () => {
  await service.createTicket({
    userId: 704,
    source: "app",
    categoryKey: "other",
    text: "Обычное обращение в поддержку",
  });

  const proposals = service.listAdminTickets({ kind: "partnership" });
  assert.ok(proposals.total >= 1);
  assert.ok(proposals.items.every((t) => t.kind === "partnership"));

  const support = service.listAdminTickets({ kind: "support" });
  assert.ok(support.total >= 1);
  assert.ok(support.items.every((t) => t.kind === "support"));
});

test("user ticket list can be filtered by kind", async () => {
  const proposals = service.listUserTickets(701, { kind: "partnership" });
  assert.ok(proposals.items.every((t) => t.kind === "partnership" && t.userId === 701));

  const support = service.listUserTickets(701, { kind: "support" });
  assert.equal(support.total, 0);
});

test("partnership creation notifies admins in-app with a partnership action", async () => {
  notifyRepo.recordSupportNotifyRecipient(900);

  const ticket = await service.createPartnership({
    userId: 705,
    source: "app",
    proposalType: "youtube",
    platformUrl: "https://youtube.com/@x",
    offer: "Интеграция в видео про VPN и приватность.",
  });
  await flush();

  const row = linkDb
    .prepare(
      `SELECT * FROM notif_events
       WHERE user_id = 900 AND type = 'partnership.created'
       ORDER BY ts DESC LIMIT 1`
    )
    .get() as any;
  assert.ok(row, "partnership.created in-app event expected");

  const meta = JSON.parse(String(row.meta_json));
  assert.equal(meta.kind, "partnership");
  assert.equal(meta.ticketId, ticket.id);
  assert.match(String(meta.action?.to), /tab=partnership/);
});
