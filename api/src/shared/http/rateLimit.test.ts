import { test } from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { registerSensitiveRateLimits, rateLimitEnabled } from "./rateLimit.js";

function buildApp() {
  // trustProxy so a per-request X-Forwarded-For becomes req.ip, letting each
  // test case use an isolated client identity against the shared counter.
  const app = Fastify({ trustProxy: true, logger: false });
  registerSensitiveRateLimits(app);
  app.post("/api/auth/password", async () => ({ ok: true }));
  app.post("/api/notifications", async () => ({ ok: true }));
  return app;
}

async function fire(app: ReturnType<typeof buildApp>, url: string, ip: string) {
  const res = await app.inject({
    method: "POST",
    url,
    headers: { "x-forwarded-for": ip },
    payload: {},
  });
  return res.statusCode;
}

test("rateLimitEnabled: off by default outside production, on with flag", () => {
  const prevFlag = process.env.RATE_LIMIT_ENABLED;
  const prevEnv = process.env.NODE_ENV;
  try {
    delete process.env.RATE_LIMIT_ENABLED;
    process.env.NODE_ENV = "test";
    assert.equal(rateLimitEnabled(), false);
    process.env.NODE_ENV = "production";
    assert.equal(rateLimitEnabled(), true);
    process.env.RATE_LIMIT_ENABLED = "0";
    assert.equal(rateLimitEnabled(), false);
    process.env.RATE_LIMIT_ENABLED = "1";
    process.env.NODE_ENV = "test";
    assert.equal(rateLimitEnabled(), true);
  } finally {
    if (prevFlag === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = prevFlag;
    process.env.NODE_ENV = prevEnv;
  }
});

test("sensitive route returns 429 after the per-IP limit", async () => {
  process.env.RATE_LIMIT_ENABLED = "1";
  const app = buildApp();
  try {
    const ip = "203.0.113.10";
    // /api/auth/password limit is 20/min.
    for (let i = 0; i < 20; i++) {
      assert.equal(await fire(app, "/api/auth/password", ip), 200, `request ${i + 1}`);
    }
    assert.equal(await fire(app, "/api/auth/password", ip), 429, "21st request blocked");
    // A different IP is unaffected.
    assert.equal(await fire(app, "/api/auth/password", "203.0.113.11"), 200);
  } finally {
    await app.close();
    delete process.env.RATE_LIMIT_ENABLED;
  }
});

test("non-listed route is never throttled", async () => {
  process.env.RATE_LIMIT_ENABLED = "1";
  const app = buildApp();
  try {
    const ip = "203.0.113.20";
    for (let i = 0; i < 50; i++) {
      assert.equal(await fire(app, "/api/notifications", ip), 200, `poll ${i + 1}`);
    }
  } finally {
    await app.close();
    delete process.env.RATE_LIMIT_ENABLED;
  }
});
