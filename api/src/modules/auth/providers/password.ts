// api/src/modules/auth/providers/password.ts

import type { AuthResult } from "../authService.js";

/**
 * Нам нужен root вида: https://bill.shpyn.online/shm
 * Но в проекте встречается SHM_BASE_URL вида: https://bill.shpyn.online/shm/v1
 * Поэтому аккуратно нормализуем.
 */
function shmRoot(): string {
  const fromBase = String(process.env.SHM_BASE ?? "").trim(); // если есть — обычно ".../shm/"
  if (fromBase) {
    const b = fromBase.endsWith("/") ? fromBase.slice(0, -1) : fromBase;
    // ожидаем ".../shm"
    return b.endsWith("/shm") ? b : b;
  }

  const baseUrl = String(process.env.SHM_BASE_URL ?? "https://bill.shpyn.online/shm/v1").trim();
  const b = baseUrl.replace(/\/+$/, ""); // trim trailing slash
  // если это ".../shm/v1" → берём ".../shm"
  if (b.endsWith("/shm/v1")) return b.slice(0, -3); // remove "/v1"
  // если это ".../shm" → ок
  if (b.endsWith("/shm")) return b;
  // fallback
  return "https://bill.shpyn.online/shm";
}

function toFormUrlEncoded(data: Record<string, string>) {
  return Object.entries(data)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/**
 * Password auth через SHM:
 * POST /shm/user/auth.cgi  (x-www-form-urlencoded login/password)
 * Возвращает JSON { session_id, user_id, status, ... }
 */
export async function passwordAuth(body: any): Promise<AuthResult> {
  const login = String(body?.login ?? "").trim();
  const password = String(body?.password ?? "").trim();

  if (!login || !password) {
    return { ok: false, status: 400, error: "login_and_password_required" };
  }

  try {
    const res = await fetch(`${shmRoot()}/user/auth.cgi`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: toFormUrlEncoded({ login, password }),
    });

    const json: any = await res.json().catch(() => undefined);
    const text = json ? "" : await res.text().catch(() => "");

    if (!res.ok) {
      return {
        ok: false,
        status: res.status || 401,
        error: "shm_auth_failed",
        detail: json ?? text,
      };
    }

    const sessionId = String(json?.session_id ?? "").trim();
    const userId = Number(json?.user_id ?? 0) || 0;

    if (!sessionId || !userId) {
      return {
        ok: false,
        status: 502,
        error: "shm_auth_invalid_response",
        detail: json ?? text,
      };
    }

    return {
      ok: true,
      shmSessionId: sessionId,
      shmUserId: userId,
      login,
    };
  } catch (e: any) {
    return { ok: false, status: 502, error: "shm_auth_exception", detail: e?.message };
  }
}
