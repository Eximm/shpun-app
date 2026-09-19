import assert from "node:assert/strict";
import test from "node:test";

const { aggregateHealthStatus } = await import("./health.js");

type Check = { kind: "vpn" | "infra"; online: boolean | null; loadPct: number | null };

function c(kind: "vpn" | "infra", online: boolean | null, loadPct: number | null = null): Check {
  return { kind, online, loadPct };
}

test("empty configuration is unknown", () => {
  assert.equal(aggregateHealthStatus([]), "unknown");
});

test("all pending checks are unknown", () => {
  assert.equal(aggregateHealthStatus([c("vpn", null), c("infra", null)]), "unknown");
});

test("all online is ok", () => {
  assert.equal(aggregateHealthStatus([c("infra", true), c("vpn", true), c("vpn", true)]), "ok");
});

test("a single offline VPN node is degraded, never a full outage", () => {
  assert.equal(aggregateHealthStatus([c("infra", true), c("vpn", true), c("vpn", false)]), "degraded");
});

test("all known nodes offline with no infra is down", () => {
  assert.equal(aggregateHealthStatus([c("vpn", false), c("vpn", false)]), "down");
});

test("fully offline critical tier is down even if VPN nodes are online", () => {
  assert.equal(aggregateHealthStatus([c("infra", false), c("infra", false), c("vpn", true)]), "down");
});

test("partially offline critical tier is degraded", () => {
  assert.equal(aggregateHealthStatus([c("infra", true), c("infra", false), c("vpn", true)]), "degraded");
});

test("critical tier with no confirmed state is degraded, not green", () => {
  assert.equal(aggregateHealthStatus([c("infra", null), c("vpn", true)]), "degraded");
});

test("overloaded node is degraded", () => {
  assert.equal(aggregateHealthStatus([c("infra", true), c("vpn", true, 90)]), "degraded");
});

test("healthy nodes with moderate load stay ok", () => {
  assert.equal(aggregateHealthStatus([c("infra", true, 40), c("vpn", true, 84)]), "ok");
});