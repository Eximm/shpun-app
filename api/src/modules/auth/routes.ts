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
  toFormUrlEncoded,
} from "../../shared/shm/shmClient.js";

/* ============================================================
   Helpers
============================================================ */

function isAuthDebug(): boolean {
  const v = String(process.env.AUTH_DEBUG ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function maskValue(v: unknown, max = 6): string {
  const s = String(v ?? "");
  if (!s) return "";
  if (s.length <= max) return `${s[0]}…`;
  return `${s.slice(0, max)}…(${s.length})`;
}

function safeKeys(obj: any): string[] {
  if (!obj || typeof obj !== "object") return [];
  try {
    return Object.keys(obj).sort();
  } catch {
    return [];
  }
}

function dbg(req: any, label: string, extra?: Record<string, any>) {
  if (!isAuthDebug()) return;

  const host = String(req?.headers?.host ?? req?.hostname ?? "").trim();
  const xfProto = String(req?.headers?.["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  const xfFor = String(req?.headers?.["x-forwarded-for"] ?? "")
    .split(",")[0]
    .trim();
  const ua = String(req?.headers?.["user-agent"] ?? "").slice(0, 120);

  const cookieHdr = String(req?.headers?.cookie ?? "");
  const hasSid = /(?:^|;\s*)sid=/.test(cookieHdr);

  const payload = {
    label,
    host,
    xfProto: xfProto || undefined,
    xfFor: xfFor || undefined,
    ip: String(req?.ip ?? ""),
    hasSidCookie: hasSid,
    ua,
    ...(extra ?? {}),
  };

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: "debug", time: Date.now(), auth: payload }));
}

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
  const isProd =
    String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";

  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isProd ? true : isHttps(req),
    path: "/",
    maxAge: Number(process.env.SID_COOKIE_MAX_AGE_SEC || 365 * 24 * 60 * 60),
  };
}

function isProbablyEmptyTelegramWidgetPayload(p: any): boolean {
  if (!p || typeof p !== "object") return true;
  const keys = Object.keys(p);
  if (keys.length === 0) return true;

  const hasHash = typeof p.hash === "string" && p.hash.trim().length > 0;
  const hasAuthDate =
    typeof p.auth_date === "string" || typeof p.auth_date === "number";
  const hasId = typeof p.id === "string" || typeof p.id === "number";

  return !(hasHash && hasAuthDate && hasId);
}

function mapShmAuthErrorStatus(st: number): number {
  if (st === 400) return 400;
  if (st === 401) return 401;
  if (st === 403) return 403;
  return 502;
}

/**
 * Telegram MiniApp initData is querystring-like string.
 * We only need user.id and user.username.
 */
function parseTelegramInitDataUser(initData: string): { tgId?: string; tgLogin?: string } {
  try {
    const qs = new URLSearchParams(String(initData ?? "").trim());
    const userRaw = qs.get("user");
    if (!userRaw) return {};
    const u = JSON.parse(userRaw);
    const tgId = u?.id != null ? String(u.id) : undefined;
    const tgLogin =
      u?.username != null ? String(u.username) : (u?.first_name != null ? String(u.first_name) : undefined);
    return { tgId, tgLogin };
  } catch {
    return {};
  }
}

/**
 * Keep only fields needed for re-auth via widget (and for linking info).
 * Telegram widget payload is signed; SHM validates signature.
 */
function pickTelegramWidgetPayload(p: any): Record<string, any> {
  const src = (p && typeof p === "object") ? p : {};
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

/**
 * IMPORTANT:
 * For SHM template we send application/x-www-form-urlencoded,
 * because TT2 reads request.params reliably in that mode.
 */
async function callShmTemplate(
  sessionId: string,
  action: string,
  extraParams?: Record<string, any>
): Promise<void> {
  const flat: Record<string, any> = {
    session_id: sessionId,
    action,
    ...(extraParams ?? {}),
  };

  const r = await shmFetch<any>(null, "v1/template/shpun_app", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: toFormUrlEncoded(flat),
  });

  if (!r.ok) throw new Error(`shm_template_failed:${r.status}`);
}

async function getPasswordSetFlag(shmSessionId: string): Promise<0 | 1> {
  try {
    const r = await shmFetch<any>(null, "v1/template/shpun_app", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: toFormUrlEncoded({ session_id: shmSessionId, action: "status" }),
    });

    const v = (r.json as any)?.data?.auth?.password_set;
    return v === 1 || v === "1" ? 1 : 0;
  } catch {
    return 1;
  }
}

/* ============================================================
   Routes
============================================================ */

export async function authRoutes(app: FastifyInstance) {
  app.post("/auth/telegram", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const initData = String(body.initData ?? "").trim();

    if (!initData) {
      return reply.code(400).send({ ok: false, error: "init_data_required" });
    }

    dbg(req, "tg_webapp_auth:incoming", { initDataLen: initData.length });

    const rr = await shmTelegramWebAppAuth(initData);

    dbg(req, "tg_webapp_auth:shm_result", {
      shmOk: rr.ok,
      shmStatus: rr.status,
      shmSessionId: maskValue(rr.json?.session_id),
    });

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
      return reply.code(502).send({ ok: false, error: "shm_user_lookup_failed" });
    }

    const localSid = createLocalSid();
    putSession(localSid, {
      shmSessionId,
      shmUserId,
      createdAt: Date.now(),
      telegramInitData: initData,
    });

    try {
      const { tgId, tgLogin } = parseTelegramInitDataUser(initData);
      await callShmTemplate(shmSessionId, "auth.telegram", {
        telegram_id: tgId ?? "",
        telegram_login: tgLogin ?? "",
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

  app.post("/auth/telegram_widget", async (req, reply) => {
    const body = (req.body ?? {}) as any;

    if (isProbablyEmptyTelegramWidgetPayload(body)) {
      return reply.code(400).send({ ok: false, error: "missing_telegram_payload" });
    }

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
      return reply.code(502).send({ ok: false, error: "shm_user_lookup_failed" });
    }

    const localSid = createLocalSid();
    putSession(localSid, {
      shmSessionId,
      shmUserId,
      createdAt: Date.now(),
      telegramWidgetPayload: pickTelegramWidgetPayload(body),
    });

    try {
      await callShmTemplate(shmSessionId, "auth.telegram", {
        telegram_id: body?.id != null ? String(body.id) : "",
        telegram_login: body?.username != null ? String(body.username) : "",
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

  app.get("/auth/telegram_widget_redirect", async (req, reply) => {
    const payload = (req.query ?? {}) as any;

    if (isProbablyEmptyTelegramWidgetPayload(payload)) {
      return reply.redirect("/login?e=missing_telegram_payload");
    }

    const rr = await shmTelegramWebAuth(payload);
    if (!rr.ok) return reply.redirect("/login?e=tg_widget_failed");

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
    putSession(localSid, {
      shmSessionId,
      shmUserId,
      createdAt: Date.now(),
      telegramWidgetPayload: pickTelegramWidgetPayload(payload),
    });

    try {
      await callShmTemplate(shmSessionId, "auth.telegram", {
        telegram_id: payload?.id != null ? String(payload.id) : "",
        telegram_login: payload?.username != null ? String(payload.username) : "",
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

  app.post("/auth/password/set", async (req, reply) => {
    const password = String((req.body as any)?.password ?? "");
    const sid = String((req.cookies as any)?.sid ?? "").trim();
    let session: any = getSessionFromRequest(req) as any;

    const r = await setPassword(req, password);
    if (!r.ok) return reply.code(r.status || 400).send(r);

    // re-auth after password change:
    try {
      if (sid) {
        const initData = String(session?.telegramInitData ?? "").trim();

        if (initData) {
          const rr = await shmTelegramWebAppAuth(initData);
          const newShmSessionId = String(rr.json?.session_id ?? "").trim();
          if (newShmSessionId) {
            const ident = await shmGetUserIdentity(newShmSessionId);
            const updated = {
              ...session,
              shmSessionId: newShmSessionId,
              shmUserId: ident.userId,
              createdAt: session?.createdAt || Date.now(),
            };
            putSession(sid, updated);
            session = updated;
          }
        } else if (session?.telegramWidgetPayload) {
          const rr = await shmTelegramWebAuth(session.telegramWidgetPayload);
          const newShmSessionId = String(rr.json?.session_id ?? "").trim();
          if (newShmSessionId) {
            const ident = await shmGetUserIdentity(newShmSessionId);
            const updated = {
              ...session,
              shmSessionId: newShmSessionId,
              shmUserId: ident.userId,
              createdAt: session?.createdAt || Date.now(),
            };
            putSession(sid, updated);
            session = updated;
          }
        }
      }
    } catch {}

    // mark password_set only if we still have shmSessionId
    try {
      const shmSessionId = String(session?.shmSessionId ?? "").trim();
      if (shmSessionId) await callShmTemplate(shmSessionId, "password.mark_set");
    } catch {}

    return reply.send({ ok: true, password_set: 1 });
  });

  app.get("/auth/status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    return reply.send({
      ok: true,
      authenticated: !!s?.shmSessionId,
      user_id: s?.shmUserId ?? null,
    });
  });

  app.post("/logout", async (req, reply) => {
    const sid = (req.cookies as any)?.sid as string | undefined;
    deleteSession(sid);
    return reply.clearCookie("sid", { path: "/" }).send({ ok: true });
  });
}
