import type { PromotionCampaignId, PromotionDisplaySetting } from "./displaySettingsRepo.js";

export type BonusOpportunity =
  | {
      id: string;
      campaignId: "first_pay" | "return15";
      kind: "topup_bonus";
      source: "return" | "first_pay";
      percent: number;
      code?: string;
      tariffDays?: number;
    }
  | {
      id: string;
      campaignId: "return15";
      kind: "return_promo";
      code: string;
      percent: number;
      inactiveDays: number;
      tariffDays: number;
    }
  | {
      id: string;
      campaignId: "review_reward";
      kind: "review_bonus";
      amount: number;
    };

function finite(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function positive(v: unknown, fallback = 0): number {
  return Math.max(0, finite(v, fallback));
}

function truthy(v: unknown): boolean {
  return v === true || v === 1 || v === "1" || v === "true";
}

export function buildBonusOpportunities(input: {
  billing: any;
  canCreateReview: boolean;
}): BonusOpportunity[] {
  const items: BonusOpportunity[] = [];
  const billing = input.billing && typeof input.billing === "object" ? input.billing : {};
  const returnOffer = billing.return_offer && typeof billing.return_offer === "object"
    ? billing.return_offer
    : {};
  const firstPay = billing.first_pay && typeof billing.first_pay === "object"
    ? billing.first_pay
    : {};

  const returnPercent = positive(returnOffer.percent, 15);
  const returnCode = String(returnOffer.code || "").trim().toUpperCase();
  const tariffDays = positive(returnOffer.tariff_days, 7);

  if (truthy(returnOffer.pending) && returnCode && returnPercent > 0) {
    items.push({
      id: `topup:return:${returnCode}:${returnPercent}:${tariffDays}`,
      campaignId: "return15",
      kind: "topup_bonus",
      source: "return",
      percent: returnPercent,
      code: returnCode,
      tariffDays,
    });
  } else if (truthy(firstPay.pending) && positive(firstPay.percent) > 0) {
    const percent = positive(firstPay.percent);
    const campaign = String(firstPay.campaign || "default").trim() || "default";
    items.push({
      id: `topup:first-pay:${campaign}:${percent}`,
      campaignId: "first_pay",
      kind: "topup_bonus",
      source: "first_pay",
      percent,
    });
  } else if (truthy(returnOffer.active) && truthy(returnOffer.eligible) && returnCode && returnPercent > 0) {
    items.push({
      id: `return:${returnCode}:${returnPercent}:${tariffDays}`,
      campaignId: "return15",
      kind: "return_promo",
      code: returnCode,
      percent: returnPercent,
      inactiveDays: positive(returnOffer.inactive_days, 30),
      tariffDays,
    });
  }

  const reviewReward = billing.review_reward && typeof billing.review_reward === "object"
    ? billing.review_reward
    : null;
  const reviewActive = reviewReward ? truthy(reviewReward.active) : false;
  const reviewAmount = positive(reviewReward?.amount ?? billing.review_reward_amount);
  if (input.canCreateReview && reviewActive && reviewAmount >= 1 && reviewAmount <= 500) {
    items.push({
      id: `review:${reviewAmount}`,
      campaignId: "review_reward",
      kind: "review_bonus",
      amount: reviewAmount,
    });
  }

  return items;
}

export function applyPromotionDisplaySettings(
  items: BonusOpportunity[],
  settings: ReadonlyMap<PromotionCampaignId, PromotionDisplaySetting>,
): BonusOpportunity[] {
  return items
    .map((item, index) => ({ item, index, setting: settings.get(item.campaignId) }))
    .filter(({ setting }) => setting?.enabled !== false)
    .sort((left, right) =>
      (left.setting?.priority ?? 50) - (right.setting?.priority ?? 50) || left.index - right.index
    )
    .map(({ item }) => item);
}
