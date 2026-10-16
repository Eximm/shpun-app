import type { PromotionCampaignId, PromotionDisplaySetting } from "./displaySettingsRepo.js";

export type PromotionCatalogItem = {
  campaignId: PromotionCampaignId;
  kind: "return" | "first_pay" | "review";
  billingConnected: boolean;
  enabled: boolean;
  priority: number;
  code?: string;
  percent?: number;
  inactiveDays?: number;
  tariffDays?: number;
  amount?: number;
};

function finite(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function positive(value: unknown, fallback = 0): number {
  return Math.max(0, finite(value, fallback));
}

export function buildPromotionCatalog(
  billing: unknown,
  settings: ReadonlyMap<PromotionCampaignId, PromotionDisplaySetting>,
): PromotionCatalogItem[] {
  const payload = billing && typeof billing === "object" ? billing as Record<string, any> : {};
  const returnOffer = payload.return_offer && typeof payload.return_offer === "object"
    ? payload.return_offer
    : null;
  const firstPay = payload.first_pay && typeof payload.first_pay === "object"
    ? payload.first_pay
    : null;
  const reviewConnected = Object.prototype.hasOwnProperty.call(payload, "review_reward_amount");

  const withSetting = (
    campaignId: PromotionCampaignId,
    item: Omit<PromotionCatalogItem, "campaignId" | "enabled" | "priority">,
  ): PromotionCatalogItem => {
    const setting = settings.get(campaignId);
    return {
      campaignId,
      enabled: setting?.enabled ?? true,
      priority: setting?.priority ?? 50,
      ...item,
    };
  };

  return [
    withSetting("return15", {
      kind: "return",
      billingConnected: returnOffer !== null,
      code: String(returnOffer?.code || "RETURN15").trim().toUpperCase(),
      percent: positive(returnOffer?.percent, 15),
      inactiveDays: positive(returnOffer?.inactive_days, 30),
      tariffDays: positive(returnOffer?.tariff_days, 7),
    }),
    withSetting("first_pay", {
      kind: "first_pay",
      billingConnected: firstPay !== null,
    }),
    withSetting("review_reward", {
      kind: "review",
      billingConnected: reviewConnected,
      amount: positive(payload.review_reward_amount),
    }),
  ].sort((left, right) => left.priority - right.priority || left.campaignId.localeCompare(right.campaignId));
}

