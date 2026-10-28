// api/src/modules/auth/referralRegistration.test.ts
//
// Integration coverage for the web registration + referral attribution chain
// through the REAL Fastify routes and services. Only the external SHM billing
// is stubbed (a local HTTP server), so the path
//   POST /api/auth/password -> passwordAuth -> shmFetch -> tryAttachReferral
// is exercised end to end.
//
// Run: npx tsx --test src/modules/auth/referralRegistration.test.ts

import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

/* ── External SHM stub ───────────────────────────────────────────────────── */

type ShmCall = { method: string; path: string; body: string; sessionId?: string };

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(header ?? "").split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function startShmStub() {
  const calls: ShmCall[] = [];
  const sessions = new Map<string, { userId: number; login: string }>();
  let nextUserId = 1000;

  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://shm.local");
      const sessionId = parseCookies(req.headers.cookie as string | undefined).session_id;
      calls.push({ method: String(req.method), path: url.pathname, body, sessionId });
      res.setHeader("content-type", "application/json");

      if (url.pathname.endsWith("/v1/user") && req.method === "PUT") {
        // Stock SHM registration: {login,password[,partner_id]}
        return res.end(JSON.stringify({ ok: 1 }));
      }
      if (url.pathname.endsWith("/v1/user") && req.method === "POST") {
        res.statusCode = 405;
        return res.end(JSON.stringify({ error: "method_not_allowed" }));
      }
      if (url.pathname.endsWith("/v1/user/auth") && req.method === "POST") {
        const parsed = JSON.parse(body || "{}");
        const sid = `shm-sess-${sessions.size + 1}`;
        sessions.set(sid, { userId: nextUserId++, login: String(parsed.login ?? "") });
        return res.end(JSON.stringify({ session_id: sid }));
      }
      if (url.pathname.endsWith("/v1/user") && req.method === "GET") {
        const s = sessionId ? sessions.get(sessionId) : undefined;
        return res.end(JSON.stringify({ data: [{
          user_id: s?.userId ?? 1,
          login: s?.login ?? "",
          phone: s?.login === "profile-update@gmail.com" ? "4796832075" : "",
        }] }));
      }
      if (url.pathname.endsWith("/v1/template/shpun_app") && req.method === "POST") {
        const params = new URLSearchParams(body);
        if (!sessionId || sessionId !== params.get("session_id") || !sessions.has(sessionId)) {
          res.statusCode = 401;
          return res.end(JSON.stringify({ ok: 0, error: "not_authenticated" }));
        }
        if (params.get("action") === "profile.name.initialize") {
          return res.end(JSON.stringify({ ok: 1, data: { ok: 1, saved: 1 } }));
        }
        if (params.get("action") === "profile.name.update") {
          return res.end(JSON.stringify({ ok: 1, data: { ok: 1, saved: 1 } }));
        }
        if (params.get("action") === "referrals.claim") {
          const s = sessions.get(String(params.get("session_id") ?? ""));
          return res.end(JSON.stringify({
            ok: 1,
            data: { campaign_initialized: 1, partner_confirmed: 1, user_id: s?.userId ?? 0 },
          }));
        }
        if (params.get("action") === "campaign.claim") {
          const s = sessions.get(String(params.get("session_id") ?? ""));
          return res.end(JSON.stringify({ ok: 1, data: { comment_written: 1, user_id: s?.userId ?? 0 } }));
        }
        return res.end(JSON.stringify({ ok: 1, data: {} }));
      }
      return res.end(JSON.stringify({ ok: 1 }));
    });
  });

  return { server, calls, sessions };
}

/* ── Test bootstrap ──────────────────────────────────────────────────────── */

const shmStub = startShmStub();
await new Promise<void>((resolve) => shmStub.server.listen(0, "127.0.0.1", resolve));
const shmPort = (shmStub.server.address() as { port: number }).port;

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-referral-registration-"));
process.env.SHM_BASE = `http://127.0.0.1:${shmPort}/shm/`;
process.env.NODE_ENV = "development";
process.env.AUTH_DEBUG = "0";
process.env.REFERRAL_DEBUG = "0";
process.env.SHM_REFERRAL_SECRET = "test-referral-secret";

const { buildServer } = await import("../../app/server.js");
const { saveReferralAlias, findReferralAlias } = await import("../../shared/linkdb/referralAliasesRepo.js");

const app = await buildServer();

saveReferralAlias({
  alias: "blogger_one",
  linkType: "partner",
  partnerId: 777,
  firstPaymentBonusPercent: 20,
  partnerRewardPercent: 50,
  enabled: true,
});
saveReferralAlias({
  alias: "telegram_news",
  linkType: "campaign",
  partnerId: 0,
  billingComment: "Реклама Telegram",
  firstPaymentBonusPercent: 15,
  enabled: true,
});

function shmRegisterBodies(login: string): string[] {
  return shmStub.calls
    .filter((c) => c.method === "PUT" && c.path.endsWith("/v1/user"))
    .map((c) => c.body)
    .filter((b) => b.includes(login));
}

async function register(payload: Record<string, unknown>) {
  return app.inject({
    method: "POST",
    url: "/api/auth/password",
    headers: { "content-type": "application/json" },
    payload,
  });
}

/* ── Tests ───────────────────────────────────────────────────────────────── */

test("registration accepts six characters, rejects five, and does not restrict existing logins", async () => {
  const before = shmStub.calls.length;
  const short = await register({ login: "shortpass@gmail.com", password: "12345", mode: "register" });
  assert.equal(short.statusCode, 400);
  assert.equal(JSON.parse(short.body).error, "password_too_short");
  assert.equal(shmStub.calls.length, before, "short registration must not reach SHM");

  const valid = await register({ login: "sixpass@gmail.com", password: "a1B2c3", mode: "register" });
  assert.equal(valid.statusCode, 200);
  assert.equal(shmRegisterBodies("sixpass@gmail.com").length, 1, "six-character password reaches SHM");

  const login = await register({ login: "existing@gmail.com", password: "12345", mode: "login" });
  assert.equal(login.statusCode, 200, "login does not impose the new-registration minimum");
});

test("registration without referral still works", async () => {
  const res = await register({ login: "plain@gmail.com", password: "supersecret1", mode: "register" });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  const body = shmRegisterBodies("plain@gmail.com")[0] ?? "";
  assert.ok(body.includes("plain@gmail.com"));
  assert.ok(!body.includes("partner_id"), "no partner_id must be sent for a direct registration");
});

test("registration initializes the entered name through the protected template", async () => {
  const login = "named@gmail.com";
  const res = await register({
    login,
    password: "supersecret1",
    client: "Микита Тсыкаловский",
    mode: "register",
    referral_alias: "blogger_one",
  });
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(shmRegisterBodies(login)[0] ?? "{}");
  assert.equal(body.partner_id, 777);
  assert.equal(body.full_name, undefined, "the stock SHM registration route drops full_name");
  const nameCall = shmStub.calls.find((c) => c.body.includes("action=profile.name.initialize") && c.body.includes("%D0%9C%D0%B8%D0%BA%D0%B8%D1%82%D0%B0"));
  assert.ok(nameCall);
  assert.ok(nameCall.sessionId?.startsWith("shm-sess-"), "the template must receive the authenticated cookie");
  assert.equal(shmStub.calls.filter((c) => c.method === "POST" && c.path.endsWith("/v1/user")).length, 0);
});

test("registration uses the email as name when the optional field is empty", async () => {
  const login = "nameless@gmail.com";
  const res = await register({ login, password: "supersecret1", client: "", mode: "register" });
  assert.equal(res.statusCode, 200);
  const nameCall = shmStub.calls.find((c) => c.body.includes("action=profile.name.initialize") && c.body.includes(`full_name=${encodeURIComponent(login)}`));
  assert.ok(nameCall);
});

test("profile name update uses the protected template and leaves the phone login untouched", async () => {
  const registered = await register({ login: "profile-update@gmail.com", password: "supersecret1", mode: "register" });
  assert.equal(registered.statusCode, 200);
  const cookie = String(registered.headers["set-cookie"] ?? "").split(";")[0];
  assert.ok(cookie.startsWith("sid="));

  const before = shmStub.calls.length;
  const updated = await app.inject({
    method: "POST",
    url: "/api/user/profile",
    headers: { cookie },
    payload: { full_name: "Updated Name", phone: "4796832075" },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(JSON.parse(updated.body).full_name, "Updated Name");
  const calls = shmStub.calls.slice(before);
  assert.ok(calls.some((c) => c.body.includes("action=profile.name.update") && c.sessionId));
  assert.equal(calls.filter((c) => c.method === "POST" && c.path.endsWith("/v1/user")).length, 0);

  const beforeChangedPhone = shmStub.calls.length;
  const refused = await app.inject({
    method: "POST",
    url: "/api/user/profile",
    headers: { cookie },
    payload: { full_name: "Another Name", phone: "4796832076" },
  });
  assert.equal(refused.statusCode, 409);
  assert.equal(JSON.parse(refused.body).error, "phone_change_requires_separate_flow");
  assert.equal(shmStub.calls.slice(beforeChangedPhone).filter((c) => c.body.includes("action=profile.name.update")).length, 0);
});

test("valid partner alias is attributed through the backend claim path", async () => {
  const before = findReferralAlias("blogger_one")?.registrations_count ?? 0;
  const res = await register({
    login: "aliased@gmail.com",
    password: "supersecret1",
    mode: "register",
    referral_alias: "blogger_one",
  });
  assert.equal(res.statusCode, 200);

  const claim = shmStub.calls.find(
    (c) => c.body.includes("action=referrals.claim") && c.body.includes("referral_alias=blogger_one")
  );
  assert.ok(claim, "referrals.claim must be called for a valid alias");
  assert.ok(claim!.body.includes("partner_id=777"), "claim must carry the resolved partner_id");
  assert.equal(findReferralAlias("blogger_one")?.registrations_count, before + 1);
});

test("partner_id only is forwarded to SHM at registration", async () => {
  const res = await register({
    login: "directpartner@gmail.com",
    password: "supersecret1",
    mode: "register",
    partner_id: 777,
  });
  assert.equal(res.statusCode, 200);
  const body = shmRegisterBodies("directpartner@gmail.com")[0] ?? "";
  assert.ok(body.includes("\"partner_id\":777"));
});

test("invalid alias never breaks registration and creates no attribution", async () => {
  const res = await register({
    login: "invalida@gmail.com",
    password: "supersecret1",
    mode: "register",
    referral_alias: "does_not_exist",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  const claim = shmStub.calls.find((c) => c.body.includes("referral_alias=does_not_exist"));
  assert.equal(claim, undefined, "unknown alias must not reach the billing claim");
});

test("empty referral strings do not break registration (Number('') class bug)", async () => {
  const res = await register({
    login: "emptyref@gmail.com",
    password: "supersecret1",
    mode: "register",
    partner_id: "",
    referral_alias: "",
  });
  assert.equal(res.statusCode, 200);
  const body = shmRegisterBodies("emptyref@gmail.com")[0] ?? "";
  assert.ok(!body.includes("partner_id"), "empty partner_id must not be forwarded as a field");
});

test("campaign alias is claimed without a partner id", async () => {
  const before = findReferralAlias("telegram_news")?.registrations_count ?? 0;
  const res = await register({
    login: "campaign@gmail.com",
    password: "supersecret1",
    mode: "register",
    referral_alias: "telegram_news",
    partner_id: 777,
    first_pay: 99,
  });
  assert.equal(res.statusCode, 200);
  const claim = shmStub.calls.find((c) => c.body.includes("action=campaign.claim"));
  assert.ok(claim, "campaign.claim must be called for a campaign alias");
  assert.ok(claim!.body.includes("campaign_alias=telegram_news"));
  const params = new URLSearchParams(claim!.body);
  assert.equal(params.get("first_pay"), "15");
  assert.equal(params.has("partner_id"), false);
  assert.equal(params.get("referral_secret"), "test-referral-secret");
  assert.ok(!shmRegisterBodies("campaign@gmail.com")[0].includes("partner_id"));
  assert.equal(findReferralAlias("telegram_news")?.registrations_count, before + 1);
});

test("logging in through a campaign does not attach or reset a first-payment bonus", async () => {
  const before = shmStub.calls.filter((call) => call.body.includes("action=campaign.claim")).length;
  const res = await register({ login: "returning@gmail.com", password: "supersecret1", mode: "login", referral_alias: "telegram_news" });
  assert.equal(res.statusCode, 200);
  assert.equal(shmStub.calls.filter((call) => call.body.includes("action=campaign.claim")).length, before);
});

/* ── Campaign click/visit accounting ─────────────────────────────────────── */

test("campaign visits_count increments once per resolve call (no dedup)", async () => {
  const before = findReferralAlias("telegram_news")?.visits_count ?? 0;
  const r1 = await app.inject({ method: "GET", url: "/api/referrals/resolve?alias=telegram_news" });
  const r2 = await app.inject({ method: "GET", url: "/api/referrals/resolve?alias=telegram_news" });
  assert.equal(r1.statusCode, 200);
  assert.equal(r2.statusCode, 200);
  assert.equal(findReferralAlias("telegram_news")?.visits_count, before + 2);
});

test("invalid and unknown aliases do not increment visits", async () => {
  const before = findReferralAlias("telegram_news")?.visits_count ?? 0;
  const invalid = await app.inject({ method: "GET", url: "/api/referrals/resolve?alias=%21%21" });
  const unknown = await app.inject({ method: "GET", url: "/api/referrals/resolve?alias=ghost_visits" });
  assert.equal(invalid.statusCode, 400);
  assert.equal(unknown.statusCode, 404);
  assert.equal(findReferralAlias("telegram_news")?.visits_count, before);
});

test("disabled alias does not increment visits", async () => {
  saveReferralAlias({ alias: "paused_campaign", linkType: "campaign", partnerId: 0, billingComment: "paused", enabled: false });
  const before = findReferralAlias("telegram_news")?.visits_count ?? 0;
  const res = await app.inject({ method: "GET", url: "/api/referrals/resolve?alias=paused_campaign" });
  assert.equal(res.statusCode, 404);
  assert.equal(findReferralAlias("paused_campaign"), null, "disabled alias stays hidden from lookup");
  assert.equal(findReferralAlias("telegram_news")?.visits_count, before);
});

test("two different aliases keep separate statistics", async () => {
  saveReferralAlias({ alias: "campaign_b", linkType: "campaign", partnerId: 0, billingComment: "campaign B", enabled: true });
  const aBefore = findReferralAlias("telegram_news")?.visits_count ?? 0;
  const bBefore = findReferralAlias("campaign_b")?.visits_count ?? 0;
  await app.inject({ method: "GET", url: "/api/referrals/resolve?alias=campaign_b" });
  assert.equal(findReferralAlias("campaign_b")?.visits_count, bBefore + 1);
  assert.equal(findReferralAlias("telegram_news")?.visits_count, aBefore);
});

test("a second user can register through the same partner link", async () => {
  const before = findReferralAlias("blogger_one")?.registrations_count ?? 0;
  const res = await register({
    login: "seconduser@gmail.com",
    password: "supersecret1",
    mode: "register",
    referral_alias: "blogger_one",
  });
  assert.equal(res.statusCode, 200);
  assert.equal(findReferralAlias("blogger_one")?.registrations_count, before + 1);
});

/* ── Plain user referral (numeric partner_id from /referrals) ────────────── */

test("user referral: numeric partner_id is forwarded to SHM and claimed", async () => {
  const res = await register({
    login: "userref1@gmail.com",
    password: "supersecret1",
    mode: "register",
    partner_id: 555,
  });
  assert.equal(res.statusCode, 200);
  const body = shmRegisterBodies("userref1@gmail.com")[0] ?? "";
  assert.ok(body.includes("\"partner_id\":555"), "SHM registration must carry the referrer id");
  const claim = shmStub.calls.find(
    (c) => c.body.includes("action=referrals.claim") && c.body.includes("partner_id=555")
  );
  assert.ok(claim, "referrals.claim must confirm the user referrer");
  assert.ok(!claim!.body.includes("referral_alias="), "a plain user referral has no alias");
});

test("user referral: two users can register through the same referrer", async () => {
  const r1 = await register({ login: "userref2a@gmail.com", password: "supersecret1", mode: "register", partner_id: 555 });
  const r2 = await register({ login: "userref2b@gmail.com", password: "supersecret1", mode: "register", partner_id: 555 });
  assert.equal(r1.statusCode, 200);
  assert.equal(r2.statusCode, 200);
  assert.ok((shmRegisterBodies("userref2a@gmail.com")[0] ?? "").includes("\"partner_id\":555"));
  assert.ok((shmRegisterBodies("userref2b@gmail.com")[0] ?? "").includes("\"partner_id\":555"));
});

test("direct registration creates no referral claim", async () => {
  const before = shmStub.calls.filter((c) => c.body.includes("action=referrals.claim")).length;
  const res = await register({ login: "directnoref@gmail.com", password: "supersecret1", mode: "register" });
  assert.equal(res.statusCode, 200);
  const after = shmStub.calls.filter((c) => c.body.includes("action=referrals.claim")).length;
  assert.equal(after, before, "no claim must be sent without a referral");
});

test("alias is authoritative over a conflicting numeric partner_id", async () => {
  const res = await register({
    login: "conflict@gmail.com",
    password: "supersecret1",
    mode: "register",
    partner_id: 999,
    referral_alias: "blogger_one",
  });
  assert.equal(res.statusCode, 200);
  const body = shmRegisterBodies("conflict@gmail.com")[0] ?? "";
  assert.ok(body.includes("\"partner_id\":777"), "SHM must receive the alias partner, not the supplied number");
  assert.ok(!body.includes("\"partner_id\":999"));
  const claim = shmStub.calls.find(
    (c) => c.body.includes("action=referrals.claim") && c.body.includes("referral_alias=blogger_one")
  );
  assert.ok(claim && claim.body.includes("partner_id=777"));
});

test("disallowed e-mail domain returns a safe structured code", async () => {
  const res = await register({ login: "person@company.example", password: "supersecret1", mode: "register" });
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, "email_domain_not_allowed");
});

/* ── Public resolver / security ──────────────────────────────────────────── */

test("public resolver returns only minimal, non-private partner data", async () => {
  const res = await app.inject({ method: "GET", url: "/api/referrals/resolve?alias=blogger_one" });
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.alias, "blogger_one");
  assert.equal(json.linkType, "partner");
  assert.equal(json.partnerId, 777);
  for (const forbidden of [
    "first_payment_bonus_percent",
    "partner_reward_percent",
    "campaign_code",
    "billing_comment",
    "billingComment",
    "partner_reward",
  ]) {
    assert.equal(Object.prototype.hasOwnProperty.call(json, forbidden), false, `must not expose ${forbidden}`);
  }
});

test("public resolver rejects invalid and unknown aliases predictably", async () => {
  const invalid = await app.inject({ method: "GET", url: "/api/referrals/resolve?alias=%20%21" });
  assert.equal(invalid.statusCode, 400);
  assert.equal(JSON.parse(invalid.body).error, "invalid_alias");

  const unknown = await app.inject({ method: "GET", url: "/api/referrals/resolve?alias=ghost_alias" });
  assert.equal(unknown.statusCode, 404);
  assert.equal(JSON.parse(unknown.body).error, "alias_not_found");
});

test("disabled aliases are not resolvable", async () => {
  saveReferralAlias({ alias: "disabled_one", linkType: "partner", partnerId: 888, enabled: false });
  const res = await app.inject({ method: "GET", url: "/api/referrals/resolve?alias=disabled_one" });
  assert.equal(res.statusCode, 404);
});

/* ── Telegram internal endpoints (bot -> app) ───────────────────────────── */

function telegramGet(path: string, host = "shpun-app-api") {
  return app.inject({ method: "GET", url: `/api${path}`, headers: { host } });
}

function telegramBotClaim(body: Record<string, unknown>, secret = "test-referral-secret") {
  return app.inject({
    method: "POST",
    url: "/api/internal/referrals/telegram-bot-claim",
    headers: { host: "shpun-app-api", "x-bot-referral-secret": secret },
    payload: body,
  });
}

test("bot-completed partner attribution is counted once without replaying its SHM session", async () => {
  const before = findReferralAlias("blogger_one")?.registrations_count ?? 0;
  const claim = { alias: "blogger_one", user_id: 95001, partner_id: 777, comment_written: true, referral_initialized: true };
  assert.equal((await app.inject({
    method: "POST",
    url: "/api/internal/referrals/telegram-bot-claim",
    headers: { host: "public.example", "x-bot-referral-secret": "test-referral-secret" },
    payload: claim,
  })).statusCode, 404);
  assert.equal((await telegramBotClaim(claim, "")).statusCode, 403);
  assert.equal((await telegramBotClaim(claim, "wrong")).statusCode, 403);
  assert.equal((await telegramBotClaim({ ...claim, partner_id: 999 })).statusCode, 409);
  assert.equal((await telegramBotClaim({ ...claim, referral_initialized: false })).statusCode, 409);
  const first = await telegramBotClaim(claim);
  assert.equal(first.statusCode, 200);
  assert.equal(JSON.parse(first.body).registered, 1);
  const replay = await telegramBotClaim(claim);
  assert.equal(replay.statusCode, 200);
  assert.equal(JSON.parse(replay.body).registered, 0);
  assert.equal((await telegramBotClaim({ ...claim, comment_written: "1", referral_initialized: "1" })).statusCode, 200);
  assert.equal(findReferralAlias("blogger_one")?.registrations_count, before + 1);
});

function shmTemplateCalls(action: string): ShmCall[] {
  return shmStub.calls.filter(
    (c) => c.path.endsWith("/v1/template/shpun_app") && c.body.includes(`action=${action}`)
  );
}

test("internal telegram-resolve returns partner data and counts a visit", async () => {
  const before = findReferralAlias("blogger_one")?.visits_count ?? 0;
  const res = await telegramGet("/internal/referrals/telegram-resolve?alias=blogger_one");
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.linkType, "partner");
  assert.equal(json.alias, "blogger_one");
  assert.equal(json.partnerId, 777);
  assert.equal(json.firstPayPercent, 20);
  assert.equal(json.campaign_code, "");
  assert.equal(json.comment, "blogger_one");
  assert.equal(findReferralAlias("blogger_one")?.visits_count, before + 1);
});

test("internal telegram-resolve?visit=0 canonicalizes without counting a visit", async () => {
  const before = findReferralAlias("blogger_one")?.visits_count ?? 0;
  const res = await telegramGet("/internal/referrals/telegram-resolve?alias=blogger_one&visit=0");
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.linkType, "partner");
  assert.equal(json.partnerId, 777);
  assert.equal(findReferralAlias("blogger_one")?.visits_count, before, "visit=0 must not increment the counter");
});

test("internal telegram-resolve rejects disabled aliases (no injected partner bypass)", async () => {
  saveReferralAlias({ alias: "paused_partner", linkType: "partner", partnerId: 777, enabled: false });
  const res = await telegramGet("/internal/referrals/telegram-resolve?alias=paused_partner&visit=0");
  assert.equal(res.statusCode, 404);
  assert.equal(JSON.parse(res.body).error, "alias_not_found");
});

test("internal telegram-resolve returns the campaign billing comment", async () => {
  const res = await telegramGet("/internal/referrals/telegram-resolve?alias=telegram_news");
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.linkType, "campaign");
  assert.equal(json.partnerId, 0);
  assert.equal(json.firstPayPercent, 15);
  assert.equal(json.billing_comment, "Реклама Telegram");
  assert.equal(json.billingComment, "Реклама Telegram");
  assert.equal(json.comment, "Реклама Telegram");
});

test("internal telegram-resolve exposes the partner comment source (campaign_code)", async () => {
  saveReferralAlias({
    alias: "partner_named",
    linkType: "partner",
    partnerId: 777,
    campaignCode: "Blogger One",
    enabled: true,
  });
  const res = await telegramGet("/internal/referrals/telegram-resolve?alias=partner_named&visit=0");
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.linkType, "partner");
  assert.equal(json.alias, "partner_named");
  assert.equal(json.partnerId, 777);
  assert.equal(json.billing_comment, "");
  assert.equal(json.campaign_code, "Blogger One");
  assert.equal(json.campaignCode, "Blogger One");
  assert.equal(json.comment, "Blogger One");
});

test("internal telegram-resolve rejects invalid and unknown aliases", async () => {
  const invalid = await telegramGet("/internal/referrals/telegram-resolve?alias=%20%21");
  assert.equal(invalid.statusCode, 400);
  const unknown = await telegramGet("/internal/referrals/telegram-resolve?alias=ghost_tg");
  assert.equal(unknown.statusCode, 404);
});

test("internal telegram endpoints reject non-internal hosts", async () => {
  const resolve = await telegramGet("/internal/referrals/telegram-resolve?alias=blogger_one", "app.shpun.net");
  assert.equal(resolve.statusCode, 404);
  const claim = await telegramGet(
    "/internal/referrals/telegram-claim?alias=blogger_one&session_id=s&user_id=1",
    "app.shpun.net"
  );
  assert.equal(claim.statusCode, 404);
});

test("internal telegram-claim confirms a partner alias and forwards the secret", async () => {
  const res = await telegramGet(
    "/internal/referrals/telegram-claim?alias=blogger_one&session_id=shm-sess-1&user_id=4242"
  );
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.linkType, "partner");
  assert.equal(json.partnerId, 777);

  const claims = shmTemplateCalls("referrals.claim");
  assert.ok(claims.length > 0, "SHM referrals.claim must be called");
  const body = claims[claims.length - 1].body;
  assert.ok(body.includes("partner_id=777"), "claim must carry the partner id");
  assert.ok(body.includes("referral_alias=blogger_one"), "claim must carry the alias");
  assert.ok(body.includes("referral_secret=test-referral-secret"), "claim must forward SHM_REFERRAL_SECRET");
  assert.equal(claims[claims.length - 1].sessionId, "shm-sess-1", "protected claim requires the SHM session cookie");
});

test("internal telegram-claim writes a campaign comment", async () => {
  const res = await telegramGet(
    "/internal/referrals/telegram-claim?alias=telegram_news&session_id=shm-sess-1&user_id=4242"
  );
  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.ok, true);
  assert.equal(json.linkType, "campaign");

  const claims = shmTemplateCalls("campaign.claim");
  assert.ok(claims.length > 0, "SHM campaign.claim must be called");
  const body = claims[claims.length - 1].body;
  assert.ok(body.includes("campaign_alias=telegram_news"));
  assert.equal(new URLSearchParams(body).get("first_pay"), "15");
  assert.equal(new URLSearchParams(body).has("partner_id"), false);
  assert.ok(body.includes("campaign_comment="));
  assert.ok(body.includes("referral_secret=test-referral-secret"));
});

test("internal telegram-claim forwards the partner campaign_code as first_pay_campaign", async () => {
  const res = await telegramGet(
    "/internal/referrals/telegram-claim?alias=partner_named&session_id=shm-sess-1&user_id=4242"
  );
  assert.equal(res.statusCode, 200);
  const claims = shmTemplateCalls("referrals.claim");
  assert.ok(claims.length > 0);
  const params = new URLSearchParams(claims[claims.length - 1].body);
  assert.equal(params.get("partner_id"), "777");
  assert.equal(params.get("first_pay_campaign"), "Blogger One");
  assert.equal(params.get("referral_comment"), "Blogger One");
});

/* ── Cross-transport canonical comment ──────────────────────────────────── */

test("cross-transport: web registration sends the canonical partner comment", async () => {
  const res = await register({
    login: "webref@gmail.com",
    password: "supersecret1",
    mode: "register",
    referral_alias: "partner_named",
  });
  assert.equal(res.statusCode, 200);
  const claims = shmTemplateCalls("referrals.claim");
  const params = new URLSearchParams(claims[claims.length - 1].body);
  assert.equal(params.get("partner_id"), "777");
  assert.equal(params.get("first_pay_campaign"), "Blogger One");
  assert.equal(params.get("referral_comment"), "Blogger One");
});

test("cross-transport: partner without campaign_code falls back to alias", async () => {
  const res = await register({
    login: "webref2@gmail.com",
    password: "supersecret1",
    mode: "register",
    referral_alias: "blogger_one",
  });
  assert.equal(res.statusCode, 200);
  const params = new URLSearchParams(shmTemplateCalls("referrals.claim").pop()!.body);
  assert.equal(params.get("first_pay_campaign"), "blogger_one");
  assert.equal(params.get("referral_comment"), "blogger_one");
});

test("cross-transport: campaign comment is the billing_comment (never alias)", async () => {
  const res = await register({
    login: "webrefc@gmail.com",
    password: "supersecret1",
    mode: "register",
    referral_alias: "telegram_news",
  });
  assert.equal(res.statusCode, 200);
  const params = new URLSearchParams(shmTemplateCalls("campaign.claim").pop()!.body);
  assert.equal(params.get("campaign_comment"), "Реклама Telegram");
});

test("internal telegram-claim requires a session id", async () => {
  const res = await telegramGet("/internal/referrals/telegram-claim?alias=blogger_one");
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, "missing_session_id");
});

test.after(async () => {
  await app.close();
  await new Promise<void>((resolve) => shmStub.server.close(() => resolve()));
});
