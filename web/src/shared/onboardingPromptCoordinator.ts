import { useEffect, useRef, useState } from "react";

export type OnboardingSurface = "profile" | "first_pay_bonus" | "pwa_install" | "push";

const PRIORITY: Record<OnboardingSurface, number> = {
  profile: 40,
  first_pay_bonus: 30,
  pwa_install: 20,
  push: 10,
};

const contenders = new Map<string, OnboardingSurface>();
const listeners = new Set<() => void>();
let activeId = "";
let activationTimer: number | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

function scheduleNext(delayMs = 420) {
  if (activationTimer !== null || activeId || contenders.size === 0) return;
  activationTimer = window.setTimeout(() => {
    activationTimer = null;
    if (activeId || contenders.size === 0) return;
    const next = [...contenders.entries()].sort((a, b) => PRIORITY[b[1]] - PRIORITY[a[1]])[0];
    activeId = next?.[0] || "";
    notify();
  }, delayMs);
}

function register(id: string, surface: OnboardingSurface) {
  contenders.set(id, surface);
  scheduleNext(activeId ? 0 : 260);
}

function unregister(id: string) {
  contenders.delete(id);
  if (activeId === id) {
    activeId = "";
    notify();
    scheduleNext();
  }
}

export function useOnboardingPromptSlot(
  surface: OnboardingSurface,
  wanted: boolean
): boolean {
  const idRef = useRef(`${surface}:${Math.random().toString(36).slice(2)}`);
  const [, rerender] = useState(0);

  useEffect(() => {
    const listener = () => rerender((value) => value + 1);
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }, []);

  useEffect(() => {
    const id = idRef.current;
    if (wanted) register(id, surface);
    else unregister(id);
    return () => unregister(id);
  }, [surface, wanted]);

  return wanted && activeId === idRef.current;
}
