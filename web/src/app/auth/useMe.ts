// web/src/app/auth/useMe.ts
import { useEffect, useState } from "react";
import { apiFetch } from "../../shared/api/client";

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

  // остаётся для других экранов
  balance: { amount: number; currency: string };
  bonus: number;
  discount: number;

  shm?: { status?: number };
  meRaw?: any; // только в dev, бэк сам решает
};

export function useMe() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  async function refetch() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<MeResponse>("/me");
      setMe(data);
    } catch (e: any) {
      setMe(null);
      setError(e instanceof Error ? e : new Error(String(e?.message || "me_failed")));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { me, loading, error, refetch };
}
