import assert from "node:assert/strict";
import test from "node:test";

import {
  shmDeleteUserEmail,
  shmGetMe,
  shmGetPayForecast,
  shmGetPaySystems,
  shmGetUserAccounts,
  shmGetUserEmail,
  shmRequestUserEmailVerify,
  shmTelegramWebAuthBind,
  shmTelegramWebAuthRegister,
} from "./shmClient.js";

type CapturedRequest = {
  url: URL;
  method: string;
  body: any;
};

async function captureRequest(run: () => Promise<unknown>): Promise<CapturedRequest> {
  const originalFetch = globalThis.fetch;
  let captured: CapturedRequest | null = null;

  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const rawUrl = input instanceof Request ? input.url : String(input);
    const rawBody = init?.body ? String(init.body) : "";
    captured = {
      url: new URL(rawUrl),
      method: String(init?.method ?? "GET").toUpperCase(),
      body: rawBody ? JSON.parse(rawBody) : null,
    };
    return new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await run();
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.ok(captured);
  return captured;
}

test("email verification uses the endpoint shared by SHM 2.x and 3.x", async () => {
  const req = await captureRequest(() =>
    shmRequestUserEmailVerify("session", { email: "user@example.com", code: "123456" })
  );

  assert.equal(req.url.pathname, "/shm/v1/user/email");
  assert.equal(req.method, "POST");
  assert.deepEqual(req.body, { email: "user@example.com", code: "123456" });
});

test("email deletion includes the email required by SHM 3.x", async () => {
  const req = await captureRequest(() => shmDeleteUserEmail("session", "user@example.com"));

  assert.equal(req.url.pathname, "/shm/v1/user/email");
  assert.equal(req.method, "DELETE");
  assert.deepEqual(req.body, { email: "user@example.com" });
});

test("accounts capability probe uses the SHM 3.x user endpoint", async () => {
  const req = await captureRequest(() => shmGetUserAccounts("session"));

  assert.equal(req.url.pathname, "/shm/v1/user/accounts");
  assert.equal(req.method, "GET");
  assert.equal(req.body, null);
});

test("single-resource GET requests do not send list params rejected by SHM 3.x", async () => {
  for (const run of [
    () => shmGetMe("session"),
    () => shmGetUserEmail("session"),
    () => shmGetPaySystems("session"),
    () => shmGetPayForecast("session"),
  ]) {
    const req = await captureRequest(run);
    assert.equal(req.url.search, "");
  }
});

test("payment helpers only send parameters declared by the SHM 3.x schema", async () => {
  const paysystems = await captureRequest(() =>
    shmGetPaySystems("session", { amount: 500, paysystem: "test", pp: true })
  );
  assert.equal(paysystems.url.searchParams.get("amount"), "500");
  assert.equal(paysystems.url.searchParams.get("paysystem"), "test");
  assert.equal(paysystems.url.searchParams.get("pp"), "true");

  const forecast = await captureRequest(() =>
    shmGetPayForecast("session", { days: 30, consider_today: true, blocked: false })
  );
  assert.equal(forecast.url.searchParams.get("days"), "30");
  assert.equal(forecast.url.searchParams.get("consider_today"), "true");
  assert.equal(forecast.url.searchParams.get("blocked"), "false");
});

test("Telegram binding keeps the SHM 2.x uid contract", async () => {
  const req = await captureRequest(() =>
    shmTelegramWebAuthBind("legacy-session", 42, { id: "123", hash: "hash" })
  );

  assert.equal(req.url.pathname, "/shm/v1/telegram/web/auth");
  assert.equal(req.body.uid, 42);
  assert.equal("session_id" in req.body, false);
  assert.equal(req.body.bind_to_profile, true);
});

test("Telegram binding uses session_id for the SHM 3.x accounts contract", async () => {
  const req = await captureRequest(() =>
    shmTelegramWebAuthBind(
      "modern-session",
      42,
      { id: "123", hash: "hash" },
      undefined,
      { accountsApi: true }
    )
  );

  assert.equal(req.body.session_id, "modern-session");
  assert.equal("uid" in req.body, false);
  assert.equal(req.body.bind_only_if_new, true);
});

test("Telegram registration omits partner_id rejected by the SHM 3.x schema", async () => {
  const req = await captureRequest(() =>
    shmTelegramWebAuthRegister(
      { id: "123", auth_date: "1700000000", hash: "hash" },
      { clientIp: "203.0.113.10" }
    )
  );

  assert.equal(req.body.register_if_not_exists, 1);
  assert.equal("partner_id" in req.body, false);
});
