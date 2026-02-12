// api/src/modules/auth/telegram.ts
// Этот файл НЕ регистрирует роуты, чтобы не конфликтовать с modules/auth/routes.ts.
// Он только даёт helper, если позже захочешь вынести логику отдельно.

import { shmAuthWithTelegramWebApp } from "../../shared/shm/shmClient.js";

export type TelegramAuthResult =
  | { ok: true; shmSessionId: string; shmUserId?: number }
  | { ok: false; status: number; error: string; shm?: any };

export async function authTelegramViaShm(initData: string): Promise<TelegramAuthResult> {
  const clean = String(initData ?? "").trim();
  if (!clean) return { ok: false, status: 400, error: "initData_required" };

  const r = await shmAuthWithTelegramWebApp(clean);

  if (!r.ok || !r.json?.session_id) {
    return {
      ok: false,
      status: r.status || 401,
      error: "telegram_auth_failed",
      shm: r.json ?? r.text,
    };
  }

  return { ok: true, shmSessionId: r.json.session_id, shmUserId: r.json.user_id };
}
