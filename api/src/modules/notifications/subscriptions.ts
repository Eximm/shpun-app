// api/src/modules/notifications/subscriptions.ts
import {
  listPushSubscriptions,
  removePushSubscription,
  upsertPushSubscription,
} from "../../shared/linkdb/notificationsRepo.js";

export type PushSub = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  ts?: number;
};

export function putSubscription(userId: number, sub: PushSub) {
  return upsertPushSubscription({
    userId,
    endpoint: sub.endpoint,
    p256dh: sub.keys?.p256dh,
    auth: sub.keys?.auth,
  });
}

export function listSubscriptions(userId: number): PushSub[] {
  return listPushSubscriptions(userId);
}

export function removeSubscription(userId: number, endpoint: string | null) {
  return removePushSubscription({ userId, endpoint });
}