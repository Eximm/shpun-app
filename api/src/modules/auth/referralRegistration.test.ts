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
        // Registration: {login,password[,partner_id]}
        return res.end(JSON.stringify({ ok: 1 }));
      }
      if (url.pathname.endsWith("/v1/user/auth") && req.method === "POST") {
        const parsed = JSON.parse(body || "{}");
        const sid = `shm-sess-${sessions.size + 1}`;
        sessions.set(sid, { userId: nextUserId++, login: String(parsed.login ?? "") });
        return res.end(JSON.stringify({ session_id: sid }));
      }
      if (url.pathname.endsWith("/v1/user") && req.method === "GET") {
        const s = sessionId ? sessions.get(sessionId) : undefined;
        return res.end(JSON.stringify({ data: [{ user_id: s?.userId ?? 1, login: s?.login ?? "" }] }));
      }
      if (url.pathname.endsWith("/v1/template/shpun_app") && req.method === "POST") {
        const params = new URLSearchParams(body);
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

test("registration without referral still works", async () => {
  const res = await register({ login: "plain@gmail.com", password: "supersecret1", mode: "register" });
  assert.equal(res.statusCode, 200);
  assert.equal(JSON.parse(res.body).ok, true);
  const body = shmRegisterBodies("plain@gmail.com")[0] ?? "";
  assert.ok(body.includes("plain@gmail.com"));
  assert.ok(!body.includes("partner_id"), "no partner_id must be sent for a direct registration");
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
  });
  assert.equal(res.statusCode, 200);
  const claim = shmStub.calls.find((c) => c.body.includes("action=campaign.claim"));
  assert.ok(claim, "campaign.claim must be called for a campaign alias");
  assert.ok(claim!.body.includes("campaign_alias=telegram_news"));
  assert.equal(findReferralAlias("telegram_news")?.registrations_count, before + 1);
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

test.after(async () => {
  await app.close();
  await new Promise<void>((resolve) => shmStub.server.close(() => resolve()));
});