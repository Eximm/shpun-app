import assert from "node:assert/strict";
import test from "node:test";

const { createRestartableTimer } = await import("./restartableTimer.js");

type FakeTimer = { id: number; ms: number; handler: () => void };

function fakeApi() {
  const installed: FakeTimer[] = [];
  const cleared: FakeTimer[] = [];
  let nextId = 1;
  return {
    installed,
    cleared,
    api: {
      setInterval: (handler: () => void, ms: number) => {
        const t = { id: nextId++, ms, handler };
        installed.push(t);
        return t as any;
      },
      clearInterval: (handle: any) => {
        cleared.push(handle as FakeTimer);
      },
    },
  };
}

test("starts with exactly one timer at the requested interval", () => {
  const { installed, api } = fakeApi();
  const timer = createRestartableTimer(() => {}, api);
  timer.set(60_000);
  assert.equal(installed.length, 1);
  assert.equal(installed[0].ms, 60_000);
  assert.equal(timer.isActive(), true);
  assert.equal(timer.intervalMs(), 60_000);
});

test("changing 60 -> 120 clears the old timer and installs one new timer", () => {
  const { installed, cleared, api } = fakeApi();
  const timer = createRestartableTimer(() => {}, api);

  timer.set(60_000);
  const first = installed[0];

  timer.set(120_000);

  assert.equal(cleared.length, 1, "old timer must be cancelled");
  assert.equal(cleared[0], first, "the exact old handle must be cleared");
  assert.equal(installed.length, 2, "only one new timer installed");
  assert.equal(installed[1].ms, 120_000);
  assert.equal(timer.intervalMs(), 120_000);
  assert.equal(timer.version(), 2);
  assert.equal(timer.isActive(), true);
});

test("setting the same interval still keeps a single timer", () => {
  const { installed, cleared, api } = fakeApi();
  const timer = createRestartableTimer(() => {}, api);
  timer.set(60_000);
  timer.set(60_000);
  assert.equal(installed.length, 2);
  assert.equal(cleared.length, 1);
  assert.equal(timer.isActive(), true);
});

test("intervals are clamped to a safe minimum", () => {
  const { installed, api } = fakeApi();
  const timer = createRestartableTimer(() => {}, api);
  timer.set(0);
  assert.equal(installed[0].ms, 1);
  assert.equal(timer.intervalMs(), 1);
});

test("stop cancels the timer and marks it inactive", () => {
  const { installed, cleared, api } = fakeApi();
  const timer = createRestartableTimer(() => {}, api);
  timer.set(60_000);
  timer.stop();
  assert.equal(cleared.length, 1);
  assert.equal(cleared[0], installed[0]);
  assert.equal(timer.isActive(), false);
});