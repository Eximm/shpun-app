import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { fetchMe } from "./me.js";
import {
  shmDeleteUserEmail,
  shmFetch,
  shmRequestUserEmailVerify,
  shmSetUserEmail,
  shmShpunAppAdminStatus,
  shmShpunAppStatus,
} from "../../shared/shm/shmClient.js";

function toDisplayName(me: any): string {
  const fullName = String(me?.full_name ?? "").trim();
  const login = String(me?.login ?? "").trim();
  const id = me?.user_id;
  return fullName || login || (id ? `User #${id}` : "User");
}

function toNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function parseAdminStatus(v: any) {
  const json = v?.json ?? {};
  const role = String(json?.role ?? "").trim();
  const isAdminRaw = json?.is_admin;
  const isAdmin =
    isAdminRaw === 1 ||
    isAdminRaw === "1" ||
    isAdminRaw === true ||
    role.toLowerCase() === "admin";

  return {
    role: role || null,
    isAdmin,
  };
}

async function fetchTelegramUser(sessionId: string) {
  const r = await shmFetch<any>(sessionId, "v1/telegram/user", { method: "GET" });
  if (!r.ok) return null;
  return r.json ?? null;
}

function normalizeEmail(input: any): string {
  return String(input ?? "").trim().toLowerCase();
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function extractEmailFromAnyPayload(payload: any): string | null {
  const candidates = [
    payload?.email,
    payload?.data?.email,
    payload?.data?.[0]?.email,
    payload?.data?.[0]?.login2,
    payload?.data?.[0]?.login,
  ];

  for (const v of candidates) {
    const s = String(v ?? "").trim().toLowerCase();
    if (!s) continue;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return s;
  }

  return null;
}

function extractEmailVerifiedFromAnyPayload(payload: any): boolean | null {
  const candidates = [
    payload?.email_verified,
    payload?.emailVerified,
    payload?.data?.email_verified,
    payload?.data?.emailVerified,
    payload?.data?.[0]?.email_verified,
    payload?.data?.[0]?.emailVerified,
  ];

  for (const v of candidates) {
    if (v === undefined || v === null || v === "") continue;
    return v === 1 || v === "1" || v === true;
  }

  return null;
}

function extractShmMessage(payload: any): string {
  const candidates = [
    payload?.msg,
    payload?.message,
    payload?.error,
    payload?.data?.msg,
    payload?.data?.message,
    payload?.data?.error,
    payload?.data?.[0]?.msg,
    payload?.data?.[0]?.message,
    payload?.data?.[0]?.error,
  ];

  for (const v of candidates) {
    const s = String(v ?? "").trim();
    if (s) return s;
  }

  return "";
}

function isAlreadyInUseMessage(msg: string): boolean {
  const s = String(msg || "").trim().toLowerCase();
  return s.includes("already in use");
}

async function readCurrentEmail(sessionId: string): Promise<{
  email: string | null;
  emailVerified: boolean | null;
}> {
  const r = await shmFetch<any>(sessionId, "v1/user/email", {
    method: "GET",
    query: { limit: 1, offset: 0 },
  });

  if (!r.ok) {
    throw new Error("shm_email_get_failed");
  }

  return {
    email: extractEmailFromAnyPayload(r.json),
    emailVerified: extractEmailVerifiedFromAnyPayload(r.json),
  };
}

async function readEmailStepDone(sessionId: string): Promise<boolean> {
  const r = await shmShpunAppStatus(sessionId);
  if (!r.ok) {
    throw new Error("shm_status_failed");
  }

  const raw = (r.json as any)?.data?.onboarding?.step_email;
  return raw === 1 || raw === "1" || raw === true;
}

export async function userRoutes(app: FastifyInstance) {
  app.get("/me", async (req, reply) => {
    const s = getSessionFromRequest(req);

    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const meRes = await fetchMe(s.shmSessionId);

    if (!meRes.ok) {
      return reply.code(meRes.status || 502).send({
        ok: false,
        error: meRes.error,
        shm: meRes.shm,
      });
    }

    const meRaw = meRes.meRaw;

    let email: string | null = null;
    let emailVerified: boolean | null = null;
    let emailStepDone = false;

    try {
      const currentEmail = await readCurrentEmail(s.shmSessionId);
      email = currentEmail.email;
      emailVerified = currentEmail.emailVerified;
    } catch {
      // ignore
    }

    try {
      emailStepDone = await readEmailStepDone(s.shmSessionId);
    } catch {
      // ignore
    }

    const tg = await fetchTelegramUser(s.shmSessionId);
    const telegram = tg
      ? {
          login: tg.login ?? null,
          username: tg.username ?? null,
          chatId: tg.chat_id ?? null,
          status: tg?.ShpynSDNSystem?.status ?? null,
        }
      : null;

    const adminRes = await shmShpunAppAdminStatus(s.shmSessionId);
    const admin = adminRes.ok
      ? parseAdminStatus(adminRes)
      : { role: null as string | null, isAdmin: false };

    const userId = toNum(meRaw.user_id, 0);
    const balance = toNum(meRaw.balance, 0);
    const bonus = toNum(meRaw.bonus, 0);
    const discount = toNum(meRaw.discount, 0);
    const referralsCount = toNum(meRaw.referrals_count, 0);

    const payload: any = {
      ok: true,
      profile: {
        id: userId,
        displayName: toDisplayName(meRaw),
        login: meRaw.login ?? null,
        fullName: meRaw.full_name ?? null,
        phone: meRaw.phone ?? null,
        passwordSet: !!meRes.me.passwordSet,
        email,
        emailVerified,
        emailStepDone,
        created: meRes.me.created ?? null,
        lastLogin: meRes.me.lastLogin ?? null,
        role: admin.role,
        isAdmin: admin.isAdmin,
      },

      admin,
      telegram,
      balance: { amount: balance, currency: "RUB" },
      bonus,
      discount,
      referralsCount,
      shm: { status: 200 },
    };

    if (process.env.NODE_ENV !== "production") {
      payload.meRaw = meRaw;
    }

    return reply.send(payload);
  });

  app.post("/user/profile", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const full_name = String((req.body as any)?.full_name ?? "").trim();
    const phone = String((req.body as any)?.phone ?? "").trim();

    if (!full_name && !phone) {
      return reply.code(400).send({ ok: false, error: "empty_update" });
    }

    const r = await shmFetch<any>(s.shmSessionId, "v1/user", {
      method: "POST",
      body: {
        ...(full_name ? { full_name } : {}),
        ...(phone ? { phone } : {}),
      },
    });

    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: "shm_update_failed",
        shm: { status: r.status },
        text: r.text,
      });
    }

    return reply.send({ ok: true });
  });

  app.get("/user/email", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    try {
      const current = await readCurrentEmail(s.shmSessionId);
      return reply.send({
        ok: true,
        email: current.email,
        emailVerified: current.emailVerified,
      });
    } catch {
      return reply.code(502).send({
        ok: false,
        error: "shm_email_get_failed",
      });
    }
  });

  app.put("/user/email", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const email = normalizeEmail((req.body as any)?.email);
    if (!email) {
      return reply.code(400).send({ ok: false, error: "empty_email" });
    }
    if (!isValidEmail(email)) {
      return reply.code(400).send({ ok: false, error: "invalid_email" });
    }

    const r = await shmSetUserEmail(s.shmSessionId, email);
    const shmMsg = extractShmMessage(r.json);

    if (!r.ok) {
      return reply.code(isAlreadyInUseMessage(shmMsg) ? 409 : r.status || 502).send({
        ok: false,
        error: isAlreadyInUseMessage(shmMsg) ? "email_already_used" : "shm_email_set_failed",
        message: shmMsg || null,
        shm: { status: r.status },
        text: r.text,
      });
    }

    if (isAlreadyInUseMessage(shmMsg)) {
      return reply.code(409).send({
        ok: false,
        error: "email_already_used",
        message: shmMsg,
      });
    }

    try {
      const current = await readCurrentEmail(s.shmSessionId);

      if (current.email !== email) {
        return reply.code(409).send({
          ok: false,
          error: "email_not_saved",
        });
      }

      return reply.send({
        ok: true,
        email: current.email,
        emailVerified:
          typeof current.emailVerified === "boolean" ? current.emailVerified : false,
      });
    } catch {
      return reply.code(502).send({
        ok: false,
        error: "email_save_check_failed",
      });
    }
  });

  app.delete("/user/email", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const r = await shmDeleteUserEmail(s.shmSessionId);
    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: "shm_email_delete_failed",
        shm: { status: r.status },
        text: r.text,
      });
    }

    return reply.send({ ok: true });
  });

  app.post("/user/email/verify", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const r = await shmRequestUserEmailVerify(s.shmSessionId, (req.body as any) ?? {});
    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: "shm_email_verify_failed",
        shm: { status: r.status },
        text: r.text,
      });
    }

    return reply.send({ ok: true, result: r.json ?? null });
  });

  app.post("/user/telegram", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const login = String((req.body as any)?.login ?? "")
      .trim()
      .replace(/^@/, "");

    if (!login) {
      return reply.code(400).send({ ok: false, error: "empty_login" });
    }

    const r = await shmFetch<any>(s.shmSessionId, "v1/telegram/user", {
      method: "POST",
      body: { login },
    });

    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: "shm_telegram_failed",
        shm: { status: r.status },
        text: r.text,
      });
    }

    return reply.send({ ok: true, telegram: r.json ?? null });
  });
}