import assert from "node:assert/strict";
import test from "node:test";
import { applyPromotionDisplaySettings, buildBonusOpportunities } from "./opportunities.js";

test("return promo is offered only when billing marks the account eligible", () => {
  const items = buildBonusOpportunities({
    billing: {
      return_offer: { active: 1, eligible: 1, code: "RETURN15", percent: 15, inactive_days: 30, tariff_days: 7 },
      review_reward: { active: 1, amount: 50 },
    },
    canCreateReview: true,
  });

  assert.deepEqual(items.map((item) => item.kind), ["return_promo", "review_bonus"]);
  assert.equal(items[0]?.id, "return:RETURN15:15:7");
});

test("an activated return promo becomes a pending top-up bonus", () => {
  const items = buildBonusOpportunities({
    billing: {
      return_offer: { eligible: 0, pending: 1, code: "RETURN15", percent: 15, tariff_days: 7 },
      first_pay: { pending: 1, percent: 20, campaign: "blogger" },
    },
    canCreateReview: false,
  });

  assert.deepEqual(items, [{
    id: "topup:return:RETURN15:15:7",
    campaignId: "return15",
    kind: "topup_bonus",
    source: "return",
    percent: 15,
    code: "RETURN15",
    tariffDays: 7,
  }]);
});

test("display settings hide campaigns and control the modal order", () => {
  const items = buildBonusOpportunities({
    billing: {
      return_offer: { active: 1, eligible: 1, code: "RETURN15", percent: 15, inactive_days: 30, tariff_days: 7 },
      review_reward: { active: 1, amount: 50 },
    },
    canCreateReview: true,
  });
  const settings = new Map<any, any>([
    ["return15", { campaignId: "return15", enabled: true, priority: 30, updatedAt: null }],
    ["review_reward", { campaignId: "review_reward", enabled: false, priority: 10, updatedAt: null }],
  ]);

  assert.deepEqual(applyPromotionDisplaySettings(items, settings).map((item) => item.campaignId), ["return15"]);
});

test("partner FirstPay stays independent and keeps its configured percent", () => {
  const items = buildBonusOpportunities({
    billing: {
      return_offer: { eligible: 0, pending: 0 },
      first_pay: { pending: 1, percent: 23, campaign: "partner-42" },
      review_reward: { active: 1, amount: 50 },
    },
    canCreateReview: true,
  });

  assert.equal(items[0]?.kind, "topup_bonus");
  assert.equal(items[0]?.kind === "topup_bonus" ? items[0].percent : 0, 23);
  assert.equal(items[1]?.kind, "review_bonus");
});

test("review offer is hidden after the account has submitted a review", () => {
  assert.deepEqual(buildBonusOpportunities({
    billing: { review_reward: { active: 1, amount: 50 } },
    canCreateReview: false,
  }), []);
});

test("inactive billing campaigns are never offered", () => {
  assert.deepEqual(buildBonusOpportunities({
    billing: {
      return_offer: { active: 0, eligible: 1, code: "RETURN15", percent: 15 },
      review_reward: { active: 0, amount: 50 },
    },
    canCreateReview: true,
  }), []);
});
