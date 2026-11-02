import assert from "node:assert/strict";
import test from "node:test";

const { aggregateHealthStatus } = await import("./health.js");

type Check = { kind: "vpn" | "infra"; online: boolean | null; loadPct?: number | null };

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

test("high load alone never degrades public health", () => {
  assert.equal(aggregateHealthStatus([c("infra", true, 96), c("vpn", true, 92)]), "ok");
});

test("a single offline VPN node among several stays ok", () => {
  assert.equal(
    aggregateHealthStatus([c("infra", true), c("vpn", true), c("vpn", true), c("vpn", true), c("vpn", false)]),
    "ok",
  );
});

test("a significant share of VPN nodes offline is degraded", () => {
  assert.equal(aggregateHealthStatus([c("infra", true), c("vpn", true), c("vpn", false)]), "degraded");
  assert.equal(
    aggregateHealthStatus([c("infra", true), c("vpn", true), c("vpn", false), c("vpn", false)]),
    "degraded",
  );
});

test("all VPN nodes offline is down even if the account is online", () => {
  assert.equal(aggregateHealthStatus([c("infra", true), c("vpn", false), c("vpn", false)]), "down");
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

test("high load does not turn a significant outage into something worse", () => {
  assert.equal(aggregateHealthStatus([c("infra", false, 10), c("vpn", true, 99)]), "down");
});
const mirror = (online: boolean | null, state?: "fresh" | "stale" | "offline" | "no_data") =>
  ({ kind: "gateway" as const, online, healthGroup: "app-mirrors", state });

test("DNS replicas tolerate either mirror failing without hiding total failure", () => {
  for (const states of [[false, true], [true, false]] as const) {
    assert.equal(aggregateHealthStatus([mirror(states[0]), mirror(states[1]), c("vpn", true)]), "ok");
  }
  assert.equal(aggregateHealthStatus([mirror(false), mirror(false), c("infra", true)]), "down");
});

test("stale and missing replicas cannot prove failover availability", () => {
  assert.equal(aggregateHealthStatus([mirror(false), mirror(true, "stale"), c("vpn", true)]), "degraded");
  assert.equal(aggregateHealthStatus([mirror(null), mirror(null)]), "unknown");
  assert.equal(aggregateHealthStatus([mirror(null), mirror(true, "fresh")]), "ok");
});

test("replicas do not mask independent critical dependencies or VPN failure", () => {
  assert.equal(aggregateHealthStatus([mirror(false), mirror(true), c("infra", false)]), "degraded");
  assert.equal(aggregateHealthStatus([mirror(false), mirror(true), c("vpn", false)]), "down");
  assert.equal(aggregateHealthStatus([mirror(false), { kind: "infra", online: true, healthGroup: "billing" }]), "down");
  assert.equal(aggregateHealthStatus([mirror(false), { kind: "vpn", online: true, healthGroup: "app-mirrors" }]), "down");
});

test("diagnostic-only nodes are ignored before evaluating redundancy", () => {
  assert.equal(aggregateHealthStatus([mirror(false), { ...mirror(true), affectsPublicHealth: false }]), "down");
  assert.equal(aggregateHealthStatus([{ ...mirror(false), visibility: "admin_only", affectsPublicHealth: true }, mirror(true)]), "ok");
});
