import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
let pending = false;
let services: any[] = [];
let projectionAvailable = true;
let created = 0;
const shm = http.createServer((req, res) => {
  let body = "";
  req.on("data", b => body += b);
  req.on("end", () => {
    const action = new URLSearchParams(body).get("action");
    let response: any = { ok: 1, data: {} };
    if (req.url?.includes("template/shpun_app")) {
      if (action === "promo.return.status") response = projectionAvailable ? { ok: 1, return_bonus: { pending: pending ? 1 : 0, tariff_activated: services.some(s => s.service_id === 56) ? 1 : 0, tariff_user_service_id: 99, tariff_id: 56 } } : { ok: 1 };
      if (action === "promo.opportunities.status") response = { ok: 1, return_offer: { pending: pending ? 1 : 0 }, first_pay: {} };
    } else if (req.url?.includes("user/service")) response = { data: services };
    else if (req.url?.includes("service/order") && req.method === "GET") response = { data: [{ service_id: 51, name: "Flex", cost: 200, period: 1, category: "remnawave", config: {} }] };
    else if (req.url?.includes("service/order") && req.method === "PUT") { created++; response = { data: { user_service_id: 100, service_id: 51, status: "NOT PAID" } }; }
    res.setHeader("content-type", "application/json"); res.end(JSON.stringify(response));
  });
});
await new Promise<void>(resolve => shm.listen(0, "127.0.0.1", resolve));
process.env.SHM_BASE = `http://127.0.0.1:${(shm.address() as any).port}/shm/`;
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-return-flow-"));
const { default: Fastify } = await import("fastify");
const { servicesRoutes } = await import("./routes.js");
const { putSession } = await import("../../shared/session/sessionStore.js");
putSession("return-test", { shmSessionId: "billing-test", shmUserId: 183, login: "fixture", createdAt: Date.now() });
const app = Fastify(); await app.register(servicesRoutes, { prefix: "/api" });
const order = (assistant = true, additionalFor?: number) => app.inject({
  method: "PUT",
  url: "/api/services/order",
  headers: { "x-app-sid": "return-test" },
  payload: { service_id: 51, assistant, additional_for_user_service_id: additionalFor },
});
test("pending bonus blocks an order even from an older client", async () => {
  pending = true; services = [];
  assert.equal((await order(false)).statusCode, 409); assert.equal(created, 0);
});
test("activated promotion blocks a duplicate paid plan and a stale wizard", async () => {
  const expire = "2026-11-12T10:29:18.000Z";
  pending = false;
  services = [{ user_service_id: 99, service_id: 56, status: "ACTIVE", next: 51, expire, auto_bill: 1, service: { name: "Flex 7 days", category: "remnawave" } }];
  const duplicate = await order(false);
  assert.equal(duplicate.statusCode, 409);
  const response = duplicate.json();
  assert.equal(response.error, "assistant_existing_access");
  assert.equal(response.reason, "return_plan_active");
  assert.equal(response.userServiceId, 99);
  assert.equal(response.serviceTitle, "Flex 7 days");
  assert.equal(response.expireAt, expire);
  assert.equal(response.autoBill, true);
  assert.ok(response.message);
  assert.equal((await order()).statusCode, 409); assert.equal(created, 0);
});
test("an existing ordinary plan also blocks wizard duplication", async () => {
  services = [{ user_service_id: 98, service_id: 51, status: "ACTIVE", service: { category: "remnawave" } }];
  const duplicate = await order(false);
  assert.equal(duplicate.statusCode, 409);
  assert.equal(duplicate.json().reason, "active_plan");
  assert.equal(duplicate.json().userServiceId, 98);
  assert.equal((await order()).statusCode, 409); assert.equal(created, 0);
});
test("missing billing lifecycle projection holds the order", async () => {
  services = []; projectionAvailable = false;
  assert.equal((await order()).statusCode, 503); assert.equal(created, 0);
});
test("a fresh account without bonus or access can still order", async () => {
  projectionAvailable = true; services = []; pending = false;
  await order(); assert.equal(created, 1);
});
test("a separate Flex order requires manual confirmation for the current active service", async () => {
  services = [{ user_service_id: 99, service_id: 56, status: "ACTIVE", next: 51, service: { category: "remnawave" } }];
  const before = created;
  assert.equal((await order(false, 98)).statusCode, 409);
  assert.equal((await order(true, 99)).statusCode, 409);
  pending = true;
  assert.equal((await order(false, 99)).statusCode, 409);
  assert.equal(created, before);
  pending = false;
  await order(false, 99);
  assert.equal(created, before + 1);
});
test.after(async () => { await app.close(); await new Promise<void>(resolve => shm.close(() => resolve())); });
