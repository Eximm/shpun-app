import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-interval-"));
process.env.NODE_ENV = "development";

const { startServerStatusMonitor, applyCollectionInterval, getCollectorTimerState, stopServerStatusMonitor } = await import(
  "./monitor.js"
);
const { setGlobalThresholds, DEFAULT_THRESHOLDS, getGlobalThresholds } = await import("./settingsRepo.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

test("collector starts with the configured global interval", () => {
  setGlobalThresholds({ collectionIntervalSec: 60 });
  startServerStatusMonitor(() => []);
  const state = getCollectorTimerState();
  assert.equal(state.active, true);
  assert.equal(state.intervalMs, 60_000);
  assert.equal(state.version, 1);
});

test("changing settings 60 -> 120 restarts the single timer without a restart", () => {
  const result = applyCollectionInterval(120);
  assert.equal(result.changed, true);
  assert.equal(result.intervalMs, 120_000);

  const state = getCollectorTimerState();
  assert.equal(state.active, true);
  // A new timer was installed (version 2) and the previous one cleared by the
  // restartable timer; there is never more than one active collector timer.
  assert.equal(state.version, 2);
  assert.equal(state.intervalMs, 120_000);
});

test("applying the same interval does not create another timer", () => {
  const result = applyCollectionInterval(120);
  assert.equal(result.changed, false);
  assert.equal(getCollectorTimerState().version, 2);
});

test("invalid interval falls back to the persisted global value", () => {
  setGlobalThresholds({ collectionIntervalSec: 90 });
  const result = applyCollectionInterval(Number.NaN);
  assert.equal(result.intervalMs, 90_000);
  assert.equal(getCollectorTimerState().intervalMs, 90_000);
});

test("interval is clamped to a safe range", () => {
  assert.equal(applyCollectionInterval(1).intervalMs, 15_000);
  assert.equal(applyCollectionInterval(99999).intervalMs, 3_600_000);
  setGlobalThresholds({ collectionIntervalSec: DEFAULT_THRESHOLDS.collectionIntervalSec });
  assert.equal(getGlobalThresholds().collectionIntervalSec, DEFAULT_THRESHOLDS.collectionIntervalSec);
});

test.after(() => {
  stopServerStatusMonitor();
  linkDb.close();
});