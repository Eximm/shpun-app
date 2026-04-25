// api/src/modules/user/routes.ts

import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { fetchMe } from "./me.js";
import {
  shmDeleteUserEmail,
  shmFetch,
  shmRequestUserEmailVerify,
  shmSetUserEmail,
  shmShpunAppAdminStatus,
  toFormUrlEncoded,
} from "../../shared/shm/shmClient.js";

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

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
    method: "GET", query: { limit: 1, offset: 0 },
  });
  if (!r.ok) throw new Error("shm_email_get_failed");
  return {
    email: extractEmailFromPayload(r.json),
    emailVerified: extractEmailVerifiedFromPayload(r.json),
  };
}

async function shmSetLogin2(sessionId: string, email: string) {
  await shmFetch(sessionId, "v1/user", { method: "POST", body: { login2: email } });
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

// ─── routes ──────────────────────────────────────────────────────────────────

export async function userRoutes(app: FastifyInstance) {

  // GET /me
  app.get("/me", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const [meRes, emailRes, tgRes, adminRes] = await Promise.allSettled([
      fetchMe(s.shmSessionId),
      readCurrentEmail(s.shmSessionId).catch(() => ({ email: null, emailVerified: null })),
      fetchTelegramUser(s.shmSessionId),
      shmShpunAppAdminStatus(s.shmSessionId),
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

    const telegram = tg ? {
      login:    tg.login    ?? null,
      username: tg.username ?? null,
      chatId:   tg.chat_id  ?? null,
      status:   tg?.ShpynSDNSystem?.status ?? null,
    } : null;

    const payload: any = {
      ok: true,
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
      shm: { status: 200 },
    };

    if (process.env.NODE_ENV !== "production") {
      payload.meRaw = meRaw;
    }

    return reply.send(payload);
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

    const r = await shmFetch<any>(s.shmSessionId, "v1/user", {
      method: "POST",
      body: {
        ...(full_name ? { full_name } : {}),
        ...(phone     ? { phone     } : {}),
      },
    });

    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false, error: "shm_update_failed", shm: { status: r.status }, text: r.text,
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
  app.put("/user/email", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const email = normalizeEmail((req.body as any)?.email);
    if (!email)               return reply.code(400).send({ ok: false, error: "empty_email" });
    if (!isValidEmail(email)) return reply.code(400).send({ ok: false, error: "invalid_email" });

    const r = await shmSetUserEmail(s.shmSessionId, email);
    const shmMsg = extractShmMessage(r.json);

    if (!r.ok) {
      return reply.code(isAlreadyInUseMessage(shmMsg) ? 409 : r.status || 502).send({
        ok: false,
        error: isAlreadyInUseMessage(shmMsg) ? "email_already_used" : "shm_email_set_failed",
        message: shmMsg || null,
        shm: { status: r.status },
      });
    }

    if (isAlreadyInUseMessage(shmMsg)) {
      return reply.code(409).send({ ok: false, error: "email_already_used", message: shmMsg });
    }

    await Promise.allSettled([
      shmSetLogin2(s.shmSessionId, email),
      markOnboardingStep(s.shmSessionId, "email"),
    ]);

    try {
      const current = await readCurrentEmail(s.shmSessionId);
      if (current.email !== email) {
        return reply.code(409).send({ ok: false, error: "email_not_saved" });
      }
      return reply.send({ ok: true, email: current.email, emailVerified: current.emailVerified ?? false });
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

    const r = await shmDeleteUserEmail(s.shmSessionId);
    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false, error: "shm_email_delete_failed", shm: { status: r.status }, text: r.text,
      });
    }

    return reply.send({ ok: true });
  });

  // POST /user/email/verify — оставляем как был (legacy, не используется фронтом напрямую)
  app.post("/user/email/verify", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const r = await shmRequestUserEmailVerify(s.shmSessionId, (req.body as any) ?? {});
    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false, error: "shm_email_verify_failed", shm: { status: r.status }, text: r.text,
      });
    }

    return reply.send({ ok: true, result: r.json ?? null });
  });

  // POST /user/email/send-code — отправить письмо с кодом верификации
  // Вызывает POST /shm/v1/user/email — биллинг шлёт письмо с кодом
  app.post("/user/email/send-code", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const current = await readCurrentEmail(s.shmSessionId).catch(() => ({ email: null, emailVerified: null }));

    if (!current.email) {
      return reply.code(400).send({ ok: false, error: "no_email_set" });
    }
    if (current.emailVerified === true) {
      return reply.code(400).send({ ok: false, error: "email_already_verified" });
    }

    const r = await shmFetch<any>(s.shmSessionId, "v1/user/email/verify", {
      method: "POST",
      body: { email: current.email },
    });

    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false, error: "shm_send_code_failed", shm: { status: r.status },
      });
    }

    return reply.send({ ok: true });
  });

  // POST /user/email/confirm — подтвердить email кодом из письма
  // Принимает { code }. Вызывает POST /shm/v1/user/email/verify.
  app.post("/user/email/confirm", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const code = String((req.body as any)?.code ?? "").trim();
    if (!code) {
      return reply.code(400).send({ ok: false, error: "code_required" });
    }

    const r = await shmFetch<any>(s.shmSessionId, "v1/user/email/verify", {
      method: "POST",
      body: { code },
    });

    if (!r.ok) {
      return reply.code(r.status === 400 ? 400 : 502).send({
        ok: false,
        error: r.status === 400 ? "invalid_code" : "shm_confirm_failed",
        shm: { status: r.status },
      });
    }

    return reply.send({ ok: true });
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
}