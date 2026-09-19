// api/src/modules/auth/password.ts

import type { FastifyRequest } from "fastify";
import { getSession } from "../../shared/session/sessionStore.js";
import { shmFetch } from "../../shared/shm/shmClient.js";

type SetPasswordResult =
  | { ok: true }
  | { ok: false; status: number; error: string; detail?: unknown };

export async function setPassword(
  req: FastifyRequest,
  password: string
): Promise<SetPasswordResult> {
  const pwd = String(password || "").trim();

  if (!pwd || pwd.length < 8) {
    return { ok: false, status: 400, error: "password_too_short" };
  }

  const s = getSession(req);
  if (!s?.shmSessionId) {
    return { ok: false, status: 401, error: "not_authenticated" };
  }

  // POST /v1/user/passwd { password }
  // Используем shmFetch — единственный транспорт к SHM (таймаут, логирование, нормализация).
  const r = await shmFetch<any>(s.shmSessionId, "v1/user/passwd", {
    method: "POST",
    body: { password: pwd },
  });

  if (!r.ok) {
    return {
      ok: false,
      status: r.status || 502,
      error: "shm_passwd_failed",
      detail: r.json ?? r.text,
    };
  }

  // Фиксацию onboarding.mark step=password делаем в auth/routes.ts ПОСЛЕ re-auth,
  // т.к. после смены пароля SHM может ротировать session_id.
  return { ok: true };
}