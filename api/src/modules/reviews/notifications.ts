import { putNotifEvent, type NotifEvent } from "../../shared/linkdb/notificationsRepo.js";
import { sendWebPushToUser } from "../notifications/webpush.js";

function normalizedAmount(value: number) {
  return Math.round(Number(value) * 100) / 100;
}

function amountText(value: number) {
  return normalizedAmount(value).toLocaleString("ru-RU");
}

export function reviewRewardEvent(params: {
  reviewId: number;
  userId: number;
  amount: number;
}): NotifEvent {
  const amount = normalizedAmount(params.amount);
  const message = `За опубликованный отзыв начислено ${amountText(amount)} ₽ на бонусный счёт.`;

  return {
    event_id: `u:${params.userId}:review-reward:${params.reviewId}`,
    ts: Math.floor(Date.now() / 1000),
    type: "review.rewarded",
    level: "success",
    title: "Бонусы за отзыв начислены",
    message,
    target: "user",
    user_id: params.userId,
    toast: true,
    meta: {
      review_id: params.reviewId,
      amount,
      action: { kind: "nav", to: "/reviews" },
      short: {
        title: "Бонусы за отзыв начислены",
        message: `+${amountText(amount)} ₽ на бонусный счёт`,
      },
    },
  };
}

export async function notifyReviewReward(params: {
  reviewId: number;
  userId: number;
  amount: number;
}) {
  const event = reviewRewardEvent(params);
  const stored = putNotifEvent(event);

  if (!stored.ok || stored.dedup) return stored;

  try {
    await sendWebPushToUser(params.userId, event);
  } catch (error: any) {
    console.warn("REVIEW_REWARD_PUSH_FAIL", {
      reviewId: params.reviewId,
      userId: params.userId,
      msg: String(error?.message || error || ""),
    });
  }

  return stored;
}
