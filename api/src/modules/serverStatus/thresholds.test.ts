import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-thresholds-"));
process.env.NODE_ENV = "development";

const {
  DEFAULT_THRESHOLDS,
  getGlobalThresholds,
  setGlobalThresholds,
  resolveThresholds,
  sanitizePerNodeThresholds,
  THRESHOLD_KEY_SET,
} = await import("./settingsRepo.js");
const repo = await import("./repo.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

test("the whitelist only contains known threshold keys", () => {
  assert.ok(THRESHOLD_KEY_SET.has("cpuPct"));
  assert.ok(THRESHOLD_KEY_SET.has("offlineFailChecks"));
  assert.equal(THRESHOLD_KEY_SET.has("bogus"), false);
  assert.deepEqual([...THRESHOLD_KEY_SET].sort(), Object.keys(DEFAULT_THRESHOLDS).sort());
});

test("global settings ignore unknown keys and report them", () => {
  const result = setGlobalThresholds({ cpuPct: 91, bogusKey: 1234, another: "x" });
  assert.equal(result.thresholds.cpuPct, 91);
  assert.deepEqual(result.ignoredKeys.sort(), ["another", "bogusKey"]);

  const current = getGlobalThresholds();
  assert.equal(current.cpuPct, 91);
  assert.equal("bogusKey" in current, false);
  assert.equal("another" in current, false);
  // restore
  setGlobalThresholds({ cpuPct: DEFAULT_THRESHOLDS.cpuPct });
});

test("global values are clamped to safe bounds", () => {
  const result = setGlobalThresholds({ cpuPct: 5000, offlineFailChecks: 0, hysteresisPct: 90 });
  assert.equal(result.thresholds.cpuPct, 100);
  assert.equal(result.thresholds.offlineFailChecks, 1);
  assert.equal(result.thresholds.hysteresisPct, 50);
  setGlobalThresholds({ cpuPct: DEFAULT_THRESHOLDS.cpuPct, offlineFailChecks: DEFAULT_THRESHOLDS.offlineFailChecks, hysteresisPct: DEFAULT_THRESHOLDS.hysteresisPct });
});

test("per-node thresholds reject unknown keys", () => {
  const created = repo.createMonitoredServer({
    title: "Reject",
    host: "reject.example",
    nodeExporterEnabled: false,
    thresholds: { cpuPct: 90, sneaky: 1 },
  });
  assert.equal(created.ok, false);
  assert.equal(created.ok ? "" : created.error, "unknown_threshold_keys");
});

test("per-node thresholds accept and clamp known keys", () => {
  const created = repo.createMonitoredServer({
    title: "Accept",
    host: "accept.example",
    nodeExporterEnabled: false,
    thresholds: { cpuPct: 999, diskWarnPct: 80 },
  });
  assert.equal(created.ok, true);
  const row = created.ok ? created.item : null;
  assert.ok(row?.thresholds_json);
  const parsed = JSON.parse(row!.thresholds_json!);
  assert.equal(parsed.cpuPct, 100);
  assert.equal(parsed.diskWarnPct, 80);
  assert.equal("sneaky" in parsed, false);
});

test("per-node update rejects unknown keys and preserves the old override", () => {
  const created = repo.createMonitoredServer({
    title: "Update",
    host: "update.example",
    nodeExporterEnabled: false,
    thresholds: { cpuPct: 88 },
  });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;

  const bad = repo.updateMonitoredServer(id, { thresholds: { cpuPct: 70, unknownKey: 1 } });
  assert.equal(bad.ok, false);
  assert.equal(repo.getMonitoredServer(id)!.thresholds_json, JSON.stringify({ cpuPct: 88 }));

  const good = repo.updateMonitoredServer(id, { thresholds: { cpuPct: 70 } });
  assert.equal(good.ok, true);
  assert.equal(JSON.parse(repo.getMonitoredServer(id)!.thresholds_json!).cpuPct, 70);
});

test("sanitizePerNodeThresholds rejects invalid JSON and non-objects", () => {
  assert.equal(sanitizePerNodeThresholds("{not json").ok, false);
  assert.equal(sanitizePerNodeThresholds("[]").ok, false);
  assert.equal(sanitizePerNodeThresholds(42 as any).ok, false);
  assert.deepEqual(sanitizePerNodeThresholds(null), { ok: true, json: null, unknownKeys: [] });
});

test("runtime resolution never leaks unknown keys from a raw DB value", () => {
  const created = repo.createMonitoredServer({ title: "Raw", host: "raw.example", nodeExporterEnabled: false });
  assert.equal(created.ok, true);
  const id = created.ok ? created.item.id : 0;

  // Simulate a legacy/hand-written row bypassing the repo sanitizer.
  linkDb.prepare(`UPDATE monitored_servers SET thresholds_json = ? WHERE id = ?`).run(
    JSON.stringify({ cpuPct: 77, evilUnknown: 999 }),
    id,
  );

  const resolved = resolveThresholds(repo.getMonitoredServer(id)!.thresholds_json);
  assert.equal(resolved.cpuPct, 77);
  assert.equal("evilUnknown" in resolved, false);
});

test.after(() => {
  linkDb.close();
});