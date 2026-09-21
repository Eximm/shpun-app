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
  createMonitoredServer,
  updateMonitoredServer,
  getMonitoredServer,
  getExporterCredentials,
  toAdminServer,
} = await import("./repo.js");
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

test("node exporter basic-auth password is encrypted at rest and never returned", () => {
  const created = createMonitoredServer({
    title: "Secured",
    host: "secured.example",
    kind: "vpn",
    exporterAuthType: "basic",
    exporterUsername: "metrics",
    exporterPassword: "super-secret-password",
  });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;
  const row = getMonitoredServer(id)!;

  assert.equal(JSON.stringify(row).includes("super-secret-password"), false);
  assert.ok(row.exporter_password_encrypted?.startsWith("v1:"));

  const dto = toAdminServer(row);
  assert.equal(dto.hasExporterPassword, true);
  assert.equal("exporter_password_encrypted" in dto, false);
  assert.equal(JSON.stringify(dto).includes("super-secret-password"), false);

  assert.equal(getExporterCredentials(row).password, "super-secret-password");
});

test("empty exporter password on update preserves the stored secret", () => {
  const created = createMonitoredServer({ title: "Keep", host: "keep.example", kind: "vpn", exporterAuthType: "basic", exporterPassword: "keep-me" });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;
  updateMonitoredServer(id, { exporterUsername: "renamed", exporterPassword: "" });
  assert.equal(getExporterCredentials(getMonitoredServer(id)!).password, "keep-me");
});

test("new exporter password replaces the secret; switching to none clears it", () => {
  const created = createMonitoredServer({ title: "Replace", host: "replace.example", kind: "vpn", exporterAuthType: "basic", exporterPassword: "old" });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;

  updateMonitoredServer(id, { exporterPassword: "new" });
  assert.equal(getExporterCredentials(getMonitoredServer(id)!).password, "new");

  updateMonitoredServer(id, { exporterAuthType: "none" });
  assert.equal(getMonitoredServer(id)!.exporter_password_encrypted, null);
  assert.equal(toAdminServer(getMonitoredServer(id)!).hasExporterPassword, false);
});

test("exporter password requires basic auth", () => {
  const created = createMonitoredServer({ title: "Bad", host: "bad.example", kind: "vpn", exporterAuthType: "none", exporterPassword: "x" });
  assert.equal(created.ok, false);
  assert.equal(created.ok ? "" : created.error, "exporter_password_requires_basic");
});

test("production save without a master key fails loudly and stores no plaintext", () => {
  const prevKey = process.env.SHPUN_CREDENTIALS_MASTER_KEY;
  const prevEnv = process.env.NODE_ENV;
  process.env.SHPUN_CREDENTIALS_MASTER_KEY = "";
  process.env.NODE_ENV = "production";
  try {
    const denied = createMonitoredServer({
      title: "NoKey",
      host: "nokey.example",
      kind: "vpn",
      exporterAuthType: "basic",
      exporterPassword: "plaintext-should-never-persist",
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.ok ? "" : denied.error, "credentials_key_missing");

    const rows = linkDb.prepare(`SELECT * FROM monitored_servers WHERE title = 'NoKey'`).all() as any[];
    assert.equal(rows.length, 0, "no row may be written without a master key");

    // A server without exporter credentials keeps working in production.
    const plain = createMonitoredServer({ title: "Plain", host: "plain.example", kind: "vpn" });
    assert.equal(plain.ok, true);
  } finally {
    process.env.SHPUN_CREDENTIALS_MASTER_KEY = prevKey;
    process.env.NODE_ENV = prevEnv;
  }
});

test("wrong master key on read is reported safely, never leaked", () => {
  const created = createMonitoredServer({ title: "WrongKey", host: "wrongkey.example", kind: "vpn", exporterAuthType: "basic", exporterPassword: "topsecret-value" });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;

  const prevKey = process.env.SHPUN_CREDENTIALS_MASTER_KEY;
  process.env.SHPUN_CREDENTIALS_MASTER_KEY = "a-totally-different-master-key";
  try {
    const creds = getExporterCredentials(getMonitoredServer(id)!);
    assert.equal(creds.password, null);
    assert.equal(JSON.stringify(creds).includes("topsecret-value"), false);
  } finally {
    process.env.SHPUN_CREDENTIALS_MASTER_KEY = prevKey;
  }

  assert.equal(getExporterCredentials(getMonitoredServer(id)!).password, "topsecret-value");
});

test.after(() => {
  linkDb.close();
});