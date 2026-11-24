import assert from "node:assert/strict";
import test from "node:test";
import { prepareWinterReward, WINTER_CAMPAIGN, type ServiceSnapshot } from "./winterRewardPolicy.js";
const now = WINTER_CAMPAIGN.freezeAt;
const reward = { userId: 12, level: 10, frozenAt: now, alreadyApplied: false };
const root: ServiceSnapshot = { userId: 12, userServiceId: 101, serviceId: 51, parent: null, status: "ACTIVE",
  expireAt: "2027-01-10T12:00:00Z", withdraw: { id: 201, paid: true, endAt: "2027-01-10T12:00:00Z" }, futurePaidWithdraws: 0 };
test("adds fixed days after existing paid expiry; includes attached legacy child, never changes source", () => {
  const child = { ...root, userServiceId: 102, serviceId: 53, parent: 101, withdraw: null };
  const result = prepareWinterReward(reward, [root, child], now);
  assert.ok(result.ok);
  assert.equal(result.plan.days, 30);
  assert.deepEqual(result.plan.changes.map((s) => s.after), ["2027-02-09T12:00:00.000Z", "2027-02-09T12:00:00.000Z"]);
  assert.equal(root.expireAt, "2027-01-10T12:00:00Z");
});
test("trial, promo, unpaid, expired, blocked, foreign accounts and standalone Plus are not eligible", () => {
  for (const patch of [{ serviceId: 52 }, { serviceId: 56 }, { serviceId: 50 }, { status: "BLOCK" }, { userId: 13 },
    { withdraw: { ...root.withdraw!, paid: false } }, { expireAt: now }]) {
    assert.equal(prepareWinterReward(reward, [{ ...root, ...patch }], now).ok, false);
  }
});
test("strict freeze, bounded levels, award window and duplicate guard", () => {
  for (const patch of [{ level: 0 }, { level: 11 }, { level: 1.5 }, { alreadyApplied: true }, { frozenAt: "invalid" }]) {
    assert.equal(prepareWinterReward({ ...reward, ...patch }, [root], now).ok, false);
  }
  for (const time of ["2026-12-25T08:59:59Z", WINTER_CAMPAIGN.applyBefore, "2026-12-25 12:00:00"]) assert.equal(prepareWinterReward(reward, [root], time).ok, false);
});
test("ambiguous children, future payment and inconsistent dates require review", () => {
  for (const services of [[{ ...root, futurePaidWithdraws: 1 }], [{ ...root, expireAt: "2027-01-11T12:00:00Z" }],
    [root, { ...root, userServiceId: 103, parent: 101, serviceId: 54 }],
    [root, { ...root, userServiceId: 103, parent: 101, serviceId: 50, expireAt: now }]]) {
    assert.equal(prepareWinterReward(reward, services, now).ok, false);
  }
});
test("multiple subscriptions receive one account reward, stable nearest expiry chosen", () => {
  const result = prepareWinterReward({ ...reward, level: 1 }, [{ ...root, userServiceId: 100 }, root], now);
  assert.ok(result.ok); assert.equal(result.plan.rootUserServiceId, 100); assert.equal(result.plan.changes.length, 1);
  assert.equal(result.plan.days, 1); assert.equal(result.plan.idempotencyKey, "winter-2026:12");
});
