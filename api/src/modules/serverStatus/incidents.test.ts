import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-incidents-"));
process.env.NODE_ENV = "development";

const { evaluateServerIncidents, formatDuration, incidentDuration } = await import("./incidents.js");
const { listActiveIncidents, listRecentIncidents, insertEvent, listRecentEvents, findActiveIncident } = await import(
  "./incidentsRepo.js"
);
const { DEFAULT_THRESHOLDS } = await import("./settingsRepo.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

const thresholds = { ...DEFAULT_THRESHOLDS, recoveryChecks: 3, reminderSec: 3600, hysteresisPct: 5 };
const T0 = 1_700_000_000;

function evaluate(serverId: number, ts: number, rules: any[], title = "Node") {
  return evaluateServerIncidents({ serverId, serverTitle: title, ts, thresholds, rules });
}

test("a single sample does not open an incident (pending threshold)", () => {
  const events = evaluate(101, T0, [
    { ruleType: "high_cpu", severity: "warning", active: true, hold: true, value: 99, threshold: 95, message: "cpu" },
  ]);
  assert.equal(events.length, 0);
  const active = findActiveIncident(101, "high_cpu");
  assert.equal(active?.state, "pending");
});

test("incident is confirmed only after the configured number of checks", () => {
  const rule = {
    ruleType: "offline",
    severity: "critical",
    active: true,
    hold: true,
    value: null,
    threshold: 3,
    confirmAfterChecks: 3,
    message: "down",
  };
  assert.equal(evaluate(102, T0, [rule]).length, 0);
  assert.equal(evaluate(102, T0 + 60, [rule]).length, 0);
  const events = evaluate(102, T0 + 120, [rule]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "opened");
  assert.equal(findActiveIncident(102, "offline")?.state, "alerting");
});

test("time-based confirmation waits for the duration", () => {
  const rule = {
    ruleType: "high_cpu",
    severity: "warning",
    active: true,
    hold: true,
    value: 99,
    threshold: 95,
    confirmAfterSec: 900,
    message: "cpu",
  };
  assert.equal(evaluate(103, T0, [rule]).length, 0);
  assert.equal(evaluate(103, T0 + 600, [rule]).length, 0);
  const events = evaluate(103, T0 + 901, [rule]);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "opened");
});

test("no duplicate opened notifications while active", () => {
  const rule = {
    ruleType: "high_memory",
    severity: "warning",
    active: true,
    hold: true,
    value: 95,
    threshold: 90,
    message: "mem",
    confirmAfterChecks: 1,
  };
  const first = evaluate(104, T0, [rule]);
  assert.equal(first.length, 1);
  for (let i = 1; i <= 5; i++) {
    const events = evaluate(104, T0 + i * 60, [rule]);
    assert.equal(events.filter((e) => e.kind === "opened").length, 0);
  }
});

test("hysteresis keeps the incident open while the value is still elevated", () => {
  const rule = {
    ruleType: "high_cpu",
    severity: "warning",
    active: true,
    hold: true,
    value: 96,
    threshold: 95,
    message: "cpu",
    confirmAfterChecks: 1,
  };
  evaluate(105, T0, [rule]);
  // Value dips below threshold but above the hysteresis band -> still held.
  const held = evaluate(105, T0 + 60, [
    { ...rule, active: false, hold: true, value: 92 },
  ]);
  assert.equal(held.length, 0);
  assert.equal(findActiveIncident(105, "high_cpu")?.state, "alerting");
});

test("recovery requires the configured number of clear checks", () => {
  const rule = { ruleType: "high_disk", severity: "warning", active: true, hold: true, value: 90, threshold: 85, message: "disk", confirmAfterChecks: 1 };
  const opened = evaluate(106, T0, [rule]);
  assert.equal(opened.length, 1);

  const clear = { ...rule, active: false, hold: false, value: 20 };
  assert.equal(evaluate(106, T0 + 60, [clear]).length, 0);
  assert.equal(findActiveIncident(106, "high_disk")?.state, "recovering");
  assert.equal(evaluate(106, T0 + 120, [clear]).length, 0);
  const resolved = evaluate(106, T0 + 180, [clear]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].kind, "resolved");
  assert.ok((resolved[0].durationSec ?? 0) >= 180);
  assert.equal(findActiveIncident(106, "high_disk"), undefined);
});

test("condition returning during recovery re-arms the alert", () => {
  const rule = { ruleType: "high_inode", severity: "warning", active: true, hold: true, value: 95, threshold: 90, message: "inode", confirmAfterChecks: 1 };
  evaluate(107, T0, [rule]);
  evaluate(107, T0 + 60, [{ ...rule, active: false, hold: false, value: 10 }]);
  assert.equal(findActiveIncident(107, "high_inode")?.state, "recovering");
  evaluate(107, T0 + 120, [rule]);
  assert.equal(findActiveIncident(107, "high_inode")?.state, "alerting");
  assert.equal(findActiveIncident(107, "high_inode")?.recover_streak, 0);
});

test("severity escalation from warning to critical emits an event", () => {
  const warn = { ruleType: "high_memory", severity: "warning", active: true, hold: true, value: 92, threshold: 90, message: "mem", confirmAfterChecks: 1 };
  evaluate(108, T0, [warn]);
  const crit = { ...warn, severity: "critical", value: 98, threshold: 97, message: "mem critical" };
  const events = evaluate(108, T0 + 60, [crit]);
  assert.equal(events.filter((e) => e.kind === "escalated").length, 1);
  assert.equal(findActiveIncident(108, "high_memory")?.severity, "critical");
});

test("reminder fires only after the configured reminder window", () => {
  const rule = { ruleType: "uplink_saturation", severity: "warning", active: true, hold: true, value: 95, threshold: 90, message: "uplink", confirmAfterChecks: 1 };
  evaluate(109, T0, [rule]);
  assert.equal(evaluate(109, T0 + 60, [rule]).filter((e) => e.kind === "reminder").length, 0);
  const reminders = evaluate(109, T0 + thresholds.reminderSec + 10, [rule]).filter((e) => e.kind === "reminder");
  assert.equal(reminders.length, 1);
});

test("informational reboot events are recorded for Recent Activity", () => {
  insertEvent({ serverId: 110, type: "reboot", ts: T0, message: "Node перезагружен" });
  const events = listRecentEvents(10);
  assert.ok(events.some((e) => e.type === "reboot"));
});

test("counts expose active incidents for dashboard/bell", () => {
  const active = listActiveIncidents();
  assert.ok(active.length > 0);
  const recent = listRecentIncidents(50);
  assert.ok(recent.length > 0);
});

test("duration formatting is human friendly", () => {
  assert.equal(formatDuration(45), "45с");
  assert.equal(formatDuration(4 * 60 + 37), "4м 37с");
  assert.ok(incidentDuration({ opened_at: T0, resolved_at: T0 + 120 } as any) === 120);
});

test.after(() => {
  linkDb.close();
});