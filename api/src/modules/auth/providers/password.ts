// api/src/modules/auth/providers/password.ts

import type { AuthResult } from "../authService.js";
import { shmFetch, toFormUrlEncoded } from "../../../shared/shm/shmClient.js";
import { validateRegistrationEmail } from "../../../shared/utils/email.js";
import { createHash } from "node:crypto";

type Mode = "login" | "register" | "telegram_register";

/* ============================================================
   Telegram deterministic password (ВАЖНО)
============================================================ */

function getTelegramAuthSalt(): string {
  return String(
    process.env.TELEGRAM_AUTH_SALT ||
      process.env.APP_SECRET ||
      process.env.SESSION_SECRET ||
      "shpun_telegram_auth_fallback"
  );
}

function generateTelegramPassword(tgId: string): string {
  const cleanId = String(tgId ?? "").trim();
  const salt = getTelegramAuthSalt();

  const hex = createHash("sha256")
    .update(`tg-auth:${cleanId}:${salt}`)
    .digest("hex");

  return `tg_${cleanId}_${hex.slice(0, 24)}`;
}

/* ============================================================
   нормализация входных данных
============================================================ */

function normalizeLogin(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizePassword(v: unknown): string {
  return String(v ?? "").trim();
}

function normalizeClient(v: unknown, fallback: string): string {
  const s = String(v ?? "").trim();
  return s || fallback;
}

function normalizeMode(v: unknown): Mode {
  const s = String(v ?? "").trim().toLowerCase();
  if (s === "register") return "register";
  if (s === "telegram_register") return "telegram_register";
  return "login";
}

function normalizePartnerId(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

function normalizeClientIp(v: unknown): string {
  return String(v ?? "").trim();
}

function isTelegramStyleLogin(v: string): boolean {
  return /^@\S+$/.test(String(v ?? "").trim());
}

function isTelegramRegisterLogin(v: string): boolean {
  return /^@\d+$/.test(String(v ?? "").trim());
}

function buildIpHeaders(ip?: string): Record<string, string> | undefined {
  const s = String(ip ?? "").trim();
  if (!s) return undefined;
  return { "X-Real-IP": s, "X-Forwarded-For": s };
}

function toErrorDetail(e: unknown): string {
  const a = e as any;
  return a?.name === "AbortError"
    ? "timeout"
    : String(a?.message ?? "network_error");
}

async function withTimeout<T>(
  ms: number,
  fn: (signal: AbortSignal) => Promise<T>
): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } finally {
    clearTimeout(t);
  }
}

/* ============================================================
   SHM операции
============================================================ */

async function shmRegister(
  login: string,
  password: string,
  partnerId: number,
  clientIp: string,
  signal: AbortSignal
): Promise<{ ok: true } | { ok: false; status: number; detail: unknown }> {
  const body: Record<string, any> = { login, password };
  if (partnerId > 0) body.partner_id = partnerId;

  const r = await shmFetch<any>(null, "v1/user", {
    method: "PUT",
    headers: buildIpHeaders(clientIp),
    body,
    signal,
  });

  return r.ok
    ? { ok: true }
    : { ok: false, status: r.status || 400, detail: r.json ?? r.text };
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
      error: "invalid_credentials",
      detail: r.json ?? r.text,
    };
  }

  const sessionId = String(
    (r.json as any)?.session_id ?? (r.json as any)?.id ?? ""
  ).trim();

  if (!sessionId) {
    return {
      ok: false,
      status: 502,
      error: "shm_auth_invalid_response",
      detail: r.json ?? r.text,
    };
  }

  let shmUserId = 0;

  try {
    const meR = await shmFetch<any>(sessionId, "v1/user", {
      method: "GET",
      query: { limit: 1, offset: 0 },
      signal,
    });

    if (meR.ok) {
      const row = Array.isArray((meR.json as any)?.data)
        ? (meR.json as any).data[0]
        : (meR.json as any)?.data ?? {};

      shmUserId = Number(row?.user_id ?? row?.id ?? 0) || 0;
    }
  } catch {}

  return {
    ok: true,
    shmSessionId: sessionId,
    shmUserId: shmUserId || undefined,
    login,
  };
}

async function shmSetClientName(
  sessionId: string,
  client: string,
  signal: AbortSignal
) {
  if (!client) return;
  await shmFetch(sessionId, "v1/user", {
    method: "POST",
    body: { full_name: client },
    signal,
  });
}

async function shmSetLogin2(
  sessionId: string,
  email: string,
  signal: AbortSignal
) {
  await shmFetch(sessionId, "v1/user", {
    method: "POST",
    body: { login2: email },
    signal,
  });
}

async function shmSetEmail(
  sessionId: string,
  email: string,
  signal: AbortSignal
) {
  await shmFetch(sessionId, "v1/user/email", {
    method: "PUT",
    body: { email },
    signal,
  });
}

async function markShpunAppFlags(
  sessionId: string,
  flags: { passwordSet?: boolean; emailStepDone?: boolean },
  signal: AbortSignal
) {
  const actions: Array<{ action: string; params?: Record<string, any> }> = [];

  if (flags.passwordSet) {
    actions.push({ action: "password.mark_set" });
    actions.push({ action: "onboarding.mark", params: { step: "password" } });
  }

  if (flags.emailStepDone) {
    actions.push({ action: "onboarding.mark", params: { step: "email" } });
  }

  for (const { action, params } of actions) {
    try {
      await shmFetch<any>(null, "v1/template/shpun_app", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: toFormUrlEncoded({
          session_id: sessionId,
          action,
          ...(params ?? {}),
        }),
        signal,
      });
    } catch {}
  }
}

/* ============================================================
   основная функция
============================================================ */

export async function passwordAuth(body: any): Promise<AuthResult> {
  let login = normalizeLogin(body?.login);
  let password = normalizePassword(body?.password);

  const client = normalizeClient(body?.client, login);
  const mode = normalizeMode(body?.mode);
  const partnerId = normalizePartnerId(body?.partner_id);
  const clientIp = normalizeClientIp(body?.client_ip);

  if (!login) {
    return { ok: false, status: 400, error: "login_required" };
  }

  if (mode !== "telegram_register" && !password) {
    return { ok: false, status: 400, error: "password_required" };
  }

  if (mode === "register") {
    if (isTelegramStyleLogin(login)) {
      return {
        ok: false,
        status: 400,
        error: "telegram_login_not_allowed_in_regular_register",
      };
    }

    const emailCheck = await validateRegistrationEmail(login);
    if (!emailCheck.ok) {
      return {
        ok: false,
        status: 400,
        error: emailCheck.code || "email_invalid",
      };
    }

    login = emailCheck.normalized;
  }

  if (mode === "telegram_register") {
    if (!isTelegramRegisterLogin(login)) {
      return { ok: false, status: 400, error: "telegram_login_invalid" };
    }

    const tgId = login.slice(1);
    password = generateTelegramPassword(tgId);
  }

  try {
    return await withTimeout(15000, async (signal) => {
      if (mode === "register") {
        const reg = await shmRegister(
          login,
          password,
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
        if (!auth.ok || !auth.shmSessionId) return auth;

        const sessionId = auth.shmSessionId;

        await Promise.allSettled([
          client ? shmSetClientName(sessionId, client, signal) : Promise.resolve(),
          shmSetLogin2(sessionId, login, signal),
          shmSetEmail(sessionId, login, signal),
        ]);

        await markShpunAppFlags(
          sessionId,
          { passwordSet: true, emailStepDone: true },
          signal
        );

        return auth;
      }

      if (mode === "telegram_register") {
        const reg = await shmRegister(
          login,
          password,
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
        if (!auth.ok || !auth.shmSessionId) return auth;

        const sessionId = auth.shmSessionId;

        await Promise.allSettled([
          client ? shmSetClientName(sessionId, client, signal) : Promise.resolve(),
        ]);

        return auth;
      }

      return await shmLogin(login, password, clientIp, signal);
    });
  } catch (e: unknown) {
    return {
      ok: false,
      status: 502,
      error:
        mode === "register" || mode === "telegram_register"
          ? "shm_register_exception"
          : "shm_auth_exception",
      detail: toErrorDetail(e),
    };
  }
}