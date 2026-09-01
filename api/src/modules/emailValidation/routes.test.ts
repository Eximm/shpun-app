import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";

import { emailValidationRoutes } from "./routes.js";

test("internal domain check rejects disposable mail", async () => {
  const app = Fastify({ trustProxy: true });
  await app.register(emailValidationRoutes, { prefix: "/api" });

  const response = await app.inject({
    method: "GET",
    url: "/api/internal/email-domain/check?domain=mailto.plus",
    headers: { host: "shpun-app-api:3000" },
    remoteAddress: "172.19.0.10",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: false, code: "email_disposable" });
  await app.close();
});

test("internal domain check is hidden from public requests", async () => {
  const app = Fastify({ trustProxy: true });
  await app.register(emailValidationRoutes, { prefix: "/api" });

  const response = await app.inject({
    method: "GET",
    url: "/api/internal/email-domain/check?domain=gmail.com",
    headers: {
      host: "app.shpun.net",
      "x-forwarded-for": "203.0.113.20",
    },
    remoteAddress: "172.19.0.1",
  });

  assert.equal(response.statusCode, 404);
  await app.close();
});
