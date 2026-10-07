import assert from "node:assert/strict";
import test from "node:test";

import { resolveEventMeta } from "./webpush.js";

test("payment forecast push opens payments with high urgency", () => {
  assert.deepEqual(resolveEventMeta({ type: "service.forecast" }), {
    link: "/payments",
    urgency: "high",
    ttl: 43200,
  });
});
