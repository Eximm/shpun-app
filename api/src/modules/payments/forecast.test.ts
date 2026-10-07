import assert from "node:assert/strict";
import test from "node:test";

import { normalizePaymentForecast } from "./forecast.js";

test("normalizes the SHM payment forecast used by the app", () => {
  assert.deepEqual(
    normalizePaymentForecast({
      date: "2026-10-07T21:27:49+03:00",
      data: [{ total: 200, currency: "RUB" }],
    }),
    {
      amount: 200,
      date: "2026-10-07T21:27:49+03:00",
      currency: "RUB",
    },
  );
});

test("accepts numeric totals returned as strings", () => {
  assert.deepEqual(
    normalizePaymentForecast({ date: "2026-10-08", data: [{ total: "200.50" }] }),
    { amount: 200.5, date: "2026-10-08", currency: "RUB" },
  );
});

test("returns an explicit empty forecast for an empty upstream response", () => {
  assert.deepEqual(normalizePaymentForecast(null), {
    amount: null,
    date: null,
    currency: "RUB",
  });
});
