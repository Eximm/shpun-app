import assert from "node:assert/strict";
import test from "node:test";

import { normalizePaymentForecast } from "./forecast.js";

test("uses the earliest service expiry, never the SHM response timestamp", () => {
  assert.deepEqual(
    normalizePaymentForecast({
      date: "Tue Oct 20 22:43:28 2026",
      data: [{ total: 550, balance: 0, currency: "RUB", items: [
        { expire: "2026-11-06 16:22:58", next: { total: 200 } },
        { expire: "2026-10-26 12:19:48", next: { total: 350 } },
      ] }],
    }),
    {
      amount: 350,
      date: "2026-10-26 12:19:48",
      currency: "RUB",
    },
  );
});

test("keeps a zero top-up when balance and bonuses cover the upcoming charge", () => {
  assert.deepEqual(
    normalizePaymentForecast({ date: "Tue Oct 20 2026", data: [{ total: "0", balance: "170", items: [
      { expire: "2026-11-01 16:22:58", next: { total: "150" } },
    ] }] }),
    { amount: 0, date: "2026-11-01 16:22:58", currency: "RUB" },
  );
});

test("sums services due on the same day, but not later renewals", () => {
  assert.deepEqual(
    normalizePaymentForecast({ data: [{ total: 600, balance: 50, items: [
      { expire: "2026-10-26 12:19:48", next: { total: 150 } },
      { expire: "2026-10-26 22:31:42", next: { total: 200 } },
      { expire: "2026-11-06 16:22:58", next: { total: 300 } },
    ] }] }),
    { amount: 300, date: "2026-10-26 12:19:48", currency: "RUB" },
  );
});

test("does not invent a payment date or amount from an empty forecast", () => {
  assert.deepEqual(
    normalizePaymentForecast({ date: "Tue Oct 20 2026", data: [{ total: 0, balance: 0, items: [] }] }),
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
