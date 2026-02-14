// api/src/modules/auth/password.ts

import type { FastifyRequest } from "fastify";
import { getSession } from "../../shared/session/sessionStore.js";

const SHM_BASE_URL =
  (process.env.SHM_BASE_URL || "https://bill.shpyn.online/shm/v1").replace(
    /\/+$/,
    ""
  );

export async function setPassword(req: FastifyRequest, password: string) {
  const pwd = String(password || "").trim();

  if (!pwd || pwd.length < 8) {
    return { ok: false, status: 400, error: "password_too_short" };
  }

  // ВАЖНО: используем твою текущую сигнатуру getSession(req)
  const s = getSession(req as any);
  if (!s?.shmSessionId) {
    return { ok: false, status: 401, error: "not_authenticated" };
  }

  // SHM: POST /user/passwd  { password }
  const res = await fetch(`${SHM_BASE_URL}/user/passwd`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Accept: "application/json",
      Cookie: `session_id=${s.shmSessionId}`,
    },
    body: JSON.stringify({ password: pwd }),
  });

  const json = await res.json().catch(() => undefined);
  const text = json ? "" : await res.text().catch(() => "");

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: "shm_passwd_failed",
      detail: json ?? text,
    };
  }

  // best-effort: отметить в settings (не ломаем flow если упало)
  await fetch(`${SHM_BASE_URL}/template/shpun_app`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      session_id: s.shmSessionId,
      action: "password.mark_set",
    }),
  }).catch(() => undefined);

  return { ok: true };
}
