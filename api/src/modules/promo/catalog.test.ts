import assert from "node:assert/strict";
import test from "node:test";
import { buildPromotionCatalog } from "./catalog.js";

test("catalog projects billing-owned offer values and local display settings", () => {
  const settings = new Map<any, any>([
    ["return15", { campaignId: "return15", enabled: false, priority: 30, updatedAt: null }],
    ["first_pay", { campaignId: "first_pay", enabled: true, priority: 20, updatedAt: null }],
    ["review_reward", { campaignId: "review_reward", enabled: true, priority: 10, updatedAt: null }],
  ]);
  const items = buildPromotionCatalog({
    return_offer: { code: "RETURN15", active: 1, percent: 15, inactive_days: 30, tariff_days: 7 },
    first_pay: { pending: 0, percent: 0 },
    review_reward: { active: 1, amount: 50 },
  }, settings);

  assert.deepEqual(items.map((item) => item.campaignId), ["review_reward", "first_pay", "return15"]);
  assert.equal(items[0]?.amount, 50);
  assert.equal(items[2]?.enabled, false);
  assert.equal(items[2]?.percent, 15);
  assert.ok(items.every((item) => item.billingConnected));
});

test("catalog reports missing billing integrations instead of inventing active offers", () => {
  const items = buildPromotionCatalog({}, new Map());
  assert.ok(items.every((item) => item.billingConnected === false));
});
