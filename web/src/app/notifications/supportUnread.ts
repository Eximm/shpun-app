// web/src/app/notifications/supportUnread.ts
//
// Minimal shared store for the admin support unread badge.
// Backend endpoint: GET /api/admin/support/unread -> { ok, count }.
// No parallel notification system: this only mirrors the support unread count.

import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";

export type SupportUnreadState = {
  count: number;
  loading: boolean;
  lastFetchedAt: number;
};

let state: SupportUnreadState = { count: 0, loading: false, lastFetchedAt: 0 };
const listeners = new Set<(s: SupportUnreadState) => void>();

function emit() {
  for (const listener of listeners) listener(state);
}

export function getSupportUnread(): SupportUnreadState {
  return state;
}

export async function refreshSupportUnread(): Promise<number> {
  state = { ...state, loading: true };
  emit();
  try {
    const response = await apiFetch<{ ok: true; count: number }>("/admin/support/unread", {
      method: "GET",
    });
    const raw = Number(response?.count ?? 0);
    state = {
      count: Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0,
      loading: false,
      lastFetchedAt: Date.now(),
    };
  } catch {
    state = { ...state, loading: false, lastFetchedAt: Date.now() };
  }
  emit();
  return state.count;
}

/** Admin-only unread counter with light polling. */
export function useSupportUnread(enabled: boolean): number {
  const [count, setCount] = useState(state.count);

  useEffect(() => {
    if (!enabled) return;

    const listener = (s: SupportUnreadState) => setCount(s.count);
    listeners.add(listener);
    listener(state);

    void refreshSupportUnread();
    const timer = window.setInterval(() => void refreshSupportUnread(), 60_000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refreshSupportUnread();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      listeners.delete(listener);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  return enabled ? count : 0;
}
