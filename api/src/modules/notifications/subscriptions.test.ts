import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-push-subscriptions-"));
process.env.NODE_ENV = "test";

const { linkDb } = await import("../../shared/linkdb/db.js");
const {
  listPushSubscriptions,
  recordPushDelivery,
  upsertPushSubscription,
} = await import("../../shared/linkdb/notificationsRepo.js");

test("a browser push endpoint belongs only to the current account", () => {
  const endpoint = "https://push.example.test/subscription-1";

  assert.deepEqual(
    upsertPushSubscription({ userId: 10, endpoint, p256dh: "key-a", auth: "auth-a" }),
    { ok: true, reassigned: 0 },
  );
  assert.equal(listPushSubscriptions(10).length, 1);

  assert.deepEqual(
    upsertPushSubscription({ userId: 20, endpoint, p256dh: "key-b", auth: "auth-b" }),
    { ok: true, reassigned: 1 },
  );
  assert.equal(listPushSubscriptions(10).length, 0);
  assert.equal(listPushSubscriptions(20).length, 1);
});

test("push delivery result survives outside container logs", () => {
  assert.deepEqual(
    recordPushDelivery({
      eventId: "event-1",
      userId: 20,
      eventType: "service.forecast",
      mode: "single",
      ok: true,
      sent: 1,
    }),
    { ok: true },
  );

  const row = linkDb.prepare(`
    SELECT event_id, user_id, event_type, mode, ok, sent, failed
    FROM push_delivery_log
    WHERE event_id = ?
  `).get("event-1") as any;

  assert.deepEqual(row, {
    event_id: "event-1",
    user_id: 20,
    event_type: "service.forecast",
    mode: "single",
    ok: 1,
    sent: 1,
    failed: 0,
  });
});

test.after(() => linkDb.close());
