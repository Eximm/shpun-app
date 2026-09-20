import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-mon-notify-"));
process.env.NODE_ENV = "development";

const { deliverMonitoringIncidentEvents } = await import("./monitoringNotifications.js");
const { recordSupportNotifyRecipient } = await import("../support/notifyRepo.js");
const { linkDb } = await import("../../shared/linkdb/db.js");

recordSupportNotifyRecipient(900);

function fakeIncident(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    server_id: 42,
    rule_type: "offline",
    severity: "critical",
    state: "alerting",
    opened_at: 1000,
    confirmed_at: 1000,
    resolved_at: null,
    last_seen_at: 1000,
    value: null,
    threshold: 3,
    message: "Helsinki FI недоступен",
    context_json: null,
    streak: 1,
    recover_streak: 0,
    notification_state: "notified",
    notify_count: 1,
    last_notified_at: 1000,
    ...overrides,
  } as any;
}

function event(kind: string, severity: string, id = 1, incidentId = 1) {
  return {
    kind,
    incident: fakeIncident({ id: incidentId, severity }),
    serverId: 42,
    serverTitle: "Helsinki FI",
    ruleType: "offline",
    severity,
    ts: 1000 + id,
    message: "Helsinki FI недоступен",
  } as any;
}

function countRows(eventId: string) {
  return (linkDb.prepare(`SELECT COUNT(*) AS c FROM notif_events WHERE event_id = ?`).get(eventId) as { c: number }).c;
}

test("critical opened incident emits one in-app notification", () => {
  deliverMonitoringIncidentEvents([event("opened", "critical")]);
  assert.equal(countRows("u:900:monitoring:1:opened"), 1);
});

test("re-delivering the same critical incident does not duplicate the notification", () => {
  deliverMonitoringIncidentEvents([event("opened", "critical")]);
  deliverMonitoringIncidentEvents([event("opened", "critical")]);
  assert.equal(countRows("u:900:monitoring:1:opened"), 1);
});

test("warning opened incident emits an in-app notification", () => {
  deliverMonitoringIncidentEvents([event("opened", "warning", 1, 2)]);
  assert.equal(countRows("u:900:monitoring:2:opened"), 1);
});

test("escalation emits a distinct notification", () => {
  deliverMonitoringIncidentEvents([event("escalated", "critical", 1, 3)]);
  assert.equal(countRows("u:900:monitoring:3:escalated"), 1);
});

test("critical recovery emits one notification, warning recovery emits none", () => {
  deliverMonitoringIncidentEvents([event("resolved", "critical", 1, 4)]);
  assert.equal(countRows("u:900:monitoring:4:resolved"), 1);

  deliverMonitoringIncidentEvents([event("resolved", "warning", 1, 5)]);
  assert.equal(countRows("u:900:monitoring:5:resolved"), 0);
});

test("reminder for a critical incident is delivered", () => {
  deliverMonitoringIncidentEvents([event("reminder", "critical", 55, 6)]);
  assert.equal(countRows("u:900:monitoring:6:reminder:1055"), 1);
});

test.after(() => {
  linkDb.close();
});