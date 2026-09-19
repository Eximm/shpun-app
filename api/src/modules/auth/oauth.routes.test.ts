import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import cookie from "@fastify/cookie";

import { authRoutes } from "./routes.js";
import { deleteSession, putSession } from "../../shared/session/sessionStore.js";

test("OAuth callback creates a local session without exposing the SHM session in the URL", async () => {
  const originalFetch = globalThis.fetch;
  const originalProviders = process.env.SHM_OAUTH_PROVIDERS;
  const originalOrigin = process.env.APP_ORIGIN;
  process.env.SHM_OAUTH_PROVIDERS = "yandex";
  process.env.APP_ORIGIN = "https://app.example";

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl);
    requestedUrls.push(url.toString());

    if (url.pathname.endsWith("/v1/oauth2/init/yandex")) {
      return Response.json({
        auth_url: "https://oauth.yandex.test/authorize?state=shm-state",
        state: "shm-state",
      });
    }
    if (url.pathname.endsWith("/v1/oauth2/callback/yandex")) {
      return Response.json({ session_id: "shm-secret-session" });
    }
    if (url.pathname.endsWith("/v1/user")) {
      return Response.json({ data: [{ user_id: 77, login: "user@example.com" }] });
    }
    if (url.pathname.includes("/v1/template/shpun_app")) {
      return Response.json({ ok: true });
    }
    return Response.json({ error: "unexpected_request" }, { status: 500 });
  }) as typeof fetch;

  const app = Fastify();
  await app.register(cookie, { secret: "test-secret" });
  await authRoutes(app);

  try {
    const providers = await app.inject({ method: "GET", url: "/auth/oauth/providers" });
    assert.deepEqual(providers.json(), { ok: true, providers: ["yandex"] });

    const start = await app.inject({ method: "GET", url: "/auth/oauth/yandex/start" });
    assert.equal(start.statusCode, 302);
    assert.match(String(start.headers.location), /^https:\/\/oauth\.yandex\.test\//);
    const flowCookie = start.cookies.find((item) => item.name === "shpun_oauth_flow");
    assert.ok(flowCookie?.value);

    const callback = await app.inject({
      method: "GET",
      url: "/auth/oauth/yandex/callback?state=shm-state&code=provider-code",
      cookies: { shpun_oauth_flow: String(flowCookie?.value) },
    });

    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, "/login?a=auth_ok&p=yandex");
    assert.ok(callback.cookies.some((item) => item.name === "sid" && item.value));
    assert.doesNotMatch(String(callback.headers.location), /session_id|shm-secret-session/);

    const callbackRequest = requestedUrls.find((url) => url.includes("/v1/oauth2/callback/yandex"));
    assert.ok(callbackRequest);
    assert.match(String(callbackRequest), /state=shm-state/);
    assert.match(String(callbackRequest), /redirect_uri=https%3A%2F%2Fapp\.example%2Fapi%2Fauth%2Foauth%2Fyandex%2Fcallback/);
  } finally {
    await app.close();
    globalThis.fetch = originalFetch;
    if (originalProviders === undefined) delete process.env.SHM_OAUTH_PROVIDERS;
    else process.env.SHM_OAUTH_PROVIDERS = originalProviders;
    if (originalOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = originalOrigin;
  }
});

test("OAuth bind keeps the SHM session server-side and consumes state once", async () => {
  const originalFetch = globalThis.fetch;
  const originalProviders = process.env.SHM_OAUTH_PROVIDERS;
  const originalOrigin = process.env.APP_ORIGIN;
  process.env.SHM_OAUTH_PROVIDERS = "google";
  process.env.APP_ORIGIN = "https://app.example";

  const localSid = "oauth-bind-test-session";
  putSession(localSid, {
    shmSessionId: "private-shm-session",
    shmUserId: 88,
    login: "bound@example.com",
    createdAt: Date.now(),
  });

  const requestedUrls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const url = new URL(rawUrl);
    requestedUrls.push(url.toString());

    if (url.pathname.endsWith("/v1/oauth2/init/google")) {
      return Response.json({
        auth_url: "https://accounts.google.test/authorize?state=bind-state",
        state: "bind-state",
      });
    }
    if (url.pathname.endsWith("/v1/oauth2/callback/google")) {
      return Response.json({ data: [{ msg: "Successfully bound to google" }] });
    }
    return Response.json({ error: "unexpected_request" }, { status: 500 });
  }) as typeof fetch;

  const app = Fastify();
  await app.register(cookie, { secret: "test-secret" });
  await authRoutes(app);

  try {
    const start = await app.inject({
      method: "GET",
      url: "/auth/oauth/google/start?bind=1",
      cookies: { sid: localSid },
    });
    assert.equal(start.statusCode, 302);
    const flowCookie = start.cookies.find((item) => item.name === "shpun_oauth_flow");
    assert.ok(flowCookie?.value);

    const initRequest = requestedUrls.find((url) => url.includes("/v1/oauth2/init/google"));
    assert.ok(initRequest);
    assert.match(String(initRequest), /bind_to_profile=true/);
    assert.match(String(initRequest), /session_id=private-shm-session/);
    assert.doesNotMatch(String(start.headers.location), /private-shm-session|session_id/);

    const callbackUrl = "/auth/oauth/google/callback?state=bind-state&code=provider-code";
    const callback = await app.inject({
      method: "GET",
      url: callbackUrl,
      cookies: { shpun_oauth_flow: String(flowCookie?.value) },
    });
    assert.equal(callback.statusCode, 302);
    assert.equal(callback.headers.location, "/profile?oauth_status=success&provider=google");

    const replay = await app.inject({
      method: "GET",
      url: callbackUrl,
      cookies: { shpun_oauth_flow: String(flowCookie?.value) },
    });
    assert.equal(replay.statusCode, 302);
    assert.equal(replay.headers.location, "/login?e=oauth_state_invalid");
  } finally {
    await app.close();
    deleteSession(localSid);
    globalThis.fetch = originalFetch;
    if (originalProviders === undefined) delete process.env.SHM_OAUTH_PROVIDERS;
    else process.env.SHM_OAUTH_PROVIDERS = originalProviders;
    if (originalOrigin === undefined) delete process.env.APP_ORIGIN;
    else process.env.APP_ORIGIN = originalOrigin;
  }
});
