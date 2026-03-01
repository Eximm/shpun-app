// web/src/app/auth/useMe.ts
import { useEffect, useState } from "react";
import { apiFetch, isNotAuthenticated } from "../../shared/api/client";

export type MeResponse = {
  ok: true;
  profile: {
    id: number;
    displayName: string;
    login: string | null;
    fullName: string | null;
    phone?: string | null;
    passwordSet: boolean;
    created?: string | null;
    lastLogin?: string | null;
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

let inFlight: Promise<void> | null = null;

async function doFetchMe() {
  // дедуп запросов
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
    } catch (e: any) {
      const authRequired = isNotAuthenticated(e);
      const err: Error =
        e instanceof Error ? e : new Error(String(e?.message || "me_failed"));

      setState({
        me: null,
        loading: false,
        error: err,
        authRequired,
        lastFetchedAt: Date.now(),
      });
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

export function refetchMe() {
  return doFetchMe();
}

export function useMe() {
  const [snap, setSnap] = useState<State>(state);

  useEffect(() => {
    const onChange = (s: State) => setSnap(s);
    listeners.add(onChange);

    // первый раз — грузим, если ещё не грузили
    if (state.loading && state.lastFetchedAt === 0) {
      doFetchMe().catch(() => {});
    }

    return () => {
      listeners.delete(onChange);
    };
  }, []);

  return {
    me: snap.me,
    loading: snap.loading,
    error: snap.error,
    authRequired: snap.authRequired,
    refetch: refetchMe,
  };
}