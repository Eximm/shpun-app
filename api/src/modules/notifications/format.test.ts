import assert from "node:assert/strict";
import test from "node:test";

import { formatIncoming } from "./format.js";

test("payment forecast enables in-app toast and web push by default", () => {
  const event = formatIncoming({
    event_id: "forecast-1",
    type: "service.forecast",
    user_id: 2,
    meta: { total: 200, items_count: 1 },
  });

  assert.equal(event.toast, true);
  assert.equal(event.push, true);
});

test("payment forecast respects an explicit notification opt-out", () => {
  const event = formatIncoming({
    event_id: "forecast-2",
    type: "service.forecast",
    user_id: 2,
    toast: false,
    push: false,
  });

  assert.equal(event.toast, false);
  assert.equal(event.push, false);
});
