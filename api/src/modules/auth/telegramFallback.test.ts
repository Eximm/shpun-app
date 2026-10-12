import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const botToken = "test-login-bot-token";
const calls: string[] = [];
const nativeBodies: Record<string, unknown>[] = [];
const miniAppQueries: URLSearchParams[] = [];
const registeredMiniAppIds = new Set<number>();
registeredMiniAppIds.add(123459);
let nativeMiniAppRegistrationEnabled = false;
const shm = http.createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += String(chunk);
  const url = new URL(req.url ?? "/", "http://billing.test");
  calls.push(`${req.method} ${url.pathname}`);
  res.setHeader("content-type", "application/json");
  if (url.pathname.endsWith("/v1/telegram/webapp/auth")) {
    miniAppQueries.push(new URLSearchParams(url.searchParams));
    const telegramUser = JSON.parse(new URLSearchParams(url.searchParams.get("initData") ?? "").get("user") ?? "{}");
    const telegramId = Number(telegramUser.id ?? 0);
    if (telegramId === 123459 || (nativeMiniAppRegistrationEnabled && telegramId > 0)) {
      const registered = registeredMiniAppIds.has(telegramId) ? 0 : 1;
      registeredMiniAppIds.add(telegramId);
      return res.end(JSON.stringify({ status: 200, data: [{ session_id: "native-session", registered }] }));
    }
  }
  if (url.pathname.endsWith("/v1/telegram/web/auth")) {
    nativeBodies.push(JSON.parse(body || "{}"));
  }
  if (url.pathname.endsWith("/v1/telegram/web/auth") &&
      JSON.parse(body || "{}").id === "123458") {
    return res.end(JSON.stringify({ status: 200, data: [{ session_id: "native-session" }] }));
  }
  if (url.pathname.endsWith("/v1/telegram/web/auth") &&
      JSON.parse(body || "{}").id === "123455") {
    return res.end(JSON.stringify({ status: 200, data: [] }));
  }
  if (url.pathname.endsWith("/v1/telegram/web/auth") &&
      JSON.parse(body || "{}").register_if_not_exists === 1) {
    return res.end(JSON.stringify({ session_id: "native-session" }));
  }
  if (url.pathname.endsWith("/v1/telegram/webapp/auth") ||
      url.pathname.endsWith("/v1/telegram/web/auth")) {
    res.statusCode = 401;
    return res.end(JSON.stringify({ error: "not_linked" }));
  }
  if (url.pathname.endsWith("/v1/user/auth")) {
    return res.end(JSON.stringify({ session_id: "legacy-session" }));
  }
  if (url.pathname.endsWith("/v1/user") && req.method === "GET") {
    return res.end(JSON.stringify({ data: [{ user_id: 123, login: "@123456" }] }));
  }
  return res.end(JSON.stringify({ ok: 1, data: {} }));
});
await new Promise<void>((resolve) => shm.listen(0, "127.0.0.1", resolve));
const port = (shm.address() as { port: number }).port;

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-tg-fallback-"));
process.env.SHM_BASE = `http://127.0.0.1:${port}/shm/`;
process.env.NODE_ENV = "development";
process.env.SHM_TELEGRAM_BOT_TOKEN = botToken;
process.env.TELEGRAM_AUTH_SALT = "test-only-secret";
const { buildServer } = await import("../../app/server.js");
const { shmTelegramWebAuthBind } = await import("../../shared/shm/shmClient.js");
const { saveReferralAlias } = await import("../../shared/linkdb/referralAliasesRepo.js");
const app = await buildServer();
saveReferralAlias({
  alias: "mini_partner",
  linkType: "partner",
  partnerId: 777,
  firstPaymentBonusPercent: 0,
  partnerRewardPercent: 0,
  enabled: true,
});

function signedMiniApp(id: number): string {
  const authDate = String(Math.floor(Date.now() / 1000));
  const user = JSON.stringify({ id, first_name: "Test" });
  const dataCheckString = `auth_date=${authDate}\nuser=${user}`;
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  return new URLSearchParams({ auth_date: authDate, user, hash }).toString();
}

function signedWidget(id: number): Record<string, string> {
  const payload = { auth_date: String(Math.floor(Date.now() / 1000)), id: String(id) };
  const secret = createHash("sha256").update(botToken).digest();
  const hash = createHmac("sha256", secret)
    .update(`auth_date=${payload.auth_date}\nid=${payload.id}`)
    .digest("hex");
  return { ...payload, hash };
}

function passwordCalls(): string[] {
  return calls.filter((call) => call === "POST /shm/v1/user/auth");
}

test("strict SHM 3.x mode does not try a technical password", async () => {
  process.env.SHM_TELEGRAM_PASSWORD_FALLBACK = "0";
  calls.length = 0;
  const result = await app.inject({
    method: "POST",
    url: "/api/auth/telegram",
    payload: { initData: signedMiniApp(123456) },
  });
  assert.equal(result.statusCode, 401);
  assert.equal(passwordCalls().length, 0);
});

test("strict Mini App registers through native SHM once, then logs into the same account", async () => {
  process.env.SHM_TELEGRAM_PASSWORD_FALLBACK = "0";
  nativeMiniAppRegistrationEnabled = true;
  calls.length = 0;
  miniAppQueries.length = 0;
  try {
    const initData = signedMiniApp(123460);
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/telegram",
      payload: { initData, partner_id: 999, referral_alias: "mini_partner" },
    });
    assert.equal(first.statusCode, 200);
    assert.equal(first.json().user_id, 123);
    assert.equal(miniAppQueries[0]?.get("register_if_not_exists"), "1");
    assert.equal(miniAppQueries[0]?.get("partner_id"), "777");
    assert.equal(passwordCalls().length, 0);

    const again = await app.inject({ method: "POST", url: "/api/auth/telegram", payload: { initData: signedMiniApp(123460) } });
    assert.equal(again.statusCode, 200);
    assert.equal(again.json().user_id, first.json().user_id);
    assert.equal(passwordCalls().length, 0);
  } finally {
    nativeMiniAppRegistrationEnabled = false;
  }
});

test("existing Mini App Telegram account remains an ordinary login", async () => {
  process.env.SHM_TELEGRAM_PASSWORD_FALLBACK = "0";
  calls.length = 0;
  const result = await app.inject({ method: "POST", url: "/api/auth/telegram", payload: { initData: signedMiniApp(123459) } });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().user_id, 123);
  assert.equal(passwordCalls().length, 0);
});

test("strict SHM 3.x mode also blocks Widget password fallback", async () => {
  process.env.SHM_TELEGRAM_PASSWORD_FALLBACK = "0";
  calls.length = 0;
  const result = await app.inject({
    method: "POST",
    url: "/api/auth/telegram_widget",
    payload: { ...signedWidget(123456), mode: "login" },
  });
  assert.equal(result.statusCode, 401);
  assert.equal(passwordCalls().length, 0);
});

test("Widget login never registers an unknown Telegram account", async () => {
  process.env.SHM_TELEGRAM_PASSWORD_FALLBACK = "0";
  calls.length = 0;
  nativeBodies.length = 0;
  const result = await app.inject({
    method: "POST",
    url: "/api/auth/telegram_widget",
    payload: { ...signedWidget(123455), mode: "login" },
  });
  assert.equal(result.statusCode, 404);
  assert.equal(result.json().error, "telegram_account_not_found");
  assert.equal(nativeBodies.length, 1);
  assert.equal(nativeBodies[0]?.register_if_not_exists, undefined);
  assert.equal(passwordCalls().length, 0);
});

test("strict Widget login accepts SHM 3.x array-wrapped session", async () => {
  process.env.SHM_TELEGRAM_PASSWORD_FALLBACK = "0";
  calls.length = 0;
  const result = await app.inject({
    method: "POST",
    url: "/api/auth/telegram_widget",
    payload: { ...signedWidget(123458), mode: "login" },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().user_id, 123);
  assert.equal(passwordCalls().length, 0);
});

test("strict Widget registration uses native SHM registration only", async () => {
  process.env.SHM_TELEGRAM_PASSWORD_FALLBACK = "0";
  calls.length = 0;
  const result = await app.inject({
    method: "POST",
    url: "/api/auth/telegram_widget",
    payload: { ...signedWidget(123456), mode: "register" },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().user_id, 123);
  assert.equal(passwordCalls().length, 0);
  assert.ok(calls.includes("POST /shm/v1/telegram/web/auth"));
});

test("forged Mini App data cannot trigger the legacy password path", async () => {
  process.env.SHM_TELEGRAM_PASSWORD_FALLBACK = "1";
  calls.length = 0;
  const forged = new URLSearchParams(signedMiniApp(123457));
  forged.set("user", JSON.stringify({ id: 123456, first_name: "Test" }));
  const result = await app.inject({
    method: "POST",
    url: "/api/auth/telegram",
    payload: { initData: forged.toString() },
  });
  assert.equal(result.statusCode, 401);
  assert.equal(result.json().error, "telegram_signature_invalid");
  assert.equal(passwordCalls().length, 0);
});

test("forged Widget data cannot trigger the legacy password path", async () => {
  process.env.SHM_TELEGRAM_PASSWORD_FALLBACK = "1";
  calls.length = 0;
  const forged = { ...signedWidget(123457), id: "123456" };
  const result = await app.inject({
    method: "POST",
    url: "/api/auth/telegram_widget",
    payload: { ...forged, mode: "register" },
  });
  assert.equal(result.statusCode, 401);
  assert.equal(result.json().error, "telegram_signature_invalid");
  assert.equal(passwordCalls().length, 0);
});

test("legacy fallback fails closed without the login bot token", async () => {
  process.env.SHM_TELEGRAM_PASSWORD_FALLBACK = "1";
  delete process.env.SHM_TELEGRAM_BOT_TOKEN;
  calls.length = 0;
  try {
    const result = await app.inject({
      method: "POST",
      url: "/api/auth/telegram_widget",
      payload: { ...signedWidget(123456), mode: "login" },
    });
    assert.equal(result.statusCode, 401);
    assert.equal(passwordCalls().length, 0);
  } finally {
    process.env.SHM_TELEGRAM_BOT_TOKEN = botToken;
  }
});

test("a signed legacy payload may use the explicit fallback", async () => {
  process.env.SHM_TELEGRAM_PASSWORD_FALLBACK = "1";
  calls.length = 0;
  const result = await app.inject({
    method: "POST",
    url: "/api/auth/telegram_widget",
    payload: { ...signedWidget(123456), mode: "login" },
  });
  assert.equal(result.statusCode, 200);
  assert.equal(result.json().user_id, 123);
  assert.equal(passwordCalls().length, 1);
});

test("SHM 3.x Telegram binding sends the authenticated session, not an ignored uid", async () => {
  nativeBodies.length = 0;
  await shmTelegramWebAuthBind("existing-session", signedWidget(123456));
  const body = nativeBodies.at(-1) ?? {};
  assert.equal(body.session_id, "existing-session");
  assert.equal(body.bind_to_profile, 1);
  assert.equal(body.bind_only_if_new, 1);
  assert.equal("uid" in body, false);
});

test.after(async () => {
  await app.close();
  await new Promise<void>((resolve) => shm.close(() => resolve()));
});
