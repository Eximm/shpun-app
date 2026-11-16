import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-appearance-"));
const Fastify = (await import("fastify")).default;
const { appearanceRoutes } = await import("./routes.js");
const { putSession } = await import("../../shared/session/sessionStore.js");
const { getAppearance } = await import("./repo.js");
const app = Fastify();
await appearanceRoutes(app, async (sid) => sid === "admin");
putSession("appearance-admin", { shmSessionId: "admin", shmUserId: 7001, createdAt: Date.now() });
putSession("appearance-user", { shmSessionId: "user", shmUserId: 7002, createdAt: Date.now() });

test.after(async () => { await app.close(); });
test("appearance defaults to classic and exposes only visual settings", async () => {
  const response = await app.inject({ method: "GET", url: "/appearance" });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { ok: true, settings: { theme: "classic", effectsEnabled: true, gamesEnabled: true } });
  assert.equal(response.headers["cache-control"], "no-store");
});
test("anonymous and regular users cannot change the global theme", async () => {
  const payload = { theme: "neon", effectsEnabled: true, gamesEnabled: true };
  const anonymous = await app.inject({ method: "PUT", url: "/admin/appearance", payload });
  const regular = await app.inject({ method: "PUT", url: "/admin/appearance", payload, headers: { "x-app-sid": "appearance-user" } });
  assert.equal(anonymous.statusCode, 401); assert.equal(regular.statusCode, 403);
  assert.equal(getAppearance().theme, "classic");
});
test("admin can switch both themes, disable effects/games and roll back; values persist", async () => {
  for (const theme of ["neon", "winter", "classic"]) {
    const payload = { theme, effectsEnabled: false, gamesEnabled: false };
    const response = await app.inject({ method: "PUT", url: "/admin/appearance", payload, headers: { "x-app-sid": "appearance-admin" } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(getAppearance(), payload);
    assert.deepEqual((await app.inject({ method: "GET", url: "/appearance" })).json().settings, payload);
  }
});
test("invalid themes and missing settings never overwrite a saved theme", async () => {
  for (const payload of [{ theme: "arbitrary", effectsEnabled: true, gamesEnabled: true }, { theme: "neon" }]) {
    const response = await app.inject({ method: "PUT", url: "/admin/appearance", payload, headers: { "x-app-sid": "appearance-admin" } });
    assert.equal(response.statusCode, 400);
    assert.equal(getAppearance().theme, "classic");
  }
});
