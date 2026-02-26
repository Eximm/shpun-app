// api/src/modules/notifications/subscriptions.ts
export type PushSub = {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  ts?: number;
};

const subsByUser = new Map<number, Map<string, PushSub>>();

export function putSubscription(userId: number, sub: PushSub) {
  let m = subsByUser.get(userId);
  if (!m) {
    m = new Map();
    subsByUser.set(userId, m);
  }
  m.set(sub.endpoint, sub);
}

export function listSubscriptions(userId: number): PushSub[] {
  const m = subsByUser.get(userId);
  if (!m) return [];
  return Array.from(m.values());
}

export function removeSubscription(userId: number, endpoint: string | null) {
  if (!endpoint) {
    subsByUser.delete(userId);
    return;
  }
  const m = subsByUser.get(userId);
  if (!m) return;
  m.delete(endpoint);
  if (m.size === 0) subsByUser.delete(userId);
}