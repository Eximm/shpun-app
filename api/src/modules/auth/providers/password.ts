import type { AuthResult } from "../authService.js";
import { shmFetch } from "../../../shared/shm/shmClient.js";

type Mode = "login" | "register";

function normalizeLogin(v: unknown) {
  return String(v ?? "").trim();
}

function normalizePassword(v: unknown) {
  return String(v ?? "").trim();
}

function normalizeClient(v: unknown, fallbackLogin: string) {
  const s = String(v ?? "").trim();
  return s || fallbackLogin;
}

function normalizeMode(v: unknown): Mode {
  const s = String(v ?? "login").trim().toLowerCase();
  return s === "register" ? "register" : "login";
}

function normalizePartnerId(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function normalizeClientIp(v: unknown): string {
  return String(v ?? "").trim();
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

function buildIpHeaders(clientIp?: string): Record<string, string> | undefined {
  const ip = String(clientIp ?? "").trim();
  if (!ip) return undefined;

  return {
    "X-Real-IP": ip,
    "X-Forwarded-For": ip,
  };
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

async function shmRegister(
  login: string,
  password: string,
  client: string,
  partnerId: number,
  clientIp: string,
  signal: AbortSignal
) {
  const body: Record<string, any> = {
    login,
    password,
  };

  if (partnerId > 0) {
    body.partner_id = partnerId;
  }

  const r = await shmFetch<any>(null, "v1/user", {
    method: "PUT",
    headers: buildIpHeaders(clientIp),
    body,
    signal,
  });

  if (r.ok) {
    return {
      ok: true as const,
      detail: r.json ?? r.text,
    };
  }

  return {
    ok: false as const,
    status: r.status || 400,
    detail: r.json ?? r.text,
  };
}

async function shmLogin(
  login: string,
  password: string,
  clientIp: string,
  signal: AbortSignal
): Promise<AuthResult> {
  const r = await shmFetch<any>(null, "v1/user/auth", {
    method: "POST",
    headers: buildIpHeaders(clientIp),
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

async function shmSetClientName(
  sessionId: string,
  client: string,
  signal: AbortSignal
) {
  if (!client) return;

  await shmFetch(sessionId, "v1/user", {
    method: "POST",
    body: {
      full_name: client,
    },
    signal,
  });
}

export async function passwordAuth(body: any): Promise<AuthResult> {
  const login = normalizeLogin(body?.login);
  const password = normalizePassword(body?.password);
  const client = normalizeClient(body?.client, login);
  const mode = normalizeMode(body?.mode);
  const partnerId = normalizePartnerId(body?.partner_id);
  const clientIp = normalizeClientIp(body?.client_ip);

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
        const reg = await shmRegister(
          login,
          password,
          client,
          partnerId,
          clientIp,
          signal
        );

        if (!reg.ok) {
          return {
            ok: false,
            status: reg.status,
            error: "shm_register_failed",
            detail: reg.detail,
          };
        }

        const auth = await shmLogin(login, password, clientIp, signal);

        if (auth.ok && auth.shmSessionId) {
          try {
            await shmSetClientName(auth.shmSessionId, client, signal);
          } catch {
            // имя не критично
          }
        }

        return auth;
      }

      return await shmLogin(login, password, clientIp, signal);
    });
  } catch (e: unknown) {
    const msg = toErrorDetail(e);

    return {
      ok: false,
      status: 502,
      error:
        mode === "register"
          ? "shm_register_exception"
          : "shm_auth_exception",
      detail: msg,
    };
  }
}