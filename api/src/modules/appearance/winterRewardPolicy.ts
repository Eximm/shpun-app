// Preparation only: this module cannot write to SHM or award days.
export const WINTER_CAMPAIGN = {
  id: "winter-2026", freezeAt: "2026-12-31T09:00:00.000Z",
  applyNotBefore: "2026-12-31T09:00:00.000Z",
  applyBefore: "2027-01-01T21:00:00.000Z",
  ordinaryFlexServiceId: 51,
  // Draft curve, to be published and frozen before participation starts.
  daysByLevel: [0, 1, 2, 3, 4, 5, 7, 10, 14, 21, 30] as readonly number[],
};

export type ServiceSnapshot = {
  userId: number; userServiceId: number; serviceId: number; parent: number | null;
  status: string; expireAt: string | null;
  withdraw: null | { id: number; paid: boolean; endAt: string | null };
  futurePaidWithdraws: number;
};
export type RewardSnapshot = { userId: number; level: number; frozenAt: string; alreadyApplied: boolean };
export type RewardPlan = {
  campaignId: string; userId: number; level: number; days: number;
  idempotencyKey: string; rootUserServiceId: number;
  changes: { userServiceId: number; serviceId: number; withdrawId: number | null; before: string; after: string }[];
};
type Decision = { ok: true; plan: RewardPlan } | { ok: false; reason: string };
function stamp(raw: string | null): number {
  // Require a timezone; do not interpret SHM's local timestamps as UTC silently.
  if (!raw || !/(Z|[+-]\d\d:\d\d)$/.test(raw)) return NaN;
  return Date.parse(raw);
}
function sameDate(a: string | null, b: string | null) { return Number.isFinite(stamp(a)) && stamp(a) === stamp(b); }

export function prepareWinterReward(reward: RewardSnapshot, services: ServiceSnapshot[], now: string): Decision {
  const at = stamp(now);
  if (!Number.isFinite(at) || at < stamp(WINTER_CAMPAIGN.applyNotBefore) || at >= stamp(WINTER_CAMPAIGN.applyBefore)) return { ok: false, reason: "outside_award_window" };
  if (!Number.isSafeInteger(reward.userId) || reward.userId < 1) return { ok: false, reason: "invalid_user" };
  if (reward.alreadyApplied) return { ok: false, reason: "already_applied" };
  if (stamp(reward.frozenAt) !== stamp(WINTER_CAMPAIGN.freezeAt)) return { ok: false, reason: "not_frozen" };
  if (!Number.isInteger(reward.level) || reward.level < 1 || reward.level >= WINTER_CAMPAIGN.daysByLevel.length) return { ok: false, reason: "invalid_level" };
  const candidates = services.filter((s) => s.userId === reward.userId && s.serviceId === WINTER_CAMPAIGN.ordinaryFlexServiceId
    && s.parent === null && s.status === "ACTIVE" && stamp(s.expireAt) > at && s.withdraw?.paid);
  // One service per account, stable choice recorded in the reviewed manifest.
  candidates.sort((a, b) => stamp(a.expireAt) - stamp(b.expireAt) || a.userServiceId - b.userServiceId);
  const root = candidates[0];
  if (!root) return { ok: false, reason: "no_active_paid_ordinary_flex" };
  if (!sameDate(root.expireAt, root.withdraw!.endAt)) return { ok: false, reason: "withdraw_expiry_mismatch" };
  const related = services.filter((s) => s.parent === root.userServiceId && s.status === "ACTIVE");
  for (const child of related) {
    // Historical children may still use a trial/promo ID even when their parent
    // is already ordinary Flex. Never upgrade or award those independently.
    if (child.userId !== root.userId || ![50, 53, 55].includes(child.serviceId)) return { ok: false, reason: "unexpected_child" };
    if (!sameDate(child.expireAt, root.expireAt)) return { ok: false, reason: "child_expiry_mismatch" };
    if (child.withdraw && (!child.withdraw.paid || !sameDate(child.expireAt, child.withdraw.endAt))) return { ok: false, reason: "child_withdraw_mismatch" };
  }
  if ([root, ...related].some((s) => s.futurePaidWithdraws !== 0)) return { ok: false, reason: "future_paid_period_requires_review" };
  const days = WINTER_CAMPAIGN.daysByLevel[reward.level];
  return { ok: true, plan: {
    campaignId: WINTER_CAMPAIGN.id, userId: root.userId, level: reward.level, days,
    idempotencyKey: `${WINTER_CAMPAIGN.id}:${root.userId}`, rootUserServiceId: root.userServiceId,
    changes: [root, ...related].map((s) => ({ userServiceId: s.userServiceId, serviceId: s.serviceId,
      withdrawId: s.withdraw?.id ?? null, before: s.expireAt!, after: new Date(stamp(s.expireAt) + days * 86400_000).toISOString() })),
  } };
}
