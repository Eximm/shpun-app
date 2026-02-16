// api/src/modules/auth/routes.ts

import type { FastifyInstance } from "fastify";
import { setPassword } from "./password.js";
import { handleAuth } from "./authService.js";
import {
  createLocalSid,
  putSession,
  deleteSession,
  getSessionFromRequest,
} from "../../shared/session/sessionStore.js";
import {
  shmFetch,
  shmTelegramWebAppAuth,
  shmTelegramWebAuth,
} from "../../shared/shm/shmClient.js";

/* ============================================================
   Helpers
============================================================ */

function clampString(v: unknown, maxLen: number): string {
  const s = String(v ?? "");
  if (s.length > maxLen) return s.slice(0, maxLen);
  return s;
}

function getRequestIp(req: any): string {
  return String(req.headers?.["x-real-ip"] ?? req.ip ?? "").trim();
}

function firstHeaderValue(v: any): string {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.split(",")[0].trim();
}

function isHttps(req: any): boolean {
  const xf = firstHeaderValue(req.headers?.["x-forwarded-proto"]).toLowerCase();
  if (xf) return xf === "https";
  const proto = String((req as any).protocol ?? "").toLowerCase();
  return proto === "https";
}

function cookieDomain(): string | undefined {
  // ✅ Никаких хардкодов в коде.
  // В проде поставь SID_COOKIE_DOMAIN=app.sdnonline.online
  // В деве/локалхосте — не ставь вообще.
  const d = String(process.env.SID_COOKIE_DOMAIN ?? "").trim();
  return d || undefined;
}

function cookieMaxAgeSeconds(): number {
  return Number(process.env.SID_COOKIE_MAX_AGE_SEC || 365 * 24 * 60 * 60);
}

// единый набор опций и для setCookie, и для clearCookie
function cookieOptions(req: any) {
  const domain = cookieDomain();
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isHttps(req),
    path: "/",
    maxAge: cookieMaxAgeSeconds(),
    ...(domain ? { domain } : {}),
  };
}

function sanitizeProviderError(result: any) {
  // ✅ наружу отдаём только ok/error (+status через reply.code)
  // detail не прокидываем (чувствительное / шумное)
  const error = String(result?.error ?? "auth_failed");
  return { ok: false, error };
}

async function shmGetUserIdentity(sessionId: string): Promise<{
  userId: number;
  login: string;
}> {
  const res = await shmFetch<any>(sessionId, "v1/user", {
    method: "GET",
    query: { limit: 1, offset: 0 },
  });

  if (!res.ok) throw new Error(`shm_user_failed:${res.status}`);

  const j: any = res.json ?? {};
  const u = Array.isArray(j?.data) ? j.data[0] : j?.data ?? {};
  const userId = Number(u?.user_id ?? u?.id ?? 0) || 0;
  const login = String(u?.login ?? "").trim();

  if (!userId) throw new Error("shm_user_invalid_response");
  return { userId, login };
}

async function callShmTemplate(
  sessionId: string,
  action: string,
  extraData?: any
): Promise<void> {
  // best-effort: если шаблон временно отвалился — логин не ломаем
  const r = await shmFetch<any>(null, "v1/template/shpun_app", {
    method: "POST",
    body: {
      session_id: sessionId,
      action,
      ...(extraData ? { data: extraData } : {}),
    },
  });

  if (!r.ok) throw new Error(`shm_template_failed:${r.status}`);
}

async function getPasswordSetFlag(shmSessionId: string): Promise<0 | 1> {
  try {
    const r = await shmFetch<any>(null, "v1/template/shpun_app", {
      method: "POST",
      body: { session_id: shmSessionId, action: "status" },
    });

    const v = (r.json as any)?.data?.auth?.password_set;
    return v === 1 || v === "1" ? 1 : 0;
  } catch {
    // лучше считать установленным, чем гонять людей по кругу
    return 1;
  }
}

/* ============================================================
   Routes
============================================================ */

export async function authRoutes(app: FastifyInstance) {
  /* ===============================
     1) Telegram Mini App (initData)
  =============================== */
  app.post("/auth/telegram", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const initData = clampString(body.initData, 16_000).trim(); // ✅ защита по размеру

    if (!initData) {
      return reply.code(400).send({ ok: false, error: "init_data_required" });
    }

    let shmSessionId = "";
    try {
      const rr: any = await shmTelegramWebAppAuth(initData);
      shmSessionId = String(rr?.session_id ?? "").trim();
    } catch {
      return reply.code(502).send({ ok: false, error: "shm_telegram_auth_failed" });
    }

    if (!shmSessionId) {
      return reply.code(502).send({ ok: false, error: "no_shm_session" });
    }

    let shmUserId = 0;
    let login = "";
    try {
      const ident = await shmGetUserIdentity(shmSessionId);
      shmUserId = ident.userId;
      login = ident.login;
    } catch {
      return reply.code(502).send({ ok: false, error: "shm_user_lookup_failed" });
    }

    const localSid = createLocalSid();
    putSession(localSid, {
      shmSessionId,
      shmUserId,
      createdAt: Date.now(),
      telegramInitData: initData, // нужно для re-auth после смены пароля
    });

    // фиксация входа через Telegram (best-effort)
    try {
      await callShmTemplate(shmSessionId, "auth.telegram", {
        ip: getRequestIp(req),
        ua: clampString(req.headers["user-agent"], 512),
      });
    } catch {}

    const ps = await getPasswordSetFlag(shmSessionId);
    const next: "set_password" | "home" = ps === 1 ? "home" : "set_password";

    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .send({ ok: true, user_id: shmUserId, login, next });
  });

  /* ===============================
     2) Telegram Login Widget (Web)
  =============================== */
  app.post("/auth/telegram_widget", async (req, reply) => {
    const body = (req.body ?? {}) as any;

    // ✅ не даём прислать огромный JSON
    // (виджет маленький, это чисто защита от мусора/атаки)
    const safeBody = JSON.parse(
      JSON.stringify(body, (_k, v) => (typeof v === "string" ? clampString(v, 4096) : v))
    );

    let shmSessionId = "";
    try {
      const rr: any = await shmTelegramWebAuth(safeBody);
      shmSessionId = String(rr?.session_id ?? "").trim();
    } catch {
      return reply
        .code(502)
        .send({ ok: false, error: "shm_telegram_widget_auth_failed" });
    }

    if (!shmSessionId) {
      return reply.code(502).send({ ok: false, error: "no_shm_session" });
    }

    let shmUserId = 0;
    let login = "";
    try {
      const ident = await shmGetUserIdentity(shmSessionId);
      shmUserId = ident.userId;
      login = ident.login;
    } catch {
      return reply.code(502).send({ ok: false, error: "shm_user_lookup_failed" });
    }

    const localSid = createLocalSid();
    putSession(localSid, { shmSessionId, shmUserId, createdAt: Date.now() });

    try {
      await callShmTemplate(shmSessionId, "auth.telegram", {
        ip: getRequestIp(req),
        ua: clampString(req.headers["user-agent"], 512),
      });
    } catch {}

    const ps = await getPasswordSetFlag(shmSessionId);
    const next: "set_password" | "home" = ps === 1 ? "home" : "set_password";

    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .send({ ok: true, user_id: shmUserId, login, next });
  });

  /* ===============================
     3) Password login / register
     (mode: "login" | "register")
  =============================== */
  app.post("/auth/password", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const modeRaw = String(body?.mode ?? "login").trim().toLowerCase();
    const mode = modeRaw === "register" ? "register" : "login";

    const result: any = await handleAuth("password", { ...body, mode });
    if (!result.ok) {
      return reply.code(result.status || 400).send(sanitizeProviderError(result));
    }

    const shmSessionId = String(result.shmSessionId ?? "").trim();
    if (!shmSessionId) {
      return reply.code(502).send({ ok: false, error: "no_shm_session" });
    }

    let shmUserId = Number(result.shmUserId ?? 0) || 0;
    let login = String(result.login ?? "").trim();

    // если provider не вернул user/login — доберём из /v1/user
    if (!shmUserId || !login) {
      try {
        const ident = await shmGetUserIdentity(shmSessionId);
        shmUserId = shmUserId || ident.userId;
        login = login || ident.login;
      } catch {}
    }

    if (!shmUserId) {
      return reply.code(502).send({ ok: false, error: "shm_user_lookup_failed" });
    }

    const localSid = createLocalSid();
    putSession(localSid, { shmSessionId, shmUserId, createdAt: Date.now() });

    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .send({ ok: true, user_id: shmUserId, login, next: "home" });
  });

  /* ===============================
     4) Set password
     - best-effort: mark flag in SHM
     - important: re-auth for Telegram Mini App because SHM may rotate session_id
  =============================== */
  app.post("/auth/password/set", async (req, reply) => {
    const password = String((req.body as any)?.password ?? "");
    const sid = String((req.cookies as any)?.sid ?? "").trim();
    const session = getSessionFromRequest(req) as any;

    const r: any = await setPassword(req, password);
    if (!r.ok) {
      // здесь тоже не светим detail наружу
      return reply.code(r.status || 400).send({ ok: false, error: r.error || "set_password_failed" });
    }

    // re-auth for telegram sessions (SHM может инвалидировать session_id после смены пароля)
    try {
      const initData = String(session?.telegramInitData ?? "").trim();
      if (initData && sid) {
        const rr: any = await shmTelegramWebAppAuth(initData);
        const newShmSessionId = String(rr?.session_id ?? "").trim();
        if (newShmSessionId) {
          const ident = await shmGetUserIdentity(newShmSessionId);
          putSession(sid, {
            ...session,
            shmSessionId: newShmSessionId,
            shmUserId: ident.userId,
            createdAt: session?.createdAt || Date.now(),
          });
        }
      }
    } catch {}

    // mark password_set (best-effort)
    try {
      const s2 = getSessionFromRequest(req) as any;
      const shmSessionId = String(s2?.shmSessionId ?? "").trim();
      if (shmSessionId) await callShmTemplate(shmSessionId, "password.mark_set");
    } catch {}

    return reply.send({ ok: true, password_set: 1 });
  });

  /* ===============================
     5) Status
  =============================== */
  app.get("/auth/status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    return reply.send({
      ok: true,
      authenticated: !!s?.shmSessionId,
      user_id: s?.shmUserId ?? null,
    });
  });

  /* ===============================
     6) Logout
  =============================== */
  app.post("/logout", async (req, reply) => {
    const sid = (req.cookies as any)?.sid as string | undefined;
    deleteSession(sid);

    // ✅ важно: clearCookie теми же options (domain/secure/path), иначе не удалится
    return reply.clearCookie("sid", cookieOptions(req)).send({ ok: true });
  });
}
