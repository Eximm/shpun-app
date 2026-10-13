import assert from "node:assert/strict";
import test from "node:test";
import { passwordStepDoneFromStatus } from "./me.js";

test("existing password marks suppress reminders regardless of the other flag", () => {
  for (const mark of [1, "1", true]) {
    assert.equal(passwordStepDoneFromStatus({ onboarding: { step_password: mark } }), true);
    assert.equal(passwordStepDoneFromStatus({ auth: { password_set: mark } }), true);
    assert.equal(passwordStepDoneFromStatus({ onboarding: { step_password: 0 }, auth: { password_set: mark } }), true);
    assert.equal(passwordStepDoneFromStatus({ onboarding: { step_password: mark }, auth: { password_set: 0 } }), true);
  }
});

test("only explicit absence allows a password reminder", () => {
  for (const mark of [0, "0", false]) {
    assert.equal(passwordStepDoneFromStatus({ onboarding: { step_password: mark } }), false);
    assert.equal(passwordStepDoneFromStatus({ auth: { password_set: mark } }), false);
  }
  for (const data of [null, undefined, {}, { onboarding: {} },
    { onboarding: { step_password: "unknown" }, auth: { password_set: 0 } },
    { onboarding: { step_password: 0 }, auth: { password_set: "unknown" } }]) {
    assert.equal(passwordStepDoneFromStatus(data), true);
  }
});
