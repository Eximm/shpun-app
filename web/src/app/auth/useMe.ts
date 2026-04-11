// web/src/app/auth/useMe.ts

import { useEffect, useState } from "react";
import { apiFetch, isNotAuthenticated } from "../../shared/api/client";

export type MeResponse = {
  ok: true;
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

async function doFetchMe(): Promise<MeResponse | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    setState({ loading: true, error: null });

    try {
      const data = await apiFetch<MeResponse>("/me", { method: "GET" });
      setState({
        me: data,
        loading: false,
        error: null,
        authRequired: false,
        lastFetchedAt: Date.now(),
      });
      return data;
    } catch (e: any) {
      const authRequired = isNotAuthenticated(e);
      const err: Error = e instanceof Error ? e : new Error(String(e?.message || "me_failed"));
      const hasLoadedMeBefore = !!state.me;

      setState({
        me: hasLoadedMeBefore ? state.me : null,
        loading: false,
        error: err,
        authRequired: hasLoadedMeBefore ? false : authRequired,
        lastFetchedAt: Date.now(),
      });

      return hasLoadedMeBefore ? state.me : null;
    } finally {
      inFlight = null;
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