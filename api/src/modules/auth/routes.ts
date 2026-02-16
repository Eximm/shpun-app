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

async function shmGetUserIdentity(sessionId: string): Promise<{
  userId: number;
  login: string;
}> {
  const res = await shmFetch<any>(sessionId, "v1/user", {
    method: "GET",
    query: { limit: 1, offset: 0 },
  });

  if (!res.ok) {
    throw new Error(`shm_user_failed:${res.status}`);
  }

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

function getRequestIp(req: any): string {
  return String(req.headers?.["x-real-ip"] ?? req.ip ?? "").trim();
}

function isHttps(req: any): boolean {
  const xf = String(req.headers?.["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (xf) return xf === "https";
  const proto = String((req as any).protocol ?? "").toLowerCase();
  return proto === "https";
}

function cookieOptions(req: any) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isHttps(req),
    path: "/",
    maxAge: Number(process.env.SID_COOKIE_MAX_AGE_SEC || 365 * 24 * 60 * 60),

    // ВАЖНО:
    // domain НЕ задаём — cookie должна быть host-only,
    // потому что у нас 2 разных домена (app.shpyn.online и app.sdnonline.online).
  };
}

function isProbablyEmptyTelegramWidgetPayload(p: any): boolean {
  if (!p || typeof p !== "object") return true;
  const keys = Object.keys(p);
  if (keys.length === 0) return true;

  const hasHash = typeof p.hash === "string" && p.hash.trim().length > 0;
  const hasAuthDate = typeof p.auth_date === "string" || typeof p.auth_date === "number";
  const hasId = typeof p.id === "string" || typeof p.id === "number";

  return !(hasHash && hasAuthDate && hasId);
}

function mapShmAuthErrorStatus(st: number): number {
  // SHM вернул “плохие данные/не авторизован” — не превращаем в 502
  if (st === 400) return 400;
  if (st === 401) return 401;
  if (st === 403) return 403;

  // Остальное считаем проблемой апстрима/сети
  return 502;
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
    const initData = String(body.initData ?? "").trim();

    if (!initData) {
      return reply.code(400).send({ ok: false, error: "init_data_required" });
    }

    // shmTelegramWebAppAuth возвращает ShmResult<{session_id?:string}>
    const rr = await shmTelegramWebAppAuth(initData);

    if (!rr.ok) {
      return reply.code(mapShmAuthErrorStatus(rr.status || 502)).send({
        ok: false,
        error: "shm_telegram_auth_failed",
      });
    }

    const shmSessionId = String(rr.json?.session_id ?? "").trim();
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
      return reply.code(502).send({
        ok: false,
        error: "shm_user_lookup_failed",
      });
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
        ua: String(req.headers["user-agent"] ?? ""),
      });
    } catch {}

    const ps = await getPasswordSetFlag(shmSessionId);
    const next: "set_password" | "home" = ps === 1 ? "home" : "set_password";

    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .send({ ok: true, user_id: shmUserId, login, next });
  });

  /* ===============================
     2) Telegram Login Widget (WEB)
     POST — оставляем (может быть полезно)
  =============================== */
  app.post("/auth/telegram_widget", async (req, reply) => {
    const body = (req.body ?? {}) as any;

    // Пустой/непохожий payload — это 400, а не 502
    if (isProbablyEmptyTelegramWidgetPayload(body)) {
      return reply.code(400).send({ ok: false, error: "missing_telegram_payload" });
    }

    // shmTelegramWebAuth возвращает ShmResult<{session_id?:string}>
    const rr = await shmTelegramWebAuth(body);

    if (!rr.ok) {
      return reply.code(mapShmAuthErrorStatus(rr.status || 502)).send({
        ok: false,
        error: "shm_telegram_widget_auth_failed",
      });
    }

    const shmSessionId = String(rr.json?.session_id ?? "").trim();
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
      return reply.code(502).send({
        ok: false,
        error: "shm_user_lookup_failed",
      });
    }

    const localSid = createLocalSid();
    putSession(localSid, {
      shmSessionId,
      shmUserId,
      createdAt: Date.now(),
    });

    // фиксация входа через Telegram (best-effort)
    try {
      await callShmTemplate(shmSessionId, "auth.telegram", {
        ip: getRequestIp(req),
        ua: String(req.headers["user-agent"] ?? ""),
      });
    } catch {}

    const ps = await getPasswordSetFlag(shmSessionId);
    const next: "set_password" | "home" = ps === 1 ? "home" : "set_password";

    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .send({ ok: true, user_id: shmUserId, login, next });
  });

  /* ===============================
     2b) Telegram Login Widget (WEB)
     GET redirect-flow — КАНОН для браузера
     (решает “мигнуло и всё”)
  =============================== */
  app.get("/auth/telegram_widget_redirect", async (req, reply) => {
    const payload = (req.query ?? {}) as any;

    if (isProbablyEmptyTelegramWidgetPayload(payload)) {
      return reply.redirect("/login?e=missing_telegram_payload");
    }

    const rr = await shmTelegramWebAuth(payload);

    if (!rr.ok) {
      return reply.redirect("/login?e=tg_widget_failed");
    }

    const shmSessionId = String(rr.json?.session_id ?? "").trim();
    if (!shmSessionId) return reply.redirect("/login?e=no_shm_session");

    let shmUserId = 0;
    let login = "";
    try {
      const ident = await shmGetUserIdentity(shmSessionId);
      shmUserId = ident.userId;
      login = ident.login;
    } catch {
      return reply.redirect("/login?e=user_lookup_failed");
    }

    const localSid = createLocalSid();
    putSession(localSid, { shmSessionId, shmUserId, createdAt: Date.now() });

    // фиксация входа через Telegram (best-effort)
    try {
      await callShmTemplate(shmSessionId, "auth.telegram", {
        ip: getRequestIp(req),
        ua: String(req.headers["user-agent"] ?? ""),
      });
    } catch {}

    const ps = await getPasswordSetFlag(shmSessionId);
    const next: "set_password" | "home" = ps === 1 ? "home" : "set_password";

    reply.setCookie("sid", localSid, cookieOptions(req));

    if (next === "set_password") return reply.redirect("/app/set-password");
    return reply.redirect("/app");
  });

  /* ===============================
     3) Password login / register
     (mode: "login" | "register")
  =============================== */
  app.post("/auth/password", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const modeRaw = String(body?.mode ?? "login").trim().toLowerCase();
    const mode = modeRaw === "register" ? "register" : "login";

    const result = await handleAuth("password", { ...body, mode });
    if (!result.ok) {
      return reply.code(result.status || 400).send(result);
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

    const r = await setPassword(req, password);
    if (!r.ok) return reply.code(r.status || 400).send(r);

    // re-auth for telegram sessions (SHM может инвалидировать session_id после смены пароля)
    try {
      const initData = String(session?.telegramInitData ?? "").trim();
      if (initData && sid) {
        const rr = await shmTelegramWebAppAuth(initData);
        const newShmSessionId = String(rr.json?.session_id ?? "").trim();
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
    return reply.clearCookie("sid", { path: "/" }).send({ ok: true });
  });
}
