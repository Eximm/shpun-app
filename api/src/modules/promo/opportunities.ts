export type BonusOpportunity =
  | {
      id: string;
      kind: "topup_bonus";
      source: "return" | "first_pay";
      percent: number;
      code?: string;
      tariffDays?: number;
    }
  | {
      id: string;
      kind: "return_promo";
      code: string;
      percent: number;
      inactiveDays: number;
      tariffDays: number;
    }
  | {
      id: string;
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
  const returnCode = String(returnOffer.code || "RETURN15").trim().toUpperCase();
  const tariffDays = positive(returnOffer.tariff_days, 7);

  if (truthy(returnOffer.pending) && returnPercent > 0) {
    items.push({
      id: `topup:return:${returnCode}:${returnPercent}:${tariffDays}`,
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
      kind: "topup_bonus",
      source: "first_pay",
      percent,
    });
  } else if (truthy(returnOffer.eligible) && returnCode && returnPercent > 0) {
    items.push({
      id: `return:${returnCode}:${returnPercent}:${tariffDays}`,
      kind: "return_promo",
      code: returnCode,
      percent: returnPercent,
      inactiveDays: positive(returnOffer.inactive_days, 30),
      tariffDays,
    });
  }

  const reviewAmount = positive(billing.review_reward_amount);
  if (input.canCreateReview && reviewAmount >= 1 && reviewAmount <= 500) {
    items.push({
      id: `review:${reviewAmount}`,
      kind: "review_bonus",
      amount: reviewAmount,
    });
  }

  return items;
}
