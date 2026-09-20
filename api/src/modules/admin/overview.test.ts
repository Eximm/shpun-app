// api/src/modules/admin/overview.test.ts
//
// Regression coverage for GET /api/admin/overview:
//   - admin-only (regular user 403, anonymous 401)
//   - count/aggregate payload only (no sensitive ticket/review/server payload)
//   - today counters + recent activity ordering/limit/safety
//   - updatedAt + partial-degradation flags
//
// Only the external SHM admin check is stubbed (local HTTP server).

import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

/* ── SHM stub (admin.status only) ────────────────────────────────────────── */

const shm = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    const params = new URLSearchParams(body);
    const action = params.get("action");
    const sessionId = params.get("session_id");
    res.setHeader("content-type", "application/json");
    if (action === "admin.status") {
      return res.end(JSON.stringify({ is_admin: sessionId === "shm-admin" ? 1 : 0 }));
    }
    return res.end(JSON.stringify({ ok: 1 }));
  });
});
await new Promise<void>((resolve) => shm.listen(0, "127.0.0.1", resolve));
const shmPort = (shm.address() as { port: number }).port;

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-admin-overview-"));
process.env.SHM_BASE = `http://127.0.0.1:${shmPort}/shm/`;
process.env.NODE_ENV = "development";

const Fastify = (await import("fastify")).default;
const { adminRoutes } = await import("./routes.js");
const { putSession } = await import("../../shared/session/sessionStore.js");
const { createReview } = await import("../reviews/repo.js");
const { getTicketRepository } = await import("../support/repository.js");
const {
  saveReferralAlias,
  recordReferralAliasRegistrationForUser,
} = await import("../../shared/linkdb/referralAliasesRepo.js");

putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 900, login: "admin", createdAt: Date.now() });
putSession("sid-user", { shmSessionId: "shm-user", shmUserId: 901, login: "user", createdAt: Date.now() });

// Pending review + two referral aliases (partner + campaign).
const pending = createReview({
  userId: 902,
  userLogin: "reviewer",
  displayName: "Reviewer",
  rating: 5,
  text: "Отличный сервис, всё работает.",
});
assert.ok(pending);

saveReferralAlias({ alias: "check", linkType: "partner", partnerId: 2, campaignCode: "exCheck" });
saveReferralAlias({ alias: "reklamman", linkType: "campaign", partnerId: 0, billingComment: "Telegram Ads" });
assert.equal(recordReferralAliasRegistrationForUser("check", 903), true);

// One support + one partnership ticket (repository level, no category gate).
const repo = getTicketRepository();
repo.createTicket({ userId: 904, kind: "support", source: "app", categoryKey: "other" });
repo.createTicket({ userId: 905, kind: "partnership", source: "app", categoryKey: "other" });

const app = Fastify();
await app.register(
  async (api) => {
    await adminRoutes(api);
  },
  { prefix: "/api" }
);

function get(sid?: string) {
  return app.inject({
    method: "GET",
    url: "/api/admin/overview",
    headers: sid ? { "x-app-sid": sid } : {},
  });
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

test("admin overview rejects an anonymous request", async () => {
  const res = await get();
  assert.equal(res.statusCode, 401);
});

test("admin overview rejects a regular (non-admin) user", async () => {
  const res = await get("sid-user");
  assert.equal(res.statusCode, 403);
  assert.equal(JSON.parse(res.body).error, "not_admin");
});

test("admin overview returns counts for an admin", async () => {
  const res = await get("sid-admin");
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(typeof json.updatedAt, "string");
  assert.ok(json.updatedAt.length > 0);
  assert.equal(json.attention.reviews, 1);
  assert.equal(json.summary.aliases, 2);
  assert.equal(json.summary.partners, 1);
  assert.equal(json.summary.campaigns, 1);
  assert.equal(typeof json.system.status, "string");
  assert.deepEqual(json.errors, {
    support: false,
    reviews: false,
    system: false,
    summary: false,
    today: false,
    activity: false,
  });
});

test("admin overview returns last-24h counters", async () => {
  const res = await get("sid-admin");
  const json = JSON.parse(res.body);
  assert.ok(json.today.supportTickets >= 1);
  assert.ok(json.today.partnershipTickets >= 1);
  assert.ok(json.today.reviews >= 1);
  assert.ok(json.today.referrals >= 1);
});

test("admin overview activity is limited, newest-first and safe", async () => {
  const res = await get("sid-admin");
  const json = JSON.parse(res.body);
  const activity = json.activity as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(activity));
  assert.ok(activity.length > 0 && activity.length <= 8, "activity must be capped at 8");

  const types = new Set(activity.map((a) => String(a.type)));
  assert.ok(types.has("support.ticket"));
  assert.ok(types.has("partnership.ticket"));
  assert.ok(types.has("review.new"));
  assert.ok(types.has("referral.registration"));
  assert.equal(types.has("unknown"), false);

  for (const item of activity) {
    assert.ok(typeof item.type === "string");
    assert.ok(Number(item.ts) > 0);
  }
  for (let i = 1; i < activity.length; i++) {
    assert.ok(Number(activity[i - 1].ts) >= Number(activity[i].ts), "activity must be newest-first");
  }

  // Safe payload only: no user identity / message text / server internals.
  const raw = res.body;
  for (const forbidden of [
    "exporter_url",
    "\"host\"",
    "user_login",
    "userLogin",
    "display_name",
    "displayName",
    "telegram",
    "balance_snapshot",
    "context_snapshot",
    "\"text\"",
    "\"subject\"",
    "billing_comment",
    "campaign_code",
  ]) {
    assert.equal(raw.includes(forbidden), false, `payload must not contain ${forbidden}`);
  }
});

test.after(async () => {
  await app.close();
  await new Promise<void>((resolve) => shm.close(() => resolve()));
});