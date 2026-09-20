// web/src/app/notifications/adminOverview.ts
//
// Shared admin operational dashboard aggregate.
// Backend: GET /api/admin/overview ->
//   { ok, updatedAt, attention, system, summary, today, activity, errors }.
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
  monitoring: number;
};

export type AdminOverviewSystem = {
  status: AdminOverviewSystemStatus;
  offline: number;
  hot: number;
  issues: number;
  total: number;
  incidents: number;
  warnings: number;
  criticals: number;
};

export type AdminOverviewSummary = {
  aliases: number;
  enabledAliases: number;
  partners: number;
  campaigns: number;
};

export type AdminOverviewToday = {
  supportTickets: number;
  partnershipTickets: number;
  referrals: number;
  reviews: number;
};

export type AdminOverviewActivityItem = {
  type: string;
  ts: number;
  reason?: string;
  ticketId?: number;
  publicNo?: string;
  reviewId?: number;
  alias?: string;
  message?: string;
};

export type AdminOverviewErrors = {
  support: boolean;
  reviews: boolean;
  system: boolean;
  summary: boolean;
  today: boolean;
  activity: boolean;
};

export type AdminOverview = {
  attention: AdminOverviewAttention;
  system: AdminOverviewSystem;
  summary: AdminOverviewSummary;
  today: AdminOverviewToday;
  activity: AdminOverviewActivityItem[];
  updatedAt: string;
  errors: AdminOverviewErrors;
};

export type AdminOverviewState = {
  data: AdminOverview;
  loading: boolean;
  failed: boolean;
  lastFetchedAt: number;
};

export const EMPTY_ADMIN_OVERVIEW: AdminOverview = {
  attention: { total: 0, support: 0, partnership: 0, reviews: 0, monitoring: 0 },
  system: { status: "unknown", offline: 0, hot: 0, issues: 0, total: 0, incidents: 0, warnings: 0, criticals: 0 },
  summary: { aliases: 0, enabledAliases: 0, partners: 0, campaigns: 0 },
  today: { supportTickets: 0, partnershipTickets: 0, referrals: 0, reviews: 0 },
  activity: [],
  updatedAt: "",
  errors: { support: false, reviews: false, system: false, summary: false, today: false, activity: false },
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

function toActivityItem(raw: unknown): AdminOverviewActivityItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const type = String(r.type ?? "").trim();
  const ts = toCount(r.ts);
  if (!type || ts <= 0) return null;
  return {
    type,
    ts,
    ...(r.reason ? { reason: String(r.reason) } : {}),
    ...(toCount(r.ticketId) ? { ticketId: toCount(r.ticketId) } : {}),
    ...(r.publicNo ? { publicNo: String(r.publicNo) } : {}),
    ...(toCount(r.reviewId) ? { reviewId: toCount(r.reviewId) } : {}),
    ...(r.alias ? { alias: String(r.alias) } : {}),
    ...(r.message ? { message: String(r.message) } : {}),
  };
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
      updatedAt?: string;
      attention?: Partial<AdminOverviewAttention>;
      system?: Partial<AdminOverviewSystem>;
      summary?: Partial<AdminOverviewSummary>;
      today?: Partial<AdminOverviewToday>;
      activity?: unknown[];
      errors?: Partial<AdminOverviewErrors>;
    }>("/admin/overview", { method: "GET" });

    const data: AdminOverview = {
      attention: {
        total: toCount(response?.attention?.total),
        support: toCount(response?.attention?.support),
        partnership: toCount(response?.attention?.partnership),
        reviews: toCount(response?.attention?.reviews),
        monitoring: toCount(response?.attention?.monitoring),
      },
      system: {
        status: toSystemStatus(response?.system?.status),
        offline: toCount(response?.system?.offline),
        hot: toCount(response?.system?.hot),
        issues: toCount(response?.system?.issues),
        total: toCount(response?.system?.total),
        incidents: toCount(response?.system?.incidents),
        warnings: toCount(response?.system?.warnings),
        criticals: toCount(response?.system?.criticals),
      },
      summary: {
        aliases: toCount(response?.summary?.aliases),
        enabledAliases: toCount(response?.summary?.enabledAliases),
        partners: toCount(response?.summary?.partners),
        campaigns: toCount(response?.summary?.campaigns),
      },
      today: {
        supportTickets: toCount(response?.today?.supportTickets),
        partnershipTickets: toCount(response?.today?.partnershipTickets),
        referrals: toCount(response?.today?.referrals),
        reviews: toCount(response?.today?.reviews),
      },
      activity: Array.isArray(response?.activity)
        ? response!.activity!.map(toActivityItem).filter((x): x is AdminOverviewActivityItem => x !== null).slice(0, 8)
        : [],
      updatedAt: typeof response?.updatedAt === "string" ? response.updatedAt : new Date().toISOString(),
      errors: {
        support: toBool(response?.errors?.support),
        reviews: toBool(response?.errors?.reviews),
        system: toBool(response?.errors?.system),
        summary: toBool(response?.errors?.summary),
        today: toBool(response?.errors?.today),
        activity: toBool(response?.errors?.activity),
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

function startPollTimer(): void {
  if (pollTimer != null) return;
  pollTimer = window.setInterval(() => void refreshAdminOverview(), 60_000);
}

function stopPollTimer(): void {
  if (pollTimer == null) return;
  window.clearInterval(pollTimer);
  pollTimer = null;
}

function handleVisibility(): void {
  if (document.visibilityState === "visible") {
    void refreshAdminOverview();
    startPollTimer();
  } else {
    // Hidden tab: stop useless polling, refresh immediately on return.
    stopPollTimer();
  }
}

function subscribePolling(): void {
  subscriberCount += 1;
  if (subscriberCount > 1) return;
  void refreshAdminOverview();
  if (document.visibilityState === "visible") startPollTimer();
  visibilityHandler = handleVisibility;
  document.addEventListener("visibilitychange", visibilityHandler);
}

function unsubscribePolling(): void {
  subscriberCount = Math.max(0, subscriberCount - 1);
  if (subscriberCount > 0) return;
  stopPollTimer();
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