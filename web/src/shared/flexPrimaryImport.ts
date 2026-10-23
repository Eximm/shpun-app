import { useSyncExternalStore } from "react";

const changed = "shpun:flex-primary-import";
const started = new Set<string>();

type FlexServiceRef = { userServiceId: number; category: string; parent?: number | null };

export function flexPrimaryService<T extends FlexServiceRef>(service: T, items: readonly T[]): T {
  if (service.category !== "remnawave-wl" || !service.parent) return service;
  return items.find((item) => item.userServiceId === service.parent && item.category === "remnawave") ?? service;
}

export function visibleFlexServices<T extends FlexServiceRef>(items: readonly T[]): T[] {
  return items.filter((item) => flexPrimaryService(item, items) === item);
}

function key(userId: number, serviceId: number) {
  return `flex.primary-import.v1:${userId}:${serviceId}`;
}

export function hasFlexPrimaryImport(userId: number, serviceId: number): boolean {
  if (!userId || !serviceId) return false;
  const storageKey = key(userId, serviceId);
  try { return started.has(storageKey) || localStorage.getItem(storageKey) === "1"; }
  catch { return started.has(storageKey); }
}

export function markFlexPrimaryImport(userId: number, serviceId: number) {
  if (!userId || !serviceId) return;
  const storageKey = key(userId, serviceId);
  started.add(storageKey);
  try { localStorage.setItem(storageKey, "1"); } catch { /* Keep the flow usable without storage. */ }
  window.dispatchEvent(new Event(changed));
}

function subscribe(onChange: () => void) {
  window.addEventListener(changed, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(changed, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useFlexPrimaryImport(userId: number, serviceId: number) {
  return useSyncExternalStore(subscribe, () => hasFlexPrimaryImport(userId, serviceId), () => false);
}
