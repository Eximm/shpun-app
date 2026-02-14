// api/src/modules/user/me.ts
// Helper без регистрации роутов (чтобы не конфликтовать с modules/user/routes.ts)

import { shmGetMe } from "../../shared/shm/shmClient.js";

export type MeView = {
  userId: number;
  login: string;
  fullName?: string;
  balance?: number;
  bonus?: number;
  created?: string;
  lastLogin?: string;

  // Будущий флаг из settings (через SHM template shpun_app)
  // Сейчас может быть null/undefined, пока не подключим settings слой
  passwordSet?: boolean | null;

  // На будущее (под Google/Yandex и т.п.)
  // telegramLinked?: boolean | null;
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

  // По swagger User: user_id, login, full_name, balance, bonus, created, last_login, ...
  const me: MeView = {
    userId: toNum(meRaw.user_id, 0),
    login: toStr(meRaw.login, ""),
    fullName: toStr(meRaw.full_name, "") || undefined,
    balance: toNum(meRaw.balance, 0),
    bonus: toNum(meRaw.bonus, 0),
    created: toStr(meRaw.created, "") || undefined,
    lastLogin: toStr(meRaw.last_login, "") || undefined,

    // пока не подключили settings → неизвестно
    passwordSet: null,
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
