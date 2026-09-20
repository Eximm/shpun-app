// api/src/modules/serverStatus/restartableTimer.ts
//
// A single restartable interval timer. Setting a new interval clears the
// previous timer before installing the new one, so there is never more than one
// active collector timer. Timers are injected for deterministic tests.

export type TimerHandle = ReturnType<typeof setInterval>;

export type TimerApi = {
  setInterval: (handler: () => void, ms: number) => TimerHandle;
  clearInterval: (handle: TimerHandle) => void;
};

export type RestartableTimer = {
  set(ms: number): void;
  stop(): void;
  isActive(): boolean;
  intervalMs(): number;
  /** Number of times `set()` actually installed a new timer. */
  version(): number;
};

export function createRestartableTimer(handler: () => void, api?: Partial<TimerApi>): RestartableTimer {
  const setIntervalFn = api?.setInterval ?? ((fn, ms) => setInterval(fn, ms));
  const clearIntervalFn = api?.clearInterval ?? ((h) => clearInterval(h));

  let handle: TimerHandle | null = null;
  let interval = 0;
  let installed = 0;

  function set(ms: number) {
    const next = Math.max(1, Math.trunc(ms));
    if (handle != null) {
      clearIntervalFn(handle);
      handle = null;
    }
    handle = setIntervalFn(handler, next);
    (handle as any)?.unref?.();
    interval = next;
    installed += 1;
  }

  function stop() {
    if (handle != null) {
      clearIntervalFn(handle);
      handle = null;
    }
  }

  return {
    set,
    stop,
    isActive: () => handle != null,
    intervalMs: () => interval,
    version: () => installed,
  };
}