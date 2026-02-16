// api/src/modules/auth/providers/password.ts

import type { AuthResult } from "../authService.js";
import { shmFetch } from "../../../shared/shm/shmClient.js";

type Mode = "login" | "register";

function normalizeLogin(v: unknown) {
  return String(v ?? "").trim();
}
function normalizePassword(v: unknown) {
  return String(v ?? "").trim();
}
function normalizeMode(v: unknown): Mode {
  const s = String(v ?? "login").trim().toLowerCase();
  return s === "register" ? "register" : "login";
}

function extractSessionId(payload: unknown): string {
  const j = (payload ?? {}) as any;
  return String(j?.session_id ?? j?.sessionId ?? j?.id ?? "").trim();
}

function toErrorDetail(e: unknown): string {
  const anyE = e as any;
  if (anyE?.name === "AbortError") return "timeout";
  return String(anyE?.message ?? "network_error");
}

async function withTimeout<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(t);
  }
}

async function shmRegister(login: string, password: string, signal: AbortSignal) {
  // PUT /shm/v1/user  { login, password }
  const r = await shmFetch<any>(null, "v1/user", {
    method: "PUT",
    body: { login, password },
    signal,
  });

  if (r.ok) return { ok: true as const };
  return {
    ok: false as const,
    status: r.status || 400,
    detail: r.json ?? r.text,
  };
}

async function shmLogin(login: string, password: string, signal: AbortSignal): Promise<AuthResult> {
  // POST /shm/v1/user/auth  { login, password }
  const r = await shmFetch<any>(null, "v1/user/auth", {
    method: "POST",
    body: { login, password },
    signal,
  });

  if (!r.ok) {
    return {
      ok: false,
      status: r.status || 401,
      error: "shm_auth_failed",
      detail: r.json ?? r.text,
    };
  }

  const sessionId = extractSessionId(r.json);
  if (!sessionId) {
    return {
      ok: false,
      status: 502,
      error: "shm_auth_invalid_response",
      detail: r.json ?? r.text,
    };
  }

  return { ok: true, shmSessionId: sessionId, login };
}

export async function passwordAuth(body: any): Promise<AuthResult> {
  const login = normalizeLogin(body?.login);
  const password = normalizePassword(body?.password);
  const mode = normalizeMode(body?.mode);

  if (!login || !password) {
    return { ok: false, status: 400, error: "login_and_password_required" };
  }
  if (login.length < 3) {
    return { ok: false, status: 400, error: "login_too_short" };
  }
  if (password.length < 8) {
    return { ok: false, status: 400, error: "password_too_short" };
  }

  try {
    return await withTimeout(12_000, async (signal) => {
      if (mode === "register") {
        const reg = await shmRegister(login, password, signal);
        if (!reg.ok) {
          return {
            ok: false,
            status: reg.status,
            error: "shm_register_failed",
            detail: reg.detail,
          };
        }
        // после регистрации — сразу логиним
        return await shmLogin(login, password, signal);
      }

      return await shmLogin(login, password, signal);
    });
  } catch (e: unknown) {
    const msg = toErrorDetail(e);
    return {
      ok: false,
      status: 502,
      error: mode === "register" ? "shm_register_exception" : "shm_auth_exception",
      detail: msg,
    };
  }
}
