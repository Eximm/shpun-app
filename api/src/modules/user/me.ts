// api/src/modules/user/me.ts

import { shmGetMe, shmShpunAppStatus } from "../../shared/shm/shmClient.js";

export type MeView = {
  userId: number;
  login: string;
  fullName?: string;
  phone?: string;
  balance?: number;
  bonus?: number;
  created?: string;
  lastLogin?: string;

  // ShpynApp.onboarding.step_password (0/1 из шаблона v9_6+)
  // ВАЖНО: шаблон мигрировал — пароль теперь в onboarding.step_password,
  // не в auth.password_set. Миграция запускается автоматически при action=status.
  passwordStepDone: boolean;

  // ShpynApp.onboarding.step_email (0/1 из шаблона)
  emailStepDone: boolean;
};

export type MeResult =
  | { ok: true; meRaw: any; me: MeView }
  | { ok: false; status: number; error: string; shm?: any };

function toNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function toStr(v: any, fallback = ""): string {
  const s = String(v ?? "").trim();
  return s.length > 0 ? s : fallback;
}

// Шаблон нормализует все флаги в числа 0/1
function toBool(v: any): boolean {
  return v === 1 || v === "1";
}

export async function fetchMe(shmSessionId: string): Promise<MeResult> {
  // Параллельно: данные пользователя + статус ShpynApp.
  // Два запроса вместо четырёх последовательных.
  const [meResp, statusResp] = await Promise.all([
    shmGetMe(shmSessionId),
    shmShpunAppStatus(shmSessionId),
  ]);

  if (!meResp.ok) {
    return {
      ok: false,
      status: meResp.status || 502,
      error: "shm_me_failed",
      shm: meResp.json ?? meResp.text,
    };
  }

  const meRaw = (meResp.json as any)?.data?.[0] ?? null;
  if (!meRaw) {
    return {
      ok: false,
      status: 502,
      error: "shm_me_empty",
      shm: meResp.json ?? meResp.text,
    };
  }

  // При ошибке statusResp — safe defaults.
  // true для обоих флагов = не гнать пользователя на онбординг при сбое шаблона.
  const appData = statusResp.ok ? ((statusResp.json as any)?.data ?? {}) : null;
  const onboardingData = appData?.onboarding ?? {};

  // onboarding.step_password — новое поле после миграции в шаблоне v9_6
  // При ошибке шаблона → safe default true (не показывать онбординг зря)
  const passwordStepDone = appData ? toBool(onboardingData?.step_password) : true;
  const emailStepDone    = appData ? toBool(onboardingData?.step_email)    : true;

  const me: MeView = {
    userId:   toNum(meRaw.user_id, 0),
    login:    toStr(meRaw.login, ""),
    fullName: toStr(meRaw.full_name, "") || undefined,
    phone:    toStr(meRaw.phone, "") || undefined,
    balance:  toNum(meRaw.balance, 0),
    bonus:    toNum(meRaw.bonus, 0),
    created:  toStr(meRaw.created, "") || undefined,
    lastLogin: toStr(meRaw.last_login, "") || undefined,
    passwordStepDone,
    emailStepDone,
  };

  if (!me.userId || !me.login) {
    return { ok: false, status: 502, error: "shm_me_invalid", shm: { meRaw } };
  }

  return { ok: true, meRaw, me };
}