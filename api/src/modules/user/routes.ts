// api/src/modules/user/routes.ts

import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { fetchMe } from "./me.js";
import {
  shmDeleteUserEmail,
  shmGetUserAccounts,
  shmFetch,
  shmRequestUserEmailVerify,
  shmSetUserEmail,
  shmShpunAppAdminStatus,
  shmShpunAppReferralBonusDismiss,
  shmShpunAppReferralBonusStatus,
  shmTelegramWebAuthBind,
  toFormUrlEncoded,
} from "../../shared/shm/shmClient.js";
import {
  validateRegistrationEmail,
  validateRegistrationEmailBasic,
} from "../../shared/utils/email.js";
import { recordSupportNotifyRecipient } from "../support/notifyRepo.js";

// ─── helpers ─────────────────────────────────────────────────────────────────

function toDisplayName(me: any): string {
  const fullName = String(me?.full_name ?? "").trim();
  const login    = String(me?.login    ?? "").trim();
  const id = me?.user_id;
  return fullName || login || (id ? `User #${id}` : "User");
}

function toNum(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeEmail(input: any): string {
  return String(input ?? "").trim().toLowerCase();
}

function extractEmailFromPayload(payload: any): string | null {
  const candidates = [
    payload?.email,
    payload?.data?.email,
    payload?.data?.[0]?.email,
    payload?.data?.[0]?.login2,
  ];
  for (const v of candidates) {
    const s = String(v ?? "").trim().toLowerCase();
    if (s && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s;
  }
  return null;
}

function extractEmailVerifiedFromPayload(payload: any): boolean | null {
  const candidates = [
    payload?.email_verified,
    payload?.data?.email_verified,
    payload?.data?.[0]?.email_verified,
  ];
  for (const v of candidates) {
    if (v === undefined || v === null || v === "") continue;
    return v === 1 || v === "1" || v === true;
  }
  return null;
}

function extractShmMessage(payload: any): string {
  const candidates = [
    payload?.msg, payload?.message, payload?.error,
    payload?.data?.msg, payload?.data?.message,
    payload?.data?.[0]?.msg, payload?.data?.[0]?.message,
  ];
  for (const v of candidates) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }
  return "";
}

function extractTelegramIdFromWidgetPayload(payload: any): string {
  const raw = payload?.id ?? payload?.user?.id;
  const id = String(raw ?? "").trim();
  return /^\d+$/.test(id) ? id : "";
}

function extractTelegramIdFromShmTelegram(payload: any): string {
  const candidates = [
    payload?.user_id,
    payload?.telegram?.user_id,
    payload?.data?.user_id,
    payload?.data?.telegram?.user_id,
    payload?.data?.[0]?.user_id,
  ];
  for (const v of candidates) {
    const id = String(v ?? "").trim();
    if (/^\d+$/.test(id)) return id;
  }
  return "";
}

function isAlreadyBoundTelegramMessage(msg: string): boolean {
  const s = String(msg || "").trim().toLowerCase();
  return s.includes("already bound");
}

function getClientIp(req: any): string {
  return (
    String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() ||
    String(req.headers["x-real-ip"] ?? "").trim() ||
    String(req.ip ?? "")
  );
}

function isProbablyEmptyTelegramWidgetPayload(p: any): boolean {
  if (!p || typeof p !== "object") return true;
  if (Object.keys(p).length === 0) return true;
  const hasHash = typeof p.hash === "string" && p.hash.trim().length > 0;
  const hasAuthDate =
    typeof p.auth_date === "string" || typeof p.auth_date === "number";
  const hasId = typeof p.id === "string" || typeof p.id === "number";
  return !(hasHash && hasAuthDate && hasId);
}

function pickTelegramWidgetPayload(p: any): Record<string, any> {
  const src = p && typeof p === "object" ? p : {};
  const out: Record<string, any> = {};
  if (src.id != null) out.id = src.id;
  if (src.auth_date != null) out.auth_date = src.auth_date;
  if (src.hash != null) out.hash = src.hash;
  if (src.username != null) out.username = src.username;
  if (src.first_name != null) out.first_name = src.first_name;
  if (src.last_name != null) out.last_name = src.last_name;
  if (src.photo_url != null) out.photo_url = src.photo_url;
  return out;
}

function isAlreadyInUseMessage(msg: string): boolean {
  return String(msg || "").trim().toLowerCase().includes("already in use");
}

function parseAdminStatus(v: any) {
  const json = v?.json ?? {};
  const role = String(json?.role ?? "").trim();
  const isAdminRaw = json?.is_admin;
  const isAdmin =
    isAdminRaw === 1 || isAdminRaw === "1" || isAdminRaw === true ||
    role.toLowerCase() === "admin";
  return { role: role || null, isAdmin };
}

async function fetchTelegramUser(sessionId: string) {
  const r = await shmFetch<any>(sessionId, "v1/telegram/user", { method: "GET" });
  if (!r.ok) return null;
  return r.json ?? null;
}

async function readCurrentEmail(sessionId: string): Promise<{
  email: string | null;
  emailVerified: boolean | null;
}> {
  const r = await shmFetch<any>(sessionId, "v1/user/email", {
    method: "GET",
  });
  if (!r.ok) throw new Error("shm_email_get_failed");
  return {
    email: extractEmailFromPayload(r.json),
    emailVerified: extractEmailVerifiedFromPayload(r.json),
  };
}

async function markOnboardingStep(sessionId: string, step: string) {
  try {
    await shmFetch<any>(null, "v1/template/shpun_app", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: toFormUrlEncoded({ session_id: sessionId, action: "onboarding.mark", step }),
    });
  } catch { /* best-effort */ }
}

async function callShpunAppAction(
  sessionId: string,
  action: string,
  params?: Record<string, any>
) {
  return await shmFetch<any>(null, "v1/template/shpun_app", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: toFormUrlEncoded({ session_id: sessionId, action, ...(params ?? {}) }),
  });
}

// ─── routes ──────────────────────────────────────────────────────────────────

export async function userRoutes(app: FastifyInstance) {
  // GET /me
  app.get("/me", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const [meRes, emailRes, tgRes, adminRes, referralBonusRes] = await Promise.allSettled([
      fetchMe(s.shmSessionId),
      readCurrentEmail(s.shmSessionId).catch(() => ({ email: null, emailVerified: null })),
      fetchTelegramUser(s.shmSessionId),
      shmShpunAppAdminStatus(s.shmSessionId),
      shmShpunAppReferralBonusStatus(s.shmSessionId),
    ]);

    const meResult = meRes.status === "fulfilled" ? meRes.value : null;
    if (!meResult?.ok) {
      const err = meResult ?? { status: 502, error: "me_failed", shm: null };
      return reply.code((err as any).status || 502).send({
        ok: false, error: (err as any).error, shm: (err as any).shm,
      });
    }

    const meRaw = meResult.meRaw;
    const { email, emailVerified } =
      emailRes.status === "fulfilled" ? emailRes.value : { email: null, emailVerified: null };
    const tg        = tgRes.status === "fulfilled" ? tgRes.value : null;
    const adminRaw  = adminRes.status === "fulfilled" ? adminRes.value : null;
    const admin     = adminRaw?.ok ? parseAdminStatus(adminRaw) : { role: null as string | null, isAdmin: false };
    if (admin.isAdmin) {
      // Existing billing/auth logic confirmed admin access. Remember the user
      // only as a delivery recipient for in-app support notifications
      // (delivery-only registry, never an authorization source).
      try { recordSupportNotifyRecipient(toNum(meRaw.user_id, 0)); } catch { /* best-effort */ }
    }
    const referralBonusRaw = referralBonusRes.status === "fulfilled"
      ? (referralBonusRes.value as any)?.json
      : null;

    const telegram = tg ? {
      login:    tg.login    ?? null,
      username: tg.username ?? null,
      chatId:   tg.chat_id  ?? null,
      status:   tg?.ShpynSDNSystem?.status ?? null,
    } : null;

    const payload: any = {
      ok: true,
      authSessionId: String((s as any)?.createdAt ?? ""),
      profile: {
        id:          toNum(meRaw.user_id, 0),
        displayName: toDisplayName(meRaw),
        login:       meRaw.login  ?? null,
        login2:      meRaw.login2 ?? null,
        fullName:    meRaw.full_name ?? null,
        phone:       meRaw.phone ?? null,
        passwordStepDone: meResult.me.passwordStepDone,
        emailStepDone:    meResult.me.emailStepDone,
        email,
        emailVerified,
        created:   meResult.me.created   ?? null,
        lastLogin: meResult.me.lastLogin ?? null,
        role:      admin.role,
        isAdmin:   admin.isAdmin,
      },
      admin,
      telegram,
      balance:       { amount: toNum(meRaw.balance, 0), currency: "RUB" },
      bonus:         toNum(meRaw.bonus, 0),
      discount:      toNum(meRaw.discount, 0),
      referralsCount: toNum(meRaw.referrals_count, 0),
      referralBonus: {
        pending: Boolean(referralBonusRaw?.pending),
        percent: toNum(referralBonusRaw?.percent, 0),
        campaign: String(referralBonusRaw?.campaign ?? ""),
        bannerSeen: Boolean(referralBonusRaw?.banner_seen),
      },
      shm: { status: 200 },
    };

    if (process.env.NODE_ENV !== "production") {
      payload.meRaw = meRaw;
    }

    return reply.send(payload);
  });

  app.post("/user/referral-bonus/dismiss", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }
    const result = await shmShpunAppReferralBonusDismiss(s.shmSessionId);
    if (!result.ok || !(result.json as any)?.ok) {
      return reply.code(502).send({ ok: false, error: "bonus_banner_not_saved" });
    }
    return reply.send({ ok: true });
  });

  // POST /user/profile
  app.post("/user/profile", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const full_name = String((req.body as any)?.full_name ?? "").trim();
    const phone     = String((req.body as any)?.phone     ?? "").trim();

    if (!full_name && !phone) {
      return reply.code(400).send({ ok: false, error: "empty_update" });
    }
    if (full_name.length > 64) {
      return reply.code(400).send({ ok: false, error: "full_name_too_long" });
    }
    if (phone.length > 16) {
      return reply.code(400).send({ ok: false, error: "phone_too_long" });
    }

    let r = await shmFetch<any>(s.shmSessionId, "v1/user", {
      method: "POST",
      body: {
        ...(full_name ? { full_name } : {}),
        ...(phone     ? { phone     } : {}),
      },
    });

    // SHM 3.x removed POST /user. Keep the direct request for the current
    // SHM 2.x deployment and fall back to our update-safe billing template.
    if (!r.ok && (r.status === 404 || r.status === 405)) {
      r = await callShpunAppAction(s.shmSessionId, "profile.set", {
        ...(full_name ? { full_name } : {}),
        ...(phone ? { phone } : {}),
      });
    }

    if (!r.ok || (r.json && (r.json as any).ok === 0)) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: (r.json as any)?.error || "shm_update_failed",
        shm: { status: r.status },
        text: r.text,
      });
    }

    return reply.send({ ok: true });
  });

  // GET /user/email
  app.get("/user/email", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    try {
      const current = await readCurrentEmail(s.shmSessionId);
      return reply.send({ ok: true, ...current });
    } catch {
      return reply.code(502).send({ ok: false, error: "shm_email_get_failed" });
    }
  });

  // PUT /user/email
  // Меняем пользовательский email только в настройках пользователя SHM.
  // login2 не трогаем: он не должен использоваться как email-поле.
  // Успех возвращаем только если email реально сохранился.
  app.put("/user/email", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const email = normalizeEmail((req.body as any)?.email);
    if (!email) return reply.code(400).send({ ok: false, error: "empty_email" });

    const emailCheck = await validateRegistrationEmail(email);
    if (!emailCheck.ok) {
      return reply.code(400).send({
        ok: false,
        error: emailCheck.code || "invalid_email",
      });
    }

    const emailRes = await shmSetUserEmail(s.shmSessionId, email);
    const emailMsg = extractShmMessage(emailRes.json);

    if (!emailRes.ok) {
      return reply.code(isAlreadyInUseMessage(emailMsg) ? 409 : emailRes.status || 502).send({
        ok: false,
        error: isAlreadyInUseMessage(emailMsg) ? "email_already_used" : "shm_email_set_failed",
        message: emailMsg || null,
        shm: { status: emailRes.status },
      });
    }

    if (isAlreadyInUseMessage(emailMsg)) {
      return reply.code(409).send({
        ok: false,
        error: "email_already_used",
        message: emailMsg,
      });
    }

    try {
      const current = await readCurrentEmail(s.shmSessionId);

      if (current.email !== email) {
        return reply.code(409).send({ ok: false, error: "email_not_saved" });
      }

      void markOnboardingStep(s.shmSessionId, "email");

      return reply.send({
        ok: true,
        email: current.email,
        emailVerified: current.emailVerified ?? false,
      });
    } catch {
      return reply.code(502).send({ ok: false, error: "email_save_check_failed" });
    }
  });

  // DELETE /user/email
  app.delete("/user/email", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const current = await readCurrentEmail(s.shmSessionId).catch(() => ({ email: null }));
    if (!current.email) {
      return reply.code(400).send({ ok: false, error: "no_email_set" });
    }

    const r = await shmDeleteUserEmail(s.shmSessionId, current.email);
    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false, error: "shm_email_delete_failed", shm: { status: r.status }, text: r.text,
      });
    }

    return reply.send({ ok: true });
  });

  // GET /user/accounts — SHM 3.x linked login methods. On SHM 2.x this is a
  // capability-safe empty response so the same ShpunApp build can be deployed first.
  app.get("/user/accounts", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const r = await shmGetUserAccounts(s.shmSessionId);
    if (!r.ok && r.status === 404) {
      return reply.send({ ok: true, supported: false, accounts: [] });
    }
    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: "shm_accounts_failed",
        shm: { status: r.status },
      });
    }

    const rows = Array.isArray((r.json as any)?.data) ? (r.json as any).data : [];
    const accounts = rows.map((item: any) => ({
      login: String(item?.login ?? ""),
      type: String(item?.type ?? ""),
      primary: Boolean(item?.primary),
    })).filter((item: any) => item.login && item.type);

    return reply.send({ ok: true, supported: true, accounts });
  });

  // POST /user/email/verify — оставляем как был (legacy, не используется фронтом напрямую)
  app.post("/user/email/verify", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const payload = (req.body as any) ?? {};
    const requestedEmail = normalizeEmail(payload?.email);
    const current = requestedEmail
      ? { email: requestedEmail }
      : await readCurrentEmail(s.shmSessionId).catch(() => ({ email: null }));
    const emailCheck = validateRegistrationEmailBasic(current.email);
    if (!emailCheck.ok) {
      return reply.code(400).send({
        ok: false,
        error: emailCheck.code || "invalid_email",
      });
    }

    const r = await shmRequestUserEmailVerify(s.shmSessionId, {
      ...payload,
      email: current.email,
    });
    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false, error: "shm_email_verify_failed", shm: { status: r.status }, text: r.text,
      });
    }

    return reply.send({ ok: true, result: r.json ?? null });
  });

  // POST /user/email/send-code — отправить письмо с кодом верификации
  // POST /shm/v1/user/email поддерживается и SHM 2.x, и SHM 3.x.
  app.post("/user/email/send-code", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const current = await readCurrentEmail(s.shmSessionId).catch(() => ({ email: null, emailVerified: null }));

    if (!current.email) {
      return reply.code(400).send({ ok: false, error: "no_email_set" });
    }
    const emailCheck = validateRegistrationEmailBasic(current.email);
    if (!emailCheck.ok) {
      return reply.code(400).send({
        ok: false,
        error: emailCheck.code || "invalid_email",
      });
    }
    if (current.emailVerified === true) {
      return reply.code(400).send({ ok: false, error: "email_already_verified" });
    }

    const r = await shmRequestUserEmailVerify(s.shmSessionId, { email: current.email });

    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false, error: "shm_send_code_failed", shm: { status: r.status },
      });
    }

    return reply.send({ ok: true });
  });

  // POST /user/email/confirm — подтвердить email кодом из письма
  // Принимает { code }. SHM 3.x требует передать email вместе с кодом.
  app.post("/user/email/confirm", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const code = String((req.body as any)?.code ?? "").trim();
    if (!code) {
      return reply.code(400).send({ ok: false, error: "code_required" });
    }

    const storedEmail = await readCurrentEmail(s.shmSessionId).catch(() => ({
      email: null,
      emailVerified: null,
    }));
    const emailCheck = validateRegistrationEmailBasic(storedEmail.email);
    if (!emailCheck.ok) {
      return reply.code(400).send({
        ok: false,
        error: emailCheck.code || "invalid_email",
      });
    }

    const r = await shmRequestUserEmailVerify(s.shmSessionId, {
      email: storedEmail.email,
      code,
    });

    if (!r.ok) {
      return reply.code(r.status === 400 ? 400 : 502).send({
        ok: false,
        error: r.status === 400 ? "invalid_code" : "shm_confirm_failed",
        shm: { status: r.status },
      });
    }

    const upstreamMessage = extractShmMessage(r.json).toLowerCase();
    if (upstreamMessage.includes("invalid") || upstreamMessage.includes("expired") || upstreamMessage.includes("required")) {
      return reply.code(400).send({ ok: false, error: "invalid_code" });
    }

    // SHM may answer HTTP 200 even when the operation did not change the
    // account. Never report success until the persisted billing state says so.
    let current: Awaited<ReturnType<typeof readCurrentEmail>> | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      current = await readCurrentEmail(s.shmSessionId).catch(() => null);
      if (current?.emailVerified === true) break;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 120));
    }

    if (current?.emailVerified !== true) {
      return reply.code(409).send({ ok: false, error: "email_not_verified" });
    }

    return reply.send({ ok: true, email: current.email, emailVerified: true });
  });

  // POST /user/prefs
  app.post("/user/prefs", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const body = (req.body as any) ?? {};
    const allowed = ["locale", "tz", "dark_mode", "push_enabled"];
    const params: Record<string, any> = {};
    for (const k of allowed) {
      if (body[k] !== undefined) params[k] = body[k];
    }

    if (Object.keys(params).length === 0) {
      return reply.code(400).send({ ok: false, error: "empty_prefs" });
    }

    try {
      await shmFetch<any>(null, "v1/template/shpun_app", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: toFormUrlEncoded({ session_id: s.shmSessionId, action: "prefs.set", ...params }),
      });
      return reply.send({ ok: true });
    } catch (e: any) {
      return reply.code(502).send({
        ok: false, error: "shm_prefs_set_failed", detail: String(e?.message ?? e),
      });
    }
  });

  // POST /user/telegram
  app.post("/user/telegram", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const login = String((req.body as any)?.login ?? "").trim().replace(/^@/, "");
    if (!login) return reply.code(400).send({ ok: false, error: "empty_login" });

    const r = await shmFetch<any>(s.shmSessionId, "v1/telegram/user", {
      method: "POST", body: { login },
    });

    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false, error: "shm_telegram_failed", shm: { status: r.status }, text: r.text,
      });
    }

    return reply.send({ ok: true, telegram: r.json ?? null });
  });

  // POST /user/telegram/bind-widget
  // Реальная привязка Telegram Login Widget к текущему пользователю SHM.
  // После неё SHM сможет находить пользователя в /telegram/webapp/auth.
  app.post("/user/telegram/bind-widget", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const body = (req.body ?? {}) as any;
    if (isProbablyEmptyTelegramWidgetPayload(body)) {
      return reply.code(400).send({ ok: false, error: "missing_telegram_payload" });
    }

    let uid = Number((s as any)?.shmUserId ?? 0) || 0;
    if (!uid) {
      try {
        const me = await fetchMe(s.shmSessionId);
        uid = Number((me as any)?.meRaw?.user_id ?? 0) || 0;
      } catch {
        uid = 0;
      }
    }
    if (!uid) {
      return reply.code(502).send({ ok: false, error: "shm_user_lookup_failed" });
    }

    // Capability probe before the mutation: SHM 3.x has /user/accounts,
    // SHM 2.x answers 404 and still expects the legacy uid argument.
    const accountsCapability = await shmGetUserAccounts(s.shmSessionId);
    if (!accountsCapability.ok && accountsCapability.status !== 404) {
      return reply.code(accountsCapability.status || 502).send({
        ok: false,
        error: "telegram_accounts_check_failed",
        shm: { status: accountsCapability.status },
      });
    }
    const usesAccountsApi = accountsCapability.ok;

    const r = await shmTelegramWebAuthBind(
      s.shmSessionId,
      uid,
      pickTelegramWidgetPayload(body),
      getClientIp(req),
      { accountsApi: usesAccountsApi }
    );

    const msg = extractShmMessage(r.json);
    const apiError = String((r.json as any)?.error ?? "").trim();
    const alreadyBound = isAlreadyBoundTelegramMessage(apiError || msg);
    const telegramId = extractTelegramIdFromWidgetPayload(body);

    if ((!r.ok || apiError) && !alreadyBound) {
      return reply.code(r.status === 400 ? 400 : r.status === 409 ? 409 : r.status || 502).send({
        ok: false,
        error: apiError || msg || "shm_telegram_bind_failed",
        message: msg || null,
        details: msg || String(r.text ?? "").slice(0, 300) || null,
        detail: r.json ?? r.text ?? null,
        shm: { status: r.status },
      });
    }

    if (!telegramId) {
      return reply.code(400).send({ ok: false, error: "telegram_id_missing" });
    }

    if (alreadyBound) {
      const currentTg = await fetchTelegramUser(s.shmSessionId);
      const currentTgId = extractTelegramIdFromShmTelegram(currentTg);
      if (currentTgId && currentTgId !== telegramId) {
        return reply.code(409).send({
          ok: false,
          error: "telegram_already_bound_to_another_account",
          message: "Telegram account is already connected to another profile.",
        });
      }
    }

    // SHM 3.x создаёт account(type=telegram) штатно при bind_to_profile.
    // В SHM 2.x /user/accounts отсутствует, поэтому только там сохраняем
    // прежний login2 через billing-template.
    const accountsRes = usesAccountsApi
      ? await shmGetUserAccounts(s.shmSessionId)
      : accountsCapability;
    const accounts = Array.isArray((accountsRes.json as any)?.data)
      ? (accountsRes.json as any).data
      : [];
    const nativeTelegramBound = accountsRes.ok && accounts.some((account: any) =>
      String(account?.type ?? "").toLowerCase() === "telegram" &&
      String(account?.login ?? "").replace(/^@/, "") === telegramId
    );

    if (accountsRes.ok && !nativeTelegramBound) {
      return reply.code(502).send({
        ok: false,
        error: "telegram_account_not_persisted",
        details: "SHM accepted the bind but did not create a telegram account.",
      });
    }

    if (!accountsRes.ok && accountsRes.status !== 404) {
      return reply.code(accountsRes.status || 502).send({
        ok: false,
        error: "telegram_accounts_check_failed",
        shm: { status: accountsRes.status },
      });
    }

    if (!accountsRes.ok) {
      const login2Res = await callShpunAppAction(s.shmSessionId, "auth.telegram", {
        telegram_id: telegramId,
        telegram_login: String(body?.username ?? "").trim(),
      });
      const login2Msg = extractShmMessage(login2Res.json);
      const login2ApiError = String((login2Res.json as any)?.error ?? "").trim();
      if (!login2Res.ok || login2ApiError) {
        return reply.code(login2Res.status === 409 ? 409 : login2Res.status || 502).send({
          ok: false,
          error: login2ApiError || login2Msg || "telegram_login_bind_failed",
          message: login2Msg || null,
          details: "telegram_login_is_already_used_or_rejected",
          shm: { status: login2Res.status },
        });
      }
    }

    const tg = await fetchTelegramUser(s.shmSessionId);
    return reply.send({ ok: true, telegram: tg ?? null, result: r.json ?? null });
  });
}
