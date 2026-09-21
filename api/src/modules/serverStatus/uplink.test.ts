import assert from "node:assert/strict";
import test from "node:test";

const { computeUplink, resolveUplinkCapacity } = await import("./uplink.js");

// bytes/sec from Mbps
const mbps = (v: number) => (v * 1_000_000) / 8;

/* ── Full-duplex semantics: max(RX, TX), not RX+TX ──────────────────────── */

test("1 Gbps: RX 600 + TX 600 -> 60% (full-duplex, NOT 120%)", () => {
  const r = computeUplink({ rxBps: mbps(600), txBps: mbps(600), configuredUplinkMbps: 1000, detectedUplinkSpeedBytes: null });
  assert.equal(r.pct, 60);
});

test("1 Gbps: RX 950 + TX 100 -> 95%", () => {
  const r = computeUplink({ rxBps: mbps(950), txBps: mbps(100), configuredUplinkMbps: 1000, detectedUplinkSpeedBytes: null });
  assert.equal(r.pct, 95);
});

test("1 Gbps: RX 100 + TX 950 -> 95%", () => {
  const r = computeUplink({ rxBps: mbps(100), txBps: mbps(950), configuredUplinkMbps: 1000, detectedUplinkSpeedBytes: null });
  assert.equal(r.pct, 95);
});

/* ── Capacity priority: configured wins over detected ───────────────────── */

test("configured 1 Gbps + detected 10 Gbps -> capacity is configured", () => {
  const r = computeUplink({ rxBps: mbps(600), txBps: mbps(600), configuredUplinkMbps: 1000, detectedUplinkSpeedBytes: mbps(10000) });
  assert.equal(r.capacitySource, "configured");
  assert.equal(r.capacityBps, mbps(1000));
  assert.equal(r.pct, 60);
});

test("configured missing + detected 10 Gbps -> capacity is detected", () => {
  const r = computeUplink({ rxBps: mbps(600), txBps: mbps(600), configuredUplinkMbps: null, detectedUplinkSpeedBytes: mbps(10000) });
  assert.equal(r.capacitySource, "detected");
  assert.equal(r.capacityBps, mbps(10000));
  assert.equal(r.pct, 6);
});

test("both missing -> utilization null, source unknown", () => {
  const r = computeUplink({ rxBps: mbps(600), txBps: mbps(600), configuredUplinkMbps: null, detectedUplinkSpeedBytes: null });
  assert.equal(r.pct, null);
  assert.equal(r.capacityBps, null);
  assert.equal(r.capacitySource, "unknown");
});

test("zero/invalid detected speed falls back to configured", () => {
  const r = computeUplink({ rxBps: mbps(500), txBps: 0, configuredUplinkMbps: 1000, detectedUplinkSpeedBytes: 0 });
  assert.equal(r.capacitySource, "configured");
  assert.equal(r.pct, 50);
});

/* ── No upper clamp: >100 is preserved ──────────────────────────────────── */

test("configured 100 Mbps: RX 150 Mbps -> 150%, not clamped to 100", () => {
  const r = computeUplink({ rxBps: mbps(150), txBps: null, configuredUplinkMbps: 100, detectedUplinkSpeedBytes: null });
  assert.equal(r.pct, 150);
});

test("a value above 100 still crosses the warning threshold", () => {
  const r = computeUplink({ rxBps: mbps(184), txBps: null, configuredUplinkMbps: 100, detectedUplinkSpeedBytes: null });
  assert.equal(r.pct, 184);
  assert.ok((r.pct ?? 0) >= 90, "incident threshold must still trigger");
});

/* ── Zero / invalid ─────────────────────────────────────────────────────── */

test("zero traffic -> 0%", () => {
  const r = computeUplink({ rxBps: 0, txBps: 0, configuredUplinkMbps: 1000, detectedUplinkSpeedBytes: null });
  assert.equal(r.pct, 0);
});

test("one direction only is used (the other missing)", () => {
  const r = computeUplink({ rxBps: mbps(300), txBps: null, configuredUplinkMbps: 1000, detectedUplinkSpeedBytes: null });
  assert.equal(r.pct, 30);
});

test("NaN / Infinity are handled safely", () => {
  assert.equal(computeUplink({ rxBps: Number.NaN, txBps: Number.NaN, configuredUplinkMbps: 1000, detectedUplinkSpeedBytes: null }).pct, null);
  const inf = computeUplink({ rxBps: Number.POSITIVE_INFINITY, txBps: 0, configuredUplinkMbps: 1000, detectedUplinkSpeedBytes: null });
  assert.equal(inf.pct, null);
  const badCapacity = computeUplink({ rxBps: mbps(10), txBps: 0, configuredUplinkMbps: Number.NaN, detectedUplinkSpeedBytes: Number.NaN });
  assert.equal(badCapacity.capacitySource, "unknown");
  assert.equal(badCapacity.pct, null);
});

test("resolveUplinkCapacity reports the chosen source", () => {
  assert.deepEqual(
    resolveUplinkCapacity({ rxBps: null, txBps: null, configuredUplinkMbps: 1000, detectedUplinkSpeedBytes: mbps(10000) }),
    { capacityBps: mbps(1000), capacitySource: "configured" },
  );
  assert.deepEqual(
    resolveUplinkCapacity({ rxBps: null, txBps: null, configuredUplinkMbps: null, detectedUplinkSpeedBytes: mbps(10000) }),
    { capacityBps: mbps(10000), capacitySource: "detected" },
  );
  assert.deepEqual(
    resolveUplinkCapacity({ rxBps: null, txBps: null, configuredUplinkMbps: null, detectedUplinkSpeedBytes: null }),
    { capacityBps: null, capacitySource: "unknown" },
  );
});