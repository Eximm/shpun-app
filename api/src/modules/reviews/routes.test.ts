import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

let enabled = true;
let amount = 50;
let unavailable = false;
const credits = new Map<number, number>();
const shm = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => { body += chunk; });
  req.on("end", () => {
    const params = new URLSearchParams(body);
    const action = params.get("action");
    res.setHeader("content-type", "application/json");
    if (action === "admin.status") {
      return res.end(JSON.stringify({ ok: 1, is_admin: params.get("session_id") === "admin" ? 1 : 0 }));
    }
    if (action === "promo.opportunities.status") {
      if (unavailable) {
        res.statusCode = 503;
        return res.end(JSON.stringify({ ok: 0 }));
      }
      return res.end(JSON.stringify({ ok: 1, review_reward: { active: enabled ? 1 : 0, amount } }));
    }
    if (action === "admin.review.reward") {
      const id = Number(params.get("review_id"));
      const requested = Number(params.get("amount"));
      const previous = credits.get(id);
      credits.set(id, previous ?? requested);
      return res.end(JSON.stringify({
        ok: 1,
        review_id: id,
        target_user_id: Number(params.get("target_user_id")),
        amount: previous ?? requested,
        bonus_added: previous == null ? requested : 0,
        already_rewarded: previous == null ? 0 : 1,
      }));
    }
    return res.end(JSON.stringify({ ok: 0 }));
  });
});
await new Promise<void>((resolve) => shm.listen(0, "127.0.0.1", resolve));
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-review-lifecycle-"));
process.env.SHM_BASE = `http://127.0.0.1:${(shm.address() as { port: number }).port}/shm/`;
const Fastify = (await import("fastify")).default;
const { reviewsRoutes } = await import("./routes.js");
const { putSession } = await import("../../shared/session/sessionStore.js");
const { createReview, getReviewById, hasReviewByUserId } = await import("./repo.js");
for (const [sid, userId] of [["admin", 100], ["customer", 101], ["inactive", 102], ["outage", 103]] as const) {
  putSession(sid, { shmSessionId: sid, shmUserId: userId, createdAt: Date.now() });
}
const app = Fastify();
await app.register(reviewsRoutes);

test("review promises survive campaign closure and rewards stay once per account", async () => {
  const submitted = await app.inject({
    method: "POST", url: "/reviews", headers: { "x-app-sid": "customer" },
    payload: { text: "Подробный отзыв о работе сервиса", rating: 4 },
  });
  assert.equal(submitted.statusCode, 201, submitted.body);
  const id = submitted.json().item.id;
  assert.equal(getReviewById(id)?.reward_offer_amount, 50);
  enabled = false;
  amount = 100;
  const approved = await app.inject({ method: "POST", url: `/reviews/${id}/approve`, headers: { "x-app-sid": "admin" } });
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().bonusAdded, 50);
  assert.equal(credits.get(id), 50);
  const retry = await app.inject({ method: "POST", url: `/reviews/${id}/approve`, headers: { "x-app-sid": "admin" } });
  assert.equal(retry.json().alreadyRewarded, true);
  assert.equal(credits.size, 1);
  const duplicate = await app.inject({
    method: "POST", url: "/reviews", headers: { "x-app-sid": "customer" },
    payload: { text: "Повторный отзыв с того же аккаунта" },
  });
  assert.equal(duplicate.statusCode, 409);
});

test("reviews submitted after campaign closure publish without a reward", async () => {
  const submitted = await app.inject({
    method: "POST", url: "/reviews", headers: { "x-app-sid": "inactive" },
    payload: { text: "Отзыв после завершения бонусной акции" },
  });
  assert.equal(submitted.statusCode, 201, submitted.body);
  const id = submitted.json().item.id;
  assert.equal(getReviewById(id)?.reward_offer_status, "none");
  const approved = await app.inject({ method: "POST", url: `/reviews/${id}/approve`, headers: { "x-app-sid": "admin" } });
  assert.equal(approved.statusCode, 200, approved.body);
  assert.equal(approved.json().bonusAdded, 0);
  assert.equal(credits.has(id), false);
});

test("billing outage cannot silently cancel a promised review bonus", async () => {
  unavailable = true;
  const response = await app.inject({
    method: "POST", url: "/reviews", headers: { "x-app-sid": "outage" },
    payload: { text: "Не теряем бонус при недоступном биллинге" },
  });
  assert.equal(response.statusCode, 503);
  assert.equal(hasReviewByUserId(103), false);
  unavailable = false;
});

test("legacy pending reviews keep their reward after campaign closure", async () => {
  const review = createReview({ userId: 104, userLogin: "legacy", displayName: "Legacy", rating: 5, text: "Отзыв отправлен до обновления приложения" })!;
  const response = await app.inject({ method: "POST", url: `/reviews/${review.id}/approve`, headers: { "x-app-sid": "admin" } });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(credits.get(review.id), 100);
  assert.equal(getReviewById(review.id)?.reward_offer_amount, 100);
});

test.after(async () => {
  await app.close();
  await new Promise<void>((resolve) => shm.close(() => resolve()));
});
