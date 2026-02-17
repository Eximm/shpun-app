// api/src/modules/user/me.ts
import { shmFetch, shmGetMe, toFormUrlEncoded } from "../../shared/shm/shmClient.js";

export type MeView = {
  userId: number;
  login: string;
  fullName?: string;
  phone?: string;

  // Эти поля могут быть полезны другим экранам (Home/Payments),
  // в Profile UI мы их больше не показываем.
  balance?: number;
  bonus?: number;
  created?: string;
  lastLogin?: string;

  passwordSet: boolean;
};

export type MeResult =
  | { ok: true; meRaw: any; me: MeView }
  | { ok: false; status: number; error: string; shm?: any };

function toNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toStr(v: any, fallback = "") {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : fallback;
}

async function getPasswordSet(shmSessionId: string): Promise<boolean> {
  try {
    const r = await shmFetch<any>(null, "v1/template/shpun_app", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: toFormUrlEncoded({ session_id: shmSessionId, action: "status" }),
    });

    const flag = (r.json as any)?.data?.auth?.password_set;
    return flag === 1 || flag === "1";
  } catch {
    return false;
  }
}

export async function fetchMe(shmSessionId: string): Promise<MeResult> {
  const r = await shmGetMe(shmSessionId);

  if (!r.ok) {
    return {
      ok: false,
      status: r.status || 502,
      error: "shm_me_failed",
      shm: r.json ?? r.text,
    };
  }

  const meRaw = (r.json as any)?.data?.[0] ?? null;
  if (!meRaw) {
    return {
      ok: false,
      status: 502,
      error: "shm_me_empty",
      shm: r.json ?? r.text,
    };
  }

  const passwordSet = await getPasswordSet(shmSessionId);

  const me: MeView = {
    userId: toNum(meRaw.user_id, 0),
    login: toStr(meRaw.login, ""),
    fullName: toStr(meRaw.full_name, "") || undefined,
    phone: toStr(meRaw.phone, "") || undefined,

    balance: toNum(meRaw.balance, 0),
    bonus: toNum(meRaw.bonus, 0),
    created: toStr(meRaw.created, "") || undefined,
    lastLogin: toStr(meRaw.last_login, "") || undefined,

    passwordSet,
  };

  if (!me.userId || !me.login) {
    return {
      ok: false,
      status: 502,
      error: "shm_me_invalid",
      shm: { meRaw },
    };
  }

  return { ok: true, meRaw, me };
}
