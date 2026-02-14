// api/src/modules/auth/providers/password.ts

import type { AuthResult } from "../authService.js";

type Mode = "login" | "register";

function shmRoot(): string {
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

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(t);
  }
}

function normalizeLogin(v: any) {
  return String(v ?? "").trim();
}
function normalizePassword(v: any) {
  return String(v ?? "").trim();
}
function normalizeMode(v: any): Mode {
  const s = String(v ?? "login").trim().toLowerCase();
  return s === "register" ? "register" : "login";
}

async function shmRegister(login: string, password: string): Promise<{ ok: true } | { ok: false; status: number; detail: any }> {
  return withTimeout(12_000, async (signal) => {
    const res = await fetch(`${shmV1()}/user`, {
      method: "PUT",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ login, password }),
      signal,
    });

    const json = await safeReadJson(res);
    const text = json ? "" : await res.text().catch(() => "");

    if (!res.ok) return { ok: false, status: res.status || 400, detail: json ?? text };
    return { ok: true };
  });
}

async function shmLogin(login: string, password: string): Promise<AuthResult> {
  return withTimeout(12_000, async (signal) => {
    const res = await fetch(`${shmV1()}/user/auth`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ login, password }),
      signal,
    });

    const json = await safeReadJson(res);
    const text = json ? "" : await res.text().catch(() => "");

    if (!res.ok) {
      return { ok: false, status: res.status || 401, error: "shm_auth_failed", detail: json ?? text };
    }

    const sessionId = String(json?.session_id ?? json?.id ?? "").trim();
    if (!sessionId) {
      return { ok: false, status: 502, error: "shm_auth_invalid_response", detail: json ?? text };
    }

    return { ok: true, shmSessionId: sessionId, login };
  });
}

export async function passwordAuth(body: any): Promise<AuthResult> {
  const login = normalizeLogin(body?.login);
  const password = normalizePassword(body?.password);
  const mode = normalizeMode(body?.mode);

  if (!login || !password) return { ok: false, status: 400, error: "login_and_password_required" };
  if (login.length < 3) return { ok: false, status: 400, error: "login_too_short" };
  if (password.length < 8) return { ok: false, status: 400, error: "password_too_short" };

  try {
    if (mode === "register") {
      const r = await shmRegister(login, password);
      if (!r.ok) return { ok: false, status: r.status, error: "shm_register_failed", detail: r.detail };
      return await shmLogin(login, password);
    }

    return await shmLogin(login, password);
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "timeout" : (e?.message || "network_error");
    return { ok: false, status: 502, error: mode === "register" ? "shm_register_exception" : "shm_auth_exception", detail: msg };
  }
}
