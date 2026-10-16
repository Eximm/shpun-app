import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const shm = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", () => {
    try {
      const params = new URLSearchParams(body);
      const action = params.get("action");
      const sessionId = params.get("session_id")
        || /(?:^|;\s*)session_id=([^;]+)/.exec(String(req.headers.cookie || ""))?.[1]
        || "";
      res.setHeader("content-type", "application/json");
      if (action === "admin.status") {
        return res.end(JSON.stringify({ is_admin: sessionId === "shm-admin" ? 1 : 0 }));
      }
      if (action === "promo.opportunities.status") {
        return res.end(JSON.stringify({
          ok: 1,
          return_offer: { code: "RETURN15", eligible: 1, percent: 15, inactive_days: 30, tariff_days: 7 },
          first_pay: { pending: 0, percent: 0 },
          review_reward_amount: 50,
        }));
      }
      return res.end(JSON.stringify({ ok: 0 }));
    } catch (error) {
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: String(error) }));
    }
  });
});
await new Promise<void>((resolve) => shm.listen(0, "127.0.0.1", resolve));
const shmPort = (shm.address() as { port: number }).port;

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-promo-admin-"));
process.env.SHM_BASE = `http://127.0.0.1:${shmPort}/shm/`;
process.env.NODE_ENV = "development";

const Fastify = (await import("fastify")).default;
const { promoAdminRoutes } = await import("./adminRoutes.js");
const { putSession } = await import("../../shared/session/sessionStore.js");

putSession("sid-admin", { shmSessionId: "shm-admin", shmUserId: 900, login: "admin", createdAt: Date.now() });
putSession("sid-user", { shmSessionId: "shm-user", shmUserId: 901, login: "user", createdAt: Date.now() });

const app = Fastify();
await app.register(async (api) => { await promoAdminRoutes(api); }, { prefix: "/api" });

test("promo catalog is admin-only and scans billing values", async () => {
  const anonymous = await app.inject({ method: "GET", url: "/api/admin/promo-catalog" });
  assert.equal(anonymous.statusCode, 401);

  const regular = await app.inject({ method: "GET", url: "/api/admin/promo-catalog", headers: { "x-app-sid": "sid-user" } });
  assert.equal(regular.statusCode, 403);

  const admin = await app.inject({ method: "GET", url: "/api/admin/promo-catalog", headers: { "x-app-sid": "sid-admin" } });
  assert.equal(admin.statusCode, 200);
  const payload = JSON.parse(admin.body);
  assert.equal(payload.source, "billing");
  assert.equal(payload.items.find((item: any) => item.campaignId === "return15").percent, 15);
  assert.equal(payload.items.find((item: any) => item.campaignId === "review_reward").amount, 50);
});

test("admin can change display only, with strict campaign and priority validation", async () => {
  const saved = await app.inject({
    method: "PATCH",
    url: "/api/admin/promo-catalog/return15",
    headers: { "x-app-sid": "sid-admin" },
    payload: { enabled: false, priority: 30 },
  });
  assert.equal(saved.statusCode, 200);
  assert.deepEqual(JSON.parse(saved.body).setting, {
    campaignId: "return15",
    enabled: false,
    priority: 30,
    updatedAt: JSON.parse(saved.body).setting.updatedAt,
  });

  const badPriority = await app.inject({
    method: "PATCH",
    url: "/api/admin/promo-catalog/return15",
    headers: { "x-app-sid": "sid-admin" },
    payload: { enabled: true, priority: 101 },
  });
  assert.equal(badPriority.statusCode, 400);

  const unknown = await app.inject({
    method: "PATCH",
    url: "/api/admin/promo-catalog/unknown",
    headers: { "x-app-sid": "sid-admin" },
    payload: { enabled: true, priority: 10 },
  });
  assert.equal(unknown.statusCode, 404);
});

test.after(async () => {
  await app.close();
  await new Promise<void>((resolve, reject) => shm.close((error) => error ? reject(error) : resolve()));
});
