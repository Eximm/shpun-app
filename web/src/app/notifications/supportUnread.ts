// web/src/app/notifications/supportUnread.ts
//
// Shared admin support unread counts (support + partnership).
// Backend: GET /api/admin/support/unread -> { ok, total, support, partnership }.
// One endpoint, one shared store — the bell, the admin nav badge and the inbox
// tabs all read from here.

import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";

export type SupportUnreadCounts = {
  total: number;
  support: number;
  partnership: number;
};

export type SupportUnreadState = SupportUnreadCounts & {
  loading: boolean;
  lastFetchedAt: number;
};

const EMPTY: SupportUnreadCounts = { total: 0, support: 0, partnership: 0 };

let state: SupportUnreadState = { ...EMPTY, loading: false, lastFetchedAt: 0 };
const listeners = new Set<(s: SupportUnreadState) => void>();

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function emit() {
  for (const listener of listeners) listener(state);
}

export function getSupportUnread(): SupportUnreadState {
  return state;
}

export async function refreshSupportUnread(): Promise<SupportUnreadCounts> {
  state = { ...state, loading: true };
  emit();
  try {
    const response = await apiFetch<{
      ok: true;
      total?: number;
      support?: number;
      partnership?: number;
      count?: number;
    }>("/admin/support/unread", { method: "GET" });

    const support = toCount(response?.support);
    const partnership = toCount(response?.partnership);
    const total = toCount(response?.total) || toCount(response?.count) || support + partnership;

    state = { total, support, partnership, loading: false, lastFetchedAt: Date.now() };
  } catch {
    state = { ...state, loading: false, lastFetchedAt: Date.now() };
  }
  emit();
  return { total: state.total, support: state.support, partnership: state.partnership };
}

/** Admin-only unread counts with light polling. */
export function useSupportUnread(enabled: boolean): SupportUnreadCounts {
  const [counts, setCounts] = useState<SupportUnreadCounts>({
    total: state.total,
    support: state.support,
    partnership: state.partnership,
  });

  useEffect(() => {
    if (!enabled) return;

    const listener = (s: SupportUnreadState) =>
      setCounts({ total: s.total, support: s.support, partnership: s.partnership });
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

  return enabled ? counts : EMPTY;
}
