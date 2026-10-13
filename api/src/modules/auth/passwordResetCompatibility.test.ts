import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const calls: Array<{ method: string; path: string; login: string; token: string; action: string; session: string }> = [];
const shm = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += String(chunk);
  const url = new URL(req.url ?? "/", "http://billing.test");
  const body = raw ? (String(req.headers["content-type"]).includes("application/x-www-form-urlencoded")
    ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw)) as Record<string, string> : {};
  const login = String(url.searchParams.get("login") ?? body.login ?? "");
  const token = String(url.searchParams.get("token") ?? body.token ?? "");
  calls.push({ method: String(req.method), path: url.pathname, login, token,
    action: String(body.action ?? ""), session: String(body.session_id ?? "") });
  res.setHeader("content-type", "application/json");
  if (url.pathname.endsWith("/v1/user/auth")) {
    return res.end(JSON.stringify({ session_id: "recovered-session" }));
  }
  if (url.pathname.endsWith("/v1/user")) {
    return res.end(JSON.stringify({ data: [{ user_id: 42, login: "@test" }] }));
  }
  if (url.pathname.endsWith("/v1/template/shpun_app")) {
    return res.end(JSON.stringify({ ok: true }));
  }
  if (url.pathname.endsWith("/v1/user/passwd/reset/verify")) {
    const good = login === "second@gmail.com" && token === "valid-reset-token";
    const msg = !good ? "Invalid token" : req.method === "POST"
      ? "Password reset successful" : "Successful";
    return res.end(JSON.stringify({ data: [{ msg }] }));
  }
  if (url.pathname.endsWith("/v1/user/passwd/reset")) {
    return res.end(JSON.stringify({ msg: "Successful" }));
  }
  res.statusCode = 404;
  return res.end(JSON.stringify({ error: "not_found" }));
});
await new Promise<void>((resolve) => shm.listen(0, "127.0.0.1", resolve));
const port = (shm.address() as { port: number }).port;
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-reset-compat-"));
process.env.SHM_BASE = `http://127.0.0.1:${port}/shm/`;
process.env.NODE_ENV = "development";
const { buildServer, sanitizeRequestUrlForLog } = await import("../../app/server.js");
const app = await buildServer();
const { putSession } = await import("../../shared/session/sessionStore.js");

test("request logging redacts reset tokens without hiding the route", () => {
  const safe = sanitizeRequestUrlForLog("/api/auth/password-reset/verify?login=second%40gmail.com&token=private-value");
  assert.ok(safe.startsWith("/api/auth/password-reset/verify?"));
  assert.ok(!safe.includes("private-value"));
});

test("SHM 3 reset checks and confirmation include the login from the link", async () => {
  const verify = await app.inject({ method: "POST", url: "/api/auth/password-reset/verify", payload: {
    login: "second@gmail.com", token: "valid-reset-token",
  } });
  assert.equal(verify.statusCode, 200);
  assert.equal(JSON.parse(verify.body).ok, true);
  const confirm = await app.inject({ method: "POST", url: "/api/auth/password-reset/confirm", payload: {
    login: "second@gmail.com", token: "valid-reset-token", password: "new-password-123",
  } });
  assert.equal(confirm.statusCode, 200);
  assert.equal(JSON.parse(confirm.body).ok, true);
  assert.deepEqual(calls.filter((call) => ["password.mark_set", "onboarding.mark"].includes(call.action))
    .map((call) => [call.action, call.session]),
    [["onboarding.mark", "recovered-session"]]);
  assert.deepEqual(calls.filter((call) => call.path.endsWith("/verify")).map((call) => call.login),
    ["second@gmail.com", "second@gmail.com"]);
});

test("HTTP 200 with a rejected SHM reset token is not treated as success", async () => {
  const before = calls.length;
  const verify = await app.inject({ method: "POST", url: "/api/auth/password-reset/verify", payload: {
    login: "second@gmail.com", token: "bad-token",
  } });
  assert.equal(verify.statusCode, 400);
  const confirm = await app.inject({ method: "POST", url: "/api/auth/password-reset/confirm", payload: {
    login: "second@gmail.com", token: "bad-token", password: "new-password-123",
  } });
  assert.equal(confirm.statusCode, 400);
  assert.ok(calls.slice(before).every((call) => !call.action), "invalid recovery cannot mark a password as set");
});

test("rejected password installation never marks the onboarding step as done", async () => {
  putSession("password-install-test", {
    shmSessionId: "test-shm-session", shmUserId: 42, login: "@test", createdAt: Date.now(),
  });
  const before = calls.length;
  const short = await app.inject({ method: "POST", url: "/api/auth/password/set",
    headers: { cookie: "sid=password-install-test" }, payload: { password: "short" } });
  assert.equal(short.statusCode, 400);
  assert.equal(calls.length, before, "validation must not write password flags");
  const rejected = await app.inject({ method: "POST", url: "/api/auth/password/set",
    headers: { cookie: "sid=password-install-test" }, payload: { password: "valid-length-password" } });
  assert.equal(JSON.parse(rejected.body).ok, false);
  assert.deepEqual(calls.slice(before).map((call) => call.path), ["/shm/v1/user/passwd"],
    "SHM rejection must not call password.mark_set or onboarding.mark");
});

test.after(async () => {
  await app.close();
  await new Promise<void>((resolve) => shm.close(() => resolve()));
});
