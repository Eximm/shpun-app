import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "shpun-review-notifications-test-"));

const { reviewRewardEvent } = await import("./notifications.js");
const { putNotifEvent, listNotifAfter } = await import("../../shared/linkdb/notificationsRepo.js");

test("review reward notification is personal and deduplicated by review", () => {
  const event = reviewRewardEvent({ reviewId: 17, userId: 42, amount: 300 });

  assert.equal(event.event_id, "u:42:review-reward:17");
  assert.equal(event.type, "review.rewarded");
  assert.equal(event.level, "success");
  assert.equal(event.target, "user");
  assert.equal(event.user_id, 42);
  assert.equal(event.toast, true);
  assert.match(String(event.message), /300 ₽/);

  assert.deepEqual(putNotifEvent(event), { ok: true, dedup: false });
  assert.deepEqual(putNotifEvent({ ...event, ts: event.ts + 1 }), { ok: true, dedup: true });

  const own = listNotifAfter({ userId: 42, limit: 10 });
  const other = listNotifAfter({ userId: 43, limit: 10 });
  assert.equal(own.items.length, 1);
  assert.equal(other.items.length, 0);
});
