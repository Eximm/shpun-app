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

/* ─── helpers ───────────────────────────────────────────────────────────── */

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
  return String(msg || "").toLowerCase().includes("already in use");
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

async function readCurrentEmail(sessionId: string) {
  const r = await shmFetch<any>(sessionId, "v1/user/email", {
    method: "GET",
    query: { limit: 1, offset: 0 },
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
  } catch {}
}

/* ─── routes ────────────────────────────────────────────────────────────── */

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
      return reply.code(502).send({ ok: false, error: "me_failed" });
    }

    const meRaw = meResult.meRaw;
    const { email, emailVerified } =
      emailRes.status === "fulfilled" ? emailRes.value : { email: null, emailVerified: null };

    const tg = tgRes.status === "fulfilled" ? tgRes.value : null;
    const adminRaw = adminRes.status === "fulfilled" ? adminRes.value : null;
    const admin = adminRaw?.ok ? parseAdminStatus(adminRaw) : { role: null, isAdmin: false };

    return reply.send({
      ok: true,
      profile: {
        id: toNum(meRaw.user_id),
        displayName: toDisplayName(meRaw),
        login: meRaw.login ?? null,
        login2: meRaw.login2 ?? null,
        fullName: meRaw.full_name ?? null,
        phone: meRaw.phone ?? null,
        email,
        emailVerified,
        created: meResult.me.created ?? null,
        lastLogin: meResult.me.lastLogin ?? null,
        role: admin.role,
        isAdmin: admin.isAdmin,
      },
      admin,
      telegram: tg,
    });
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

  // PUT /user/email — ТОЛЬКО email (login2 НЕ трогаем)
  app.put("/user/email", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const email = normalizeEmail((req.body as any)?.email);
    if (!email) return reply.code(400).send({ ok: false, error: "empty_email" });
    if (!isValidEmail(email)) return reply.code(400).send({ ok: false, error: "invalid_email" });

    const emailRes = await shmSetUserEmail(s.shmSessionId, email);
    const emailMsg = extractShmMessage(emailRes.json);

    if (!emailRes.ok) {
      return reply.code(isAlreadyInUseMessage(emailMsg) ? 409 : emailRes.status || 502).send({
        ok: false,
        error: isAlreadyInUseMessage(emailMsg) ? "email_already_used" : "shm_email_set_failed",
        message: emailMsg || null,
      });
    }

    if (isAlreadyInUseMessage(emailMsg)) {
      return reply.code(409).send({
        ok: false,
        error: "email_already_used",
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

  // POST /user/email/send-code
  app.post("/user/email/send-code", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const current = await readCurrentEmail(s.shmSessionId);

    if (!current.email) {
      return reply.code(400).send({ ok: false, error: "no_email_set" });
    }

    const r = await shmFetch<any>(s.shmSessionId, "v1/user/email/verify", {
      method: "POST",
      body: { email: current.email },
    });

    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "shm_send_code_failed" });
    }

    return reply.send({ ok: true });
  });

  // POST /user/email/confirm
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
      return reply.code(400).send({ ok: false, error: "invalid_code" });
    }

    return reply.send({ ok: true });
  });
}