import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-crypto-"));
process.env.NODE_ENV = "development";
process.env.SHPUN_CREDENTIALS_MASTER_KEY = "test-master-key-0123456789";

const { encryptSecret, decryptSecret, isCredentialsKeyConfigured, redact } = await import("./crypto.js");
const {
  createIntegration,
  updateIntegration,
  getIntegration,
  listPublicIntegrations,
  getIntegrationCredentials,
  deleteIntegration,
} = await import("./integrationsRepo.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

test("credentials key is reported as configured", () => {
  assert.equal(isCredentialsKeyConfigured(), true);
});

test("AES-256-GCM roundtrip", () => {
  const payload = encryptSecret("hunter2");
  assert.equal(decryptSecret(payload), "hunter2");
  assert.notEqual(payload, "hunter2");
  assert.ok(payload.startsWith("v1:"));
});

test("same plaintext encrypts to different ciphertexts (random IV)", () => {
  assert.notEqual(encryptSecret("same"), encryptSecret("same"));
});

test("wrong master key fails safely instead of throwing", () => {
  const payload = encryptSecret("secret-value");
  process.env.SHPUN_CREDENTIALS_MASTER_KEY = "a-different-master-key";
  assert.equal(decryptSecret(payload), null);
  process.env.SHPUN_CREDENTIALS_MASTER_KEY = "test-master-key-0123456789";
  assert.equal(decryptSecret(payload), "secret-value");
});

test("garbage payloads return null", () => {
  assert.equal(decryptSecret(""), null);
  assert.equal(decryptSecret("not-a-payload"), null);
  assert.equal(decryptSecret("v2:a:b:c"), null);
});

test("redact hides secrets but keeps a short tail", () => {
  const out = redact("supersecrettoken", 2);
  assert.equal(out.endsWith("en"), true);
  assert.equal(out.includes("supersecrettoken"), false);
});

test("integration secrets are encrypted at rest and never returned", () => {
  const created = createIntegration({
    name: "Remnawave Main",
    type: "remnawave",
    metricsUrl: "https://remnawave.example/metrics",
    username: "metrics",
    password: "super-secret-password",
    apiToken: "super-secret-token",
  });
  assert.equal(created.ok, true);
  const row = getIntegration(created.ok ? created.item.id : 0)!;

  // Raw row must not contain plaintext.
  const raw = JSON.stringify(row);
  assert.equal(raw.includes("super-secret-password"), false);
  assert.equal(raw.includes("super-secret-token"), false);
  assert.ok(row.password_encrypted?.startsWith("v1:"));
  assert.ok(row.api_token_encrypted?.startsWith("v1:"));

  const publicItem = listPublicIntegrations().find((i) => i.id === row.id)!;
  assert.equal(publicItem.hasPassword, true);
  assert.equal(publicItem.hasApiToken, true);
  const publicJson = JSON.stringify(publicItem);
  assert.equal(publicJson.includes("super-secret-password"), false);
  assert.equal(publicJson.includes("super-secret-token"), false);
  assert.equal("password" in (publicItem as any), false);
  assert.equal("apiToken" in (publicItem as any), false);

  // Credentials are still readable server-side for outbound calls.
  const creds = getIntegrationCredentials(row);
  assert.equal(creds.password, "super-secret-password");
  assert.equal(creds.apiToken, "super-secret-token");
});

test("empty password on update preserves the stored secret", () => {
  const created = createIntegration({ name: "Keep", type: "remnawave", metricsUrl: "https://x.example/metrics", password: "keep-me" });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;
  updateIntegration(id, { name: "Keep renamed", password: "" });
  assert.equal(getIntegrationCredentials(getIntegration(id)!).password, "keep-me");
});

test("new password on update replaces the secret; clear removes it", () => {
  const created = createIntegration({ name: "Replace", type: "remnawave", metricsUrl: "https://y.example/metrics", password: "old" });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;

  updateIntegration(id, { password: "new" });
  assert.equal(getIntegrationCredentials(getIntegration(id)!).password, "new");

  updateIntegration(id, { clearPassword: true });
  assert.equal(getIntegration(id)!.password_encrypted, null);
  assert.equal(listPublicIntegrations().find((i) => i.id === id)!.hasPassword, false);
  deleteIntegration(id);
});

test("integration rejects an invalid url", () => {
  const created = createIntegration({ name: "Bad", type: "remnawave", metricsUrl: "ftp://bad" });
  assert.equal(created.ok, false);
});

test("production save without a master key fails loudly and stores no plaintext", () => {
  const prevKey = process.env.SHPUN_CREDENTIALS_MASTER_KEY;
  const prevEnv = process.env.NODE_ENV;
  process.env.SHPUN_CREDENTIALS_MASTER_KEY = "";
  process.env.NODE_ENV = "production";
  try {
    const denied = createIntegration({
      name: "NoKey",
      type: "remnawave",
      metricsUrl: "https://nokey.example/metrics",
      password: "plaintext-should-never-persist",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.ok ? "" : denied.error, "credentials_key_missing");

    const rows = linkDb.prepare(`SELECT * FROM monitoring_integrations WHERE name = 'NoKey'`).all() as any[];
    assert.equal(rows.length, 0, "no row may be written without a master key");

    // Monitoring without credentials keeps working in production.
    const plain = createIntegration({ name: "Plain", type: "remnawave", metricsUrl: "https://plain.example/metrics" });
    assert.equal(plain.ok, true);
  } finally {
    process.env.SHPUN_CREDENTIALS_MASTER_KEY = prevKey;
    process.env.NODE_ENV = prevEnv;
  }
});

test("wrong master key on read is reported as a flag, never thrown, never leaked", () => {
  const created = createIntegration({
    name: "WrongKey",
    type: "remnawave",
    metricsUrl: "https://wrongkey.example/metrics",
    password: "topsecret-value",
  });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;
  const row = getIntegration(id)!;

  const prevKey = process.env.SHPUN_CREDENTIALS_MASTER_KEY;
  process.env.SHPUN_CREDENTIALS_MASTER_KEY = "a-totally-different-master-key";
  try {
    const creds = getIntegrationCredentials(row);
    assert.equal(creds.password, null);
    assert.equal(creds.passwordDecryptFailed, true);
    assert.equal(JSON.stringify(creds).includes("topsecret-value"), false);
    // The public projection still only exposes the presence flag.
    const pub = listPublicIntegrations().find((i) => i.id === id)!;
    assert.equal(pub.hasPassword, true);
    assert.equal(JSON.stringify(pub).includes("topsecret-value"), false);
  } finally {
    process.env.SHPUN_CREDENTIALS_MASTER_KEY = prevKey;
  }

  // With the correct key back, the secret is readable again.
  assert.equal(getIntegrationCredentials(getIntegration(id)!).password, "topsecret-value");
  deleteIntegration(id);
});

test.after(() => {
  linkDb.close();
});