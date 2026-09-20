import assert from "node:assert/strict";
import test from "node:test";

const { parseRemnawaveMetrics, probeRemnawaveMetrics, emptyRemnawaveProbe, inspectRemnawaveMetrics } = await import("./remnawaveMetrics.js");

const METRICS = `
# HELP remnawave_node_online_users Online users per node
remnawave_node_online_users{node_uuid="uuid-helsinki",node_name="Helsinki FI"} 16
remnawave_node_online_users{node_uuid="uuid-prague",node_name="Prague CZ"} 4
remnawave_node_up{node_uuid="uuid-helsinki"} 1
remnawave_node_up{node_uuid="uuid-prague"} 0
remnawave_online_users 20
`;

test("parses per-node online users and node up state by UUID", () => {
  const summary = parseRemnawaveMetrics(METRICS);
  assert.equal(summary.globalOnlineUsers, 20);
  assert.equal(summary.nodes.length, 2);
  const helsinki = summary.nodes.find((n) => n.nodeUuid === "uuid-helsinki");
  assert.ok(helsinki);
  assert.equal(helsinki!.onlineUsers, 16);
  assert.equal(helsinki!.up, true);
  assert.equal(helsinki!.nodeName, "Helsinki FI");
  const prague = summary.nodes.find((n) => n.nodeUuid === "uuid-prague");
  assert.equal(prague!.up, false);
});

test("detects presence of the node online-users metric", () => {
  const probe = probeRemnawaveMetrics(METRICS);
  assert.equal(probe.metricsReceived, true);
  assert.equal(probe.nodeMetricsFound, true);
  assert.equal(probe.onlineUsersMetricPresent, true);
  assert.equal(probe.nodeCount, 2);
});

test("missing metric is reported, not invented", () => {
  const probe = probeRemnawaveMetrics("some_other_metric 1\n");
  assert.equal(probe.metricsReceived, true);
  assert.equal(probe.nodeMetricsFound, false);
  assert.equal(probe.onlineUsersMetricPresent, false);
  const summary = parseRemnawaveMetrics("some_other_metric 1\n");
  assert.equal(summary.globalOnlineUsers, null);
  assert.equal(summary.nodes.length, 0);
});

test("global online users falls back to the sum of per-node users", () => {
  const noGlobal = `
remnawave_node_online_users{node_uuid="a"} 3
remnawave_node_online_users{node_uuid="b"} 7
`;
  const summary = parseRemnawaveMetrics(noGlobal);
  assert.equal(summary.globalOnlineUsers, 10);
});

test("empty probe carries a safe error code", () => {
  const probe = emptyRemnawaveProbe("timeout");
  assert.equal(probe.reachable, false);
  assert.equal(probe.errorCode, "timeout");
  assert.deepEqual(probe.presentMetrics, []);
});

test("never returns labels that could leak credentials", () => {
  const leaky = `remnawave_node_online_users{node_uuid="a",auth_token="supersecret"} 1\n`;
  const summary = parseRemnawaveMetrics(leaky);
  assert.equal(JSON.stringify(summary).includes("supersecret"), false);
});

test("manual diagnostics list metric families and label keys without values", () => {
  const text = `
remnawave_node_online_users{node_uuid="u1",node_name="Helsinki"} 10
remnawave_node_up{node_uuid="u1"} 1
remnawave_online_users 10
other_metric{secret="value"} 5
`;
  const diag = inspectRemnawaveMetrics(text);
  assert.ok(diag.metricFamilies.includes("remnawave_node_online_users"));
  assert.ok(diag.metricFamilies.includes("remnawave_node_up"));
  assert.ok(diag.metricFamilies.includes("remnawave_online_users"));
  assert.equal(diag.metricFamilies.includes("other_metric"), false);
  assert.deepEqual(diag.labelKeys.sort(), ["node_name", "node_uuid"]);
  assert.equal(diag.nodeUuidCount, 1);
  assert.equal(diag.nodeOnlineUsersPresent, true);
  assert.equal(diag.globalOnlinePresent, true);
  assert.equal(diag.nodeUpPresent, true);
  assert.equal(JSON.stringify(diag).includes("Helsinki"), false);
});

test("probe exposes diagnostics", () => {
  const probe = probeRemnawaveMetrics(METRICS);
  assert.ok(probe.diagnostics);
  assert.equal(probe.diagnostics!.nodeUuidCount, 2);
});