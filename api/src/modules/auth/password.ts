// api/src/modules/auth/password.ts

import type { FastifyRequest } from "fastify";
import { getSession } from "../../shared/session/sessionStore.js";

function shmRoot(): string {
  // ожидаем ".../shm/" или ".../shm"
  const b0 = String(process.env.SHM_BASE ?? "").trim();
  const b = (b0 || "https://bill.shpyn.online/shm/").replace(/\/+$/, "");
  if (b.endsWith("/shm/v1")) return b.slice(0, -3);
  return b;
}
function shmV1(): string {
  return `${shmRoot()}/v1`;
}

async function safeReadJson(res: Response): Promise<any | null> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export async function setPassword(req: FastifyRequest, password: string) {
  const pwd = String(password || "").trim();

  if (!pwd || pwd.length < 8) {
    return { ok: false, status: 400, error: "password_too_short" };
  }

  const s = getSession(req as any);
  if (!s?.shmSessionId) {
    return { ok: false, status: 401, error: "not_authenticated" };
  }

  // SHM: POST /user/passwd  { password }
  const res = await fetch(`${shmV1()}/user/passwd`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
      "session-id": String(s.shmSessionId),
    },
    body: JSON.stringify({ password: pwd }),
  });

  const json = await safeReadJson(res);
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
  await fetch(`${shmV1()}/template/shpun_app`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      session_id: String(s.shmSessionId),
      action: "password.mark_set",
    }),
  }).catch(() => undefined);

  return { ok: true };
}
