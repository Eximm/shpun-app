import assert from "node:assert/strict";
import test from "node:test";
import { publicReturnBonus } from "./returnBonus.js";
test("return promotion projection keeps only billing lifecycle fields", () => {
  const state = publicReturnBonus({ return_bonus: { pending: "0", applied: "1", tariff_activated: 1, tariff_user_service_id: 2889, tariff_id: 56, tariff_days: 7, applied_percent: 15, secret: "private" } });
  assert.deepEqual(state, { pending: false, applied: true, tariffActivated: true, userServiceId: 2889, tariffId: 56, days: 7, percent: 15 });
  assert.equal(JSON.stringify(state).includes("private"), false);
  assert.equal(publicReturnBonus(undefined), null);
  assert.equal(publicReturnBonus("invalid"), null);
});
