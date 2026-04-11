// api/src/modules/auth/providers/password.ts

import type { AuthResult } from "../authService.js";
import { shmFetch, toFormUrlEncoded } from "../../../shared/shm/shmClient.js";
import { validateRegistrationEmail } from "../../../shared/utils/email.js";

type Mode = "login" | "register";

// ─── нормализация входных данных ─────────────────────────────────────────────

function normalizeLogin(v: unknown): string { return String(v ?? "").trim(); }
function normalizePassword(v: unknown): string { return String(v ?? "").trim(); }
function normalizeClient(v: unknown, fallback: string): string {
  const s = String(v ?? "").trim(); return s || fallback;
}
function normalizeMode(v: unknown): Mode {
  return String(v ?? "").trim().toLowerCase() === "register" ? "register" : "login";
}
function normalizePartnerId(v: unknown): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}
function normalizeClientIp(v: unknown): string { return String(v ?? "").trim(); }

function buildIpHeaders(ip?: string): Record<string, string> | undefined {
  const s = String(ip ?? "").trim();
  if (!s) return undefined;
  return { "X-Real-IP": s, "X-Forwarded-For": s };
}

function toErrorDetail(e: unknown): string {
  const a = e as any;
  return a?.name === "AbortError" ? "timeout" : String(a?.message ?? "network_error");
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); } finally { clearTimeout(t); }
}

// ─── SHM операции ─────────────────────────────────────────────────────────────

/**
 * PUT /v1/user — регистрация нового пользователя.
 * login1 = email. Пользователь может входить по нему сразу.
 */
async function shmRegister(
  login: string, password: string, partnerId: number,
  clientIp: string, signal: AbortSignal
): Promise<{ ok: true } | { ok: false; status: number; detail: unknown }> {
  const body: Record<string, any> = { login, password };
  if (partnerId > 0) body.partner_id = partnerId;

  const r = await shmFetch<any>(null, "v1/user", {
    method: "PUT", headers: buildIpHeaders(clientIp), body, signal,
  });

  return r.ok ? { ok: true } : { ok: false, status: r.status || 400, detail: r.json ?? r.text };
}

/**
 * POST /v1/user/auth — получаем session_id + user_id.
 */
async function shmLogin(
  login: string, password: string, clientIp: string, signal: AbortSignal
): Promise<AuthResult> {
  const r = await shmFetch<any>(null, "v1/user/auth", {
    method: "POST", headers: buildIpHeaders(clientIp), body: { login, password }, signal,
  });

  if (!r.ok) {
    return { ok: false, status: r.status || 401, error: "invalid_credentials", detail: r.json ?? r.text };
  }

  const sessionId = String((r.json as any)?.session_id ?? (r.json as any)?.id ?? "").trim();
  if (!sessionId) {
    return { ok: false, status: 502, error: "shm_auth_invalid_response", detail: r.json ?? r.text };
  }

  // Получаем user_id сразу — routes.ts не будет делать лишний запрос к SHM
  let shmUserId = 0;
  try {
    const meR = await shmFetch<any>(sessionId, "v1/user", {
      method: "GET", query: { limit: 1, offset: 0 }, signal,
    });
    if (meR.ok) {
      const row = Array.isArray((meR.json as any)?.data)
        ? (meR.json as any).data[0]
        : (meR.json as any)?.data ?? {};
      shmUserId = Number(row?.user_id ?? row?.id ?? 0) || 0;
    }
  } catch { /* не критично — routes.ts подхватит через fallback */ }

  return { ok: true, shmSessionId: sessionId, shmUserId: shmUserId || undefined, login };
}

/**
 * POST /v1/user { full_name } — отображаемое имя пользователя.
 */
async function shmSetClientName(sessionId: string, client: string, signal: AbortSignal) {
  if (!client) return;
  await shmFetch(sessionId, "v1/user", { method: "POST", body: { full_name: client }, signal });
}

/**
 * POST /v1/user { login2: email } — email становится вторым логином для входа.
 */
async function shmSetLogin2(sessionId: string, email: string, signal: AbortSignal) {
  await shmFetch(sessionId, "v1/user", { method: "POST", body: { login2: email }, signal });
}

/**
 * PUT /v1/user/email { email } — биллинг фиксирует email в settings пользователя
 * (поля settings.email и settings.email_verified).
 */
async function shmSetEmail(sessionId: string, email: string, signal: AbortSignal) {
  await shmFetch(sessionId, "v1/user/email", { method: "PUT", body: { email }, signal });
}

/**
 * Фиксируем флаги онбординга в ShpynApp через shpun_app template.
 * ВАЖНО: шаблон v9_6 переехал — теперь пароль = onboarding.step_password (не auth.password_set).
 * password.mark_set по-прежнему работает (совместимость), но дополнительно помечаем step_password.
 * best-effort: не прокидываем ошибки наружу.
 */
async function markShpunAppFlags(
  sessionId: string,
  flags: { passwordSet?: boolean; emailStepDone?: boolean },
  signal: AbortSignal
) {
  const actions: Array<{ action: string; params?: Record<string, any> }> = [];

  if (flags.passwordSet) {
    // Помечаем оба поля для совместимости с миграцией в шаблоне:
    // password.mark_set → auth.password_set = 1 (старое поле, мигрирует в step_password)
    // onboarding.mark step=password → onboarding.step_password = 1 (новое поле)
    actions.push({ action: "password.mark_set" });
    actions.push({ action: "onboarding.mark", params: { step: "password" } });
  }

  if (flags.emailStepDone) {
    // onboarding.mark step=email → onboarding.step_email = 1
    actions.push({ action: "onboarding.mark", params: { step: "email" } });
  }

  for (const { action, params } of actions) {
    try {
      await shmFetch<any>(null, "v1/template/shpun_app", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: toFormUrlEncoded({ session_id: sessionId, action, ...(params ?? {}) }),
        signal,
      });
    } catch { /* best-effort */ }
  }
}

// ─── основная функция ─────────────────────────────────────────────────────────

export async function passwordAuth(body: any): Promise<AuthResult> {
  let login = normalizeLogin(body?.login);
  const password = normalizePassword(body?.password);
  const client = normalizeClient(body?.client, login);
  const mode = normalizeMode(body?.mode);
  const partnerId = normalizePartnerId(body?.partner_id);
  const clientIp = normalizeClientIp(body?.client_ip);

  if (!login || !password) {
    return { ok: false, status: 400, error: "login_and_password_required" };
  }
  if (password.length < 8) {
    return { ok: false, status: 400, error: "password_too_short" };
  }

  // При регистрации login = email — валидируем
  if (mode === "register") {
    const emailCheck = await validateRegistrationEmail(login);
    if (!emailCheck.ok) {
      return { ok: false, status: 400, error: emailCheck.code || "email_invalid" };
    }
    login = emailCheck.normalized;
  }

  try {
    return await withTimeout(15_000, async (signal) => {

      if (mode === "register") {
        // ── 1. Создаём пользователя (login1 = email) ──────────────────────────
        const reg = await shmRegister(login, password, partnerId, clientIp, signal);
        if (!reg.ok) {
          return { ok: false, status: reg.status, error: "shm_register_failed", detail: reg.detail };
        }

        // ── 2. Логинимся — получаем session_id + user_id ──────────────────────
        const auth = await shmLogin(login, password, clientIp, signal);
        if (!auth.ok || !auth.shmSessionId) return auth;

        const sessionId = auth.shmSessionId;

        // ── 3. Параллельно: имя + login2 + email в биллинге ───────────────────
        // login2 = email → второй логин для входа
        // PUT /v1/user/email → биллинг пишет settings.email + settings.email_verified
        await Promise.allSettled([
          client ? shmSetClientName(sessionId, client, signal) : Promise.resolve(),
          shmSetLogin2(sessionId, login, signal),
          shmSetEmail(sessionId, login, signal),
        ]);

        // ── 4. Фиксируем оба флага в ShpynApp ────────────────────────────────
        // Пароль: password.mark_set + onboarding.mark step=password
        // Email:  onboarding.mark step=email
        // Оба = 1 сразу → FirstLoginOnboardingModal не покажется
        await markShpunAppFlags(sessionId, { passwordSet: true, emailStepDone: true }, signal);

        return auth;
      }

      // ── Режим login: просто входим ───────────────────────────────────────────
      return await shmLogin(login, password, clientIp, signal);
    });
  } catch (e: unknown) {
    return {
      ok: false,
      status: 502,
      error: mode === "register" ? "shm_register_exception" : "shm_auth_exception",
      detail: toErrorDetail(e),
    };
  }
}