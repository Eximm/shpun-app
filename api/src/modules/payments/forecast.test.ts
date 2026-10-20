import assert from "node:assert/strict";
import test from "node:test";

import { normalizePaymentForecast } from "./forecast.js";

test("uses the earliest service expiry, never the SHM response timestamp", () => {
  assert.deepEqual(
    normalizePaymentForecast({
      date: "Tue Oct 20 22:43:28 2026",
      data: [{ total: 200, currency: "RUB", items: [
        { expire: "2026-11-05 16:22:58" },
        { expire: "2026-11-01 16:22:58" },
      ] }],
    }),
    {
      amount: 200,
      date: "2026-11-01 16:22:58",
      currency: "RUB",
    },
  );
});

test("keeps a zero top-up when balance and bonuses cover the upcoming charge", () => {
  assert.deepEqual(
    normalizePaymentForecast({ date: "Tue Oct 20 2026", data: [{ total: "0", items: [
      { expire: "2026-11-01 16:22:58" },
    ] }] }),
    { amount: 0, date: "2026-11-01 16:22:58", currency: "RUB" },
  );
});

test("does not invent a payment date or amount from an empty forecast", () => {
  assert.deepEqual(
    normalizePaymentForecast({ date: "Tue Oct 20 2026", data: [{ total: 0, items: [] }] }),
    { amount: null, date: null, currency: "RUB" },
  );
});

test("returns an explicit empty forecast for an empty upstream response", () => {
  assert.deepEqual(normalizePaymentForecast(null), {
    amount: null,
    date: null,
    currency: "RUB",
  });
});
