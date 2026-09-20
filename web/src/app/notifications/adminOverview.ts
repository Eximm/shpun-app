// web/src/app/notifications/adminOverview.ts
//
// Shared admin operational dashboard aggregate.
// Backend: GET /api/admin/overview -> { ok, attention, system, summary, errors }.
//
// Single source of truth for the admin overview cards, the nav badges and the
// topbar bell. Admin-only: the store is only fetched when `enabled` (isAdmin)
// and the endpoint itself enforces ensureAdmin server-side.

import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";

export type AdminOverviewSystemStatus = "ok" | "degraded" | "down" | "unknown";

export type AdminOverviewAttention = {
  total: number;
  support: number;
  partnership: number;
  reviews: number;
};

export type AdminOverviewSystem = {
  status: AdminOverviewSystemStatus;
  offline: number;
  hot: number;
  issues: number;
  total: number;
};

export type AdminOverviewSummary = {
  aliases: number;
  enabledAliases: number;
  partners: number;
  campaigns: number;
};

export type AdminOverviewErrors = {
  support: boolean;
  reviews: boolean;
  system: boolean;
  summary: boolean;
};

export type AdminOverview = {
  attention: AdminOverviewAttention;
  system: AdminOverviewSystem;
  summary: AdminOverviewSummary;
  errors: AdminOverviewErrors;
};

export type AdminOverviewState = {
  data: AdminOverview;
  loading: boolean;
  failed: boolean;
  lastFetchedAt: number;
};

export const EMPTY_ADMIN_OVERVIEW: AdminOverview = {
  attention: { total: 0, support: 0, partnership: 0, reviews: 0 },
  system: { status: "unknown", offline: 0, hot: 0, issues: 0, total: 0 },
  summary: { aliases: 0, enabledAliases: 0, partners: 0, campaigns: 0 },
  errors: { support: false, reviews: false, system: false, summary: false },
};

function toCount(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function toBool(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function toSystemStatus(value: unknown): AdminOverviewSystemStatus {
  const s = String(value ?? "").trim();
  return s === "ok" || s === "degraded" || s === "down" || s === "unknown" ? s : "unknown";
}

let state: AdminOverviewState = {
  data: EMPTY_ADMIN_OVERVIEW,
  loading: false,
  failed: false,
  lastFetchedAt: 0,
};
const listeners = new Set<(s: AdminOverviewState) => void>();

function emit() {
  for (const listener of listeners) listener(state);
}

export function getAdminOverview(): AdminOverviewState {
  return state;
}

/** Drop cached admin data on auth transition (logout / session loss). */
export function clearAdminOverview(): void {
  state = { data: EMPTY_ADMIN_OVERVIEW, loading: false, failed: false, lastFetchedAt: 0 };
  emit();
}

export async function refreshAdminOverview(): Promise<AdminOverview> {
  state = { ...state, loading: true };
  emit();
  try {
    const response = await apiFetch<{
      ok: true;
      attention?: Partial<AdminOverviewAttention>;
      system?: Partial<AdminOverviewSystem>;
      summary?: Partial<AdminOverviewSummary>;
      errors?: Partial<AdminOverviewErrors>;
    }>("/admin/overview", { method: "GET" });

    const data: AdminOverview = {
      attention: {
        total: toCount(response?.attention?.total),
        support: toCount(response?.attention?.support),
        partnership: toCount(response?.attention?.partnership),
        reviews: toCount(response?.attention?.reviews),
      },
      system: {
        status: toSystemStatus(response?.system?.status),
        offline: toCount(response?.system?.offline),
        hot: toCount(response?.system?.hot),
        issues: toCount(response?.system?.issues),
        total: toCount(response?.system?.total),
      },
      summary: {
        aliases: toCount(response?.summary?.aliases),
        enabledAliases: toCount(response?.summary?.enabledAliases),
        partners: toCount(response?.summary?.partners),
        campaigns: toCount(response?.summary?.campaigns),
      },
      errors: {
        support: toBool(response?.errors?.support),
        reviews: toBool(response?.errors?.reviews),
        system: toBool(response?.errors?.system),
        summary: toBool(response?.errors?.summary),
      },
    };

    state = { data, loading: false, failed: false, lastFetchedAt: Date.now() };
    emit();
    return data;
  } catch {
    // Keep the last known data (if any) and mark the whole fetch as failed.
    state = { ...state, loading: false, failed: true, lastFetchedAt: Date.now() };
    emit();
    return state.data;
  }
}

let subscriberCount = 0;
let pollTimer: number | null = null;
let visibilityHandler: (() => void) | null = null;

function subscribePolling(): void {
  subscriberCount += 1;
  if (subscriberCount > 1 || pollTimer != null) return;
  void refreshAdminOverview();
  pollTimer = window.setInterval(() => void refreshAdminOverview(), 60_000);
  visibilityHandler = () => {
    if (document.visibilityState === "visible") void refreshAdminOverview();
  };
  document.addEventListener("visibilitychange", visibilityHandler);
}

function unsubscribePolling(): void {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount > 0) return;
  if (pollTimer != null) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
}

/** Admin-only overview with light polling (single shared interval). */
export function useAdminOverview(enabled: boolean): AdminOverviewState {
  const [snap, setSnap] = useState<AdminOverviewState>(state);

  useEffect(() => {
    if (!enabled) return;

    const listener = (s: AdminOverviewState) => setSnap(s);
    listeners.add(listener);
    listener(state);
    subscribePolling();

    return () => {
      listeners.delete(listener);
      unsubscribePolling();
    };
  }, [enabled]);

  return enabled ? snap : { data: EMPTY_ADMIN_OVERVIEW, loading: false, failed: false, lastFetchedAt: 0 };
}