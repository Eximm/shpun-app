// web/src/app/auth/useMe.ts

import { useEffect, useState } from "react";
import { apiFetch, isNotAuthenticated } from "../../shared/api/client";

export type MeResponse = {
  ok: true;
  authSessionId?: string;
  profile: {
    id: number;
    displayName: string;
    login: string | null;
    login2?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    fullName: string | null;
    phone?: string | null;

    // Флаги онбординга из ShpynApp (шаблон v9_6+).
    // passwordStepDone = onboarding.step_password (новое поле после миграции шаблона)
    // emailStepDone    = onboarding.step_email
    passwordStepDone?: boolean;
    emailStepDone?: boolean;

    created?: string | null;
    lastLogin?: string | null;
    role?: string | null;
    isAdmin?: boolean;
  };
  admin?: {
    role?: string | null;
    isAdmin?: boolean;
  };
  telegram?: {
    login?: string | null;
    username?: string | null;
    chatId?: number | string | null;
    status?: string | null;
  } | null;
  balance: { amount: number; currency: string };
  bonus: number;
  discount: number;
  referralsCount?: number;
  referralBonus?: {
    pending: boolean;
    percent: number;
    campaign?: string;
    bannerSeen: boolean;
  };
  shm?: { status?: number };
  meRaw?: any;
};

type State = {
  me: MeResponse | null;
  loading: boolean;
  error: Error | null;
  authRequired: boolean;
  lastFetchedAt: number;
};

let state: State = {
  me: null,
  loading: true,
  error: null,
  authRequired: false,
  lastFetchedAt: 0,
};

// Monotonic epoch so an in-flight `/me` can never resurrect a session that was
// cleared by logout. `clearMe()` bumps it; stale responses are ignored.
let epoch = 0;

type Listener = (s: State) => void;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(state);
}

function setState(patch: Partial<State>) {
  state = { ...state, ...patch };
  emit();
}

function hasFreshAuthPending(): boolean {
  try {
    const provider = String(sessionStorage.getItem("auth:pending") || "").trim();
    const ts = Number(sessionStorage.getItem("auth:pending_at") || "0");
    if (!provider) return false;
    if (!ts) return true;
    return Date.now() - ts <= 15_000;
  } catch {
    return false;
  }
}

let inFlight: Promise<MeResponse | null> | null = null;

/** Snapshot for non-React consumers and tests. */
export function getMeState(): State {
  return state;
}

/**
 * Hard reset of the authenticated frontend state.
 *
 * Called on logout and whenever the server reports an unauthenticated session.
 * It immediately drops `me` (and therefore admin flags), marks the session as
 * required and invalidates any in-flight `/me` request so it cannot restore the
 * stale authenticated shell.
 */
export function clearMe(): void {
  epoch += 1;
  inFlight = null;
  state = {
    me: null,
    loading: false,
    error: null,
    authRequired: true,
    lastFetchedAt: Date.now(),
  };
  emit();
}

async function doFetchMe(): Promise<MeResponse | null> {
  if (inFlight) return inFlight;

  const myEpoch = epoch;

  inFlight = (async () => {
    // Если me уже загружен — не показываем лоадер (фоновое обновление).
    // Лоадер только при первой загрузке когда me === null.
    const isFirstLoad = !state.me;
    if (isFirstLoad) setState({ loading: true, error: null });

    try {
      const data = await apiFetch<MeResponse>("/me", { method: "GET" });
      if (myEpoch !== epoch) return null;
      setState({
        me: data,
        loading: false,
        error: null,
        authRequired: false,
        lastFetchedAt: Date.now(),
      });
      return data;
    } catch (e: any) {
      if (myEpoch !== epoch) return null;

      const authRequired = isNotAuthenticated(e);
      const err: Error = e instanceof Error ? e : new Error(String(e?.message || "me_failed"));

      if (authRequired) {
        // Server explicitly said "not authenticated": never keep a stale `me`.
        setState({
          me: null,
          loading: false,
          error: err,
          authRequired: true,
          lastFetchedAt: Date.now(),
        });
        return null;
      }

      // Transient (network/5xx): keep the previous identity for resilience.
      setState({
        me: state.me,
        loading: false,
        error: err,
        authRequired: state.me ? false : state.authRequired,
        lastFetchedAt: Date.now(),
      });
      return state.me;
    } finally {
      if (myEpoch === epoch) inFlight = null;
    }
  })();

  return inFlight;
}

export function refetchMe(): Promise<MeResponse | null> {
  return doFetchMe();
}

export function useMe() {
  const [snap, setSnap] = useState<State>(state);

  useEffect(() => {
    const onChange = (s: State) => setSnap(s);
    listeners.add(onChange);

    if (state.loading && state.lastFetchedAt === 0 && !hasFreshAuthPending()) {
      doFetchMe().catch(() => {});
    }

    return () => { listeners.delete(onChange); };
  }, []);

  return {
    me: snap.me,
    loading: snap.loading,
    error: snap.error,
    authRequired: snap.authRequired,
    refetch: refetchMe,
  };
}