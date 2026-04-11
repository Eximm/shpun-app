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
  const xfFor = String(req?.headers?.["x-forwarded-for"] ?? "")
    .split(",")[0]
    .trim();
  const ua = String(req?.headers?.["user-agent"] ?? "").slice(0, 120);
  const hasSid = /(?:^|;\s*)sid=/.test(String(req?.headers?.cookie ?? ""));
  console.log(
    JSON.stringify({
      level: "debug",
      time: Date.now(),
      auth: {
        label,
        host,
        xfFor: xfFor || undefined,
        ip: String(req?.ip ?? ""),
        hasSidCookie: hasSid,
        ua,
        ...(extra ?? {}),
      },
    })
  );
}

function readJsonBody(req: any): any {
  const b = (req as any)?.body;
  if (!b) return {};
  if (typeof b === "object") return b;
  if (typeof b === "string") {
    const s = b.trim();
    if (!s) return {};
    const looksJson =
      (s.startsWith("{") && s.endsWith("}")) ||
      (s.startsWith("[") && s.endsWith("]"));
    if (!looksJson) return {};
    try {
      const j = JSON.parse(s);
      return j && typeof j === "object" ? j : {};
    } catch {
      return {};
    }
  }
  return {};
}

async function shmGetUserIdentity(
  sessionId: string
): Promise<{ userId: number; login: string }> {
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

function isHttps(req: any): boolean {
  const xf = String(req.headers?.["x-forwarded-proto"] ?? "")
    .split(",")[0]
    .trim()
    .toLowerCase();
  if (xf) return xf === "https";
  return String((req as any).protocol ?? "").toLowerCase() === "https";
}

function cookieOptions(req: any) {
  const prod = String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
  return {
    httpOnly: true,
    sameSite: prod ? ("none" as const) : ("lax" as const),
    secure: prod ? true : isHttps(req),
    path: "/",
    maxAge: Number(process.env.SID_COOKIE_MAX_AGE_SEC || 365 * 24 * 60 * 60),
  };
}

function getSidFromCookieHeader(req: any): string {
  const hdr = String(req?.headers?.cookie ?? "");
  if (!hdr) return "";
  const m = hdr.match(/(?:^|;\s*)sid=([^;]+)/);
  if (!m) return "";
  try {
    return decodeURIComponent(m[1]).trim();
  } catch {
    return String(m[1]).trim();
  }
}

function reuseOrCreateSid(req: any): string {
  const parsed = String((req.cookies as any)?.sid ?? "").trim();
  const fromHdr = getSidFromCookieHeader(req);
  return (parsed || fromHdr).trim() || createLocalSid();
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

function mapShmAuthErrorStatus(st: number): number {
  if (st === 400) return 400;
  if (st === 401) return 401;
  if (st === 403) return 403;
  return 502;
}

function parseTelegramInitDataUser(
  initData: string
): { tgId?: string; tgLogin?: string } {
  const raw = String(initData ?? "").trim();
  if (!raw) return {};
  function tryParseUserJson(userRaw: string): any | null {
    let s = String(userRaw ?? "");
    for (let i = 0; i < 3; i++) {
      try {
        const obj = JSON.parse(s);
        return obj && typeof obj === "object" ? obj : null;
      } catch {
        try {
          const dec = decodeURIComponent(s);
          if (dec === s) break;
          s = dec;
        } catch {
          break;
        }
      }
    }
    return null;
  }
  try {
    const qs = new URLSearchParams(raw);
    const userRaw = qs.get("user");
    if (!userRaw) return {};
    const u = tryParseUserJson(userRaw);
    if (!u) return {};
    return {
      tgId: u?.id != null ? String(u.id) : undefined,
      tgLogin:
        u?.username != null
          ? String(u.username)
          : u?.first_name != null
            ? String(u.first_name)
            : undefined,
    };
  } catch {
    return {};
  }
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

async function callShmTemplate(
  sessionId: string,
  action: string,
  extraParams?: Record<string, any>
): Promise<void> {
  const r = await shmFetch<any>(null, "v1/template/shpun_app", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: toFormUrlEncoded({ session_id: sessionId, action, ...(extraParams ?? {}) }),
  });
  if (!r.ok) throw new Error(`shm_template_failed:${r.status}`);
}

async function tryAttachPartner(
  shmSessionId: string,
  partnerIdRaw: any
): Promise<void> {
  const partnerId = Number(partnerIdRaw ?? 0);
  if (!Number.isFinite(partnerId) || partnerId <= 0) return;
  try {
    await callShmTemplate(shmSessionId, "referrals.claim", {
      partner_id: Math.trunc(partnerId),
    });
  } catch {
    // ignore
  }
}

async function getPasswordSetFlag(shmSessionId: string): Promise<0 | 1> {
  try {
    const r = await shmFetch<any>(null, "v1/template/shpun_app", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: toFormUrlEncoded({ session_id: shmSessionId, action: "status" }),
    });
    const data = (r.json as any)?.data ?? {};
    const stepPassword = data?.onboarding?.step_password;
    const legacyPwSet = data?.auth?.password_set;
    const isSet =
      stepPassword === 1 ||
      stepPassword === "1" ||
      legacyPwSet === 1 ||
      legacyPwSet === "1";
    return isSet ? 1 : 0;
  } catch {
    return 1;
  }
}

/**
 * Помечаем step_password через шаблон.
 * Пробует sessionId который передан. Возвращает true если успешно.
 * best-effort — не бросает исключения.
 */
async function markPasswordStep(
  sessionId: string,
  label: string,
  req: any
): Promise<boolean> {
  if (!sessionId) return false;
  try {
    await callShmTemplate(sessionId, "password.mark_set");
    await callShmTemplate(sessionId, "onboarding.mark", { step: "password" });
    dbg(req, `password_set:mark_done:${label}`, {
      sessionId: maskValue(sessionId),
    });
    return true;
  } catch (e: any) {
    dbg(req, `password_set:mark_failed:${label}`, {
      error: String(e?.message ?? e),
      sessionId: maskValue(sessionId),
    });
    return false;
  }
}

function withAuthOk(url: string): string {
  try {
    const u = new URL(url, "http://local");
    u.searchParams.set("a", "auth_ok");
    u.searchParams.set("p", "tg");
    return u.pathname + u.search + u.hash;
  } catch {
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}a=auth_ok&p=tg`;
  }
}

function getClientIp(req: any): string {
  return (
    String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim() ||
    String(req.headers["x-real-ip"] ?? "").trim() ||
    String(req.ip ?? "")
  );
}

async function updateAuthMeta(
  shmSessionId: string,
  req: any,
  source: "telegram" | "widget" | "password"
): Promise<void> {
  try {
    await callShmTemplate(shmSessionId, "auth.meta.update", {
      last_login_at: Math.floor(Date.now() / 1000),
      last_login_ip: getClientIp(req),
      last_login_source: source,
    });
  } catch (e: any) {
    dbg(req, "auth_meta_update_failed", {
      source,
      error: String(e?.message ?? e),
      sessionId: maskValue(shmSessionId),
    });
  }
}

/* ============================================================
   Single-flight Telegram auth
============================================================ */

const tgWebAppAuthInFlight = new Map<string, Promise<any>>();
const tgWidgetAuthInFlight = new Map<string, Promise<any>>();

async function singleFlightTelegramWebAppAuth(initData: string, clientIp?: string) {
  const key = String(initData ?? "").trim();
  if (!key) return await shmTelegramWebAppAuth(key, clientIp);

  const existing = tgWebAppAuthInFlight.get(key);
  if (existing) return await existing;

  const p = shmTelegramWebAppAuth(key, clientIp).finally(() => {
    setTimeout(() => tgWebAppAuthInFlight.delete(key), 1000);
  });

  tgWebAppAuthInFlight.set(key, p);
  return await p;
}

async function singleFlightTelegramWidgetAuth(
  payload: Record<string, any>,
  clientIp?: string
) {
  const key = JSON.stringify(pickTelegramWidgetPayload(payload) ?? {});
  if (!key || key === "{}") return await shmTelegramWebAuth(payload, clientIp);

  const existing = tgWidgetAuthInFlight.get(key);
  if (existing) return await existing;

  const p = shmTelegramWebAuth(payload, clientIp).finally(() => {
    setTimeout(() => tgWidgetAuthInFlight.delete(key), 1000);
  });

  tgWidgetAuthInFlight.set(key, p);
  return await p;
}

/* ============================================================
   Routes
============================================================ */

export async function authRoutes(app: FastifyInstance) {
  // ── POST /auth/telegram ───────────────────────────────────────────────────
  app.post("/auth/telegram", async (req, reply) => {
    const body = readJsonBody(req);
    const initData = String(body.initData ?? "").trim();
    if (!initData) {
      return reply.code(400).send({ ok: false, error: "init_data_required" });
    }

    const rr = await singleFlightTelegramWebAppAuth(initData, getClientIp(req));
    if (!rr.ok) {
      return reply
        .code(mapShmAuthErrorStatus(rr.status || 502))
        .send({ ok: false, error: "shm_telegram_auth_failed" });
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

    try {
      await tryAttachPartner(shmSessionId, body?.partner_id);
    } catch {}

    const localSid = reuseOrCreateSid(req);
    putSession(localSid, {
      shmSessionId,
      shmUserId,
      login,
      createdAt: Date.now(),
      telegramInitData: initData,
    });

    try {
      const { tgId, tgLogin } = parseTelegramInitDataUser(initData);
      if (tgId) {
        await callShmTemplate(shmSessionId, "auth.telegram", {
          telegram_id: tgId,
          telegram_login: tgLogin ?? "",
        });
      }
    } catch {}

    await updateAuthMeta(shmSessionId, req, "telegram");

    const ps = await getPasswordSetFlag(shmSessionId);
    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .send({
        ok: true,
        user_id: shmUserId,
        login,
        next: ps === 1 ? "home" : "set_password",
      });
  });

  // ── POST /auth/telegram_widget ────────────────────────────────────────────
  app.post("/auth/telegram_widget", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    if (isProbablyEmptyTelegramWidgetPayload(body)) {
      return reply.code(400).send({ ok: false, error: "missing_telegram_payload" });
    }

    const rr = await singleFlightTelegramWidgetAuth(body, getClientIp(req));
    if (!rr.ok) {
      return reply
        .code(mapShmAuthErrorStatus(rr.status || 502))
        .send({ ok: false, error: "shm_telegram_widget_auth_failed" });
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

    try {
      await tryAttachPartner(shmSessionId, body?.partner_id);
    } catch {}

    const localSid = reuseOrCreateSid(req);
    putSession(localSid, {
      shmSessionId,
      shmUserId,
      login,
      createdAt: Date.now(),
      telegramWidgetPayload: pickTelegramWidgetPayload(body),
    });

    try {
      await callShmTemplate(shmSessionId, "auth.telegram", {
        telegram_id: body?.id != null ? String(body.id) : "",
        telegram_login: body?.username != null ? String(body.username) : "",
      });
    } catch {}

    await updateAuthMeta(shmSessionId, req, "widget");

    const ps = await getPasswordSetFlag(shmSessionId);
    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .send({
        ok: true,
        user_id: shmUserId,
        login,
        next: ps === 1 ? "home" : "set_password",
      });
  });

  // ── GET /auth/telegram_widget_redirect ───────────────────────────────────
  app.get("/auth/telegram_widget_redirect", async (req, reply) => {
    const payload = (req.query ?? {}) as any;
    if (isProbablyEmptyTelegramWidgetPayload(payload)) {
      return reply.redirect("/login?e=missing_telegram_payload");
    }

    const rr = await singleFlightTelegramWidgetAuth(payload, getClientIp(req));
    if (!rr.ok) {
      return reply.redirect("/login?e=tg_widget_failed");
    }

    const shmSessionId = String(rr.json?.session_id ?? "").trim();
    if (!shmSessionId) {
      return reply.redirect("/login?e=no_shm_session");
    }

    let shmUserId = 0;
    let login = "";
    try {
      const ident = await shmGetUserIdentity(shmSessionId);
      shmUserId = ident.userId;
      login = ident.login;
    } catch {
      return reply.redirect("/login?e=user_lookup_failed");
    }

    try {
      await tryAttachPartner(shmSessionId, (payload as any)?.partner_id);
    } catch {}

    const localSid = reuseOrCreateSid(req);
    putSession(localSid, {
      shmSessionId,
      shmUserId,
      login,
      createdAt: Date.now(),
      telegramWidgetPayload: pickTelegramWidgetPayload(payload),
    });

    try {
      await callShmTemplate(shmSessionId, "auth.telegram", {
        telegram_id: payload?.id != null ? String(payload.id) : "",
        telegram_login:
          payload?.username != null ? String(payload.username) : "",
      });
    } catch {}

    await updateAuthMeta(shmSessionId, req, "widget");

    reply.setCookie("sid", localSid, cookieOptions(req));
    const ps = await getPasswordSetFlag(shmSessionId);
    return ps === 1
      ? reply.redirect(withAuthOk("/login"))
      : reply.redirect(withAuthOk("/set-password"));
  });

  // ── POST /auth/password ───────────────────────────────────────────────────
  app.post("/auth/password", async (req, reply) => {
    const body = readJsonBody(req);
    const modeRaw = String(body?.mode ?? "login").trim().toLowerCase();
    const mode = modeRaw === "register" ? "register" : "login";

    const result = await handleAuth("password", {
      ...body,
      mode,
      client_ip: getClientIp(req),
    });
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

    const localSid = reuseOrCreateSid(req);
    putSession(localSid, { shmSessionId, shmUserId, login, createdAt: Date.now() });

    await updateAuthMeta(shmSessionId, req, "password");

    dbg(req, "password_auth:done", {
      userId: shmUserId,
      mode,
      sid: maskValue(localSid),
    });

    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .send({ ok: true, user_id: shmUserId, login, next: "home" });
  });

  // ── POST /auth/password/set ───────────────────────────────────────────────
  app.post("/auth/password/set", async (req, reply) => {
    const body = readJsonBody(req);
    const password = String(body?.password ?? "");
    const sid = String((req.cookies as any)?.sid ?? "").trim();
    const session = getSessionFromRequest(req) as any;
    const currentLogin = String(session?.login ?? "").trim();
    const oldSessionId = String(session?.shmSessionId ?? "").trim();

    const markedWithOld = await markPasswordStep(oldSessionId, "old_session", req);
    dbg(req, "password_set:pre_mark", {
      markedWithOld,
      oldSessionId: maskValue(oldSessionId),
    });

    const r = await setPassword(req, password);
    if (!r.ok) {
      return reply.code(r.status || 400).send(r);
    }

    let newSessionId = "";

    if (currentLogin && !currentLogin.startsWith("@")) {
      try {
        const loginResult = await handleAuth("password", {
          mode: "login",
          login: currentLogin,
          password,
          client_ip: getClientIp(req),
        });
        if (loginResult.ok) {
          const newSid = String(loginResult.shmSessionId ?? "").trim();
          if (newSid) {
            let newUid = Number(loginResult.shmUserId ?? 0) || 0;
            if (!newUid) {
              try {
                const ident = await shmGetUserIdentity(newSid);
                newUid = ident.userId;
              } catch {}
            }
            if (sid) {
              putSession(sid, {
                ...session,
                shmSessionId: newSid,
                shmUserId: newUid || session?.shmUserId,
                login: currentLogin,
                createdAt: session?.createdAt || Date.now(),
              });
            }
            newSessionId = newSid;
            dbg(req, "password_set:reauth_password_ok", {
              newSessionId: maskValue(newSid),
            });
          }
        }
      } catch (e: any) {
        dbg(req, "password_set:reauth_password_failed", {
          error: String(e?.message ?? e),
        });
      }
    }

    if (!newSessionId) {
      const hasTgWebApp = !!String(session?.telegramInitData ?? "").trim();
      const hasTgWidget = !!session?.telegramWidgetPayload;

      try {
        if (hasTgWebApp) {
          const rr = await singleFlightTelegramWebAppAuth(
            String(session.telegramInitData).trim(),
            getClientIp(req)
          );
          if (rr.ok) {
            const newSid = String(rr.json?.session_id ?? "").trim();
            if (newSid) {
              try {
                const ident = await shmGetUserIdentity(newSid);
                if (sid) {
                  putSession(sid, {
                    ...session,
                    shmSessionId: newSid,
                    shmUserId: ident.userId,
                    login: ident.login || currentLogin,
                    createdAt: session?.createdAt || Date.now(),
                  });
                }
              } catch {}
              newSessionId = newSid;
              dbg(req, "password_set:reauth_tg_webapp_ok", {
                newSessionId: maskValue(newSid),
              });
            }
          }
        } else if (hasTgWidget) {
          const rr = await singleFlightTelegramWidgetAuth(
            session.telegramWidgetPayload,
            getClientIp(req)
          );
          if (rr.ok) {
            const newSid = String(rr.json?.session_id ?? "").trim();
            if (newSid) {
              try {
                const ident = await shmGetUserIdentity(newSid);
                if (sid) {
                  putSession(sid, {
                    ...session,
                    shmSessionId: newSid,
                    shmUserId: ident.userId,
                    login: ident.login || currentLogin,
                    createdAt: session?.createdAt || Date.now(),
                  });
                }
              } catch {}
              newSessionId = newSid;
              dbg(req, "password_set:reauth_tg_widget_ok", {
                newSessionId: maskValue(newSid),
              });
            }
          }
        }
      } catch (e: any) {
        dbg(req, "password_set:reauth_tg_failed", {
          error: String(e?.message ?? e),
        });
      }
    }

    if (newSessionId && newSessionId !== oldSessionId) {
      await markPasswordStep(newSessionId, "new_session", req);
    }

    return reply.send({
      ok: true,
      password_set: 1,
      reauth_method: newSessionId
        ? "session_updated"
        : currentLogin && !currentLogin.startsWith("@")
          ? "use_email_password"
          : "use_telegram",
      login: currentLogin,
    });
  });

  // ── POST /auth/onboarding/mark ────────────────────────────────────────────
  app.post("/auth/onboarding/mark", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    if (!s) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const body = readJsonBody(req);
    const step = String(body?.step ?? "").trim().toLowerCase();
    if (!step) {
      return reply.code(400).send({ ok: false, error: "step_required" });
    }

    const allowedSteps = ["welcome", "services", "payments", "email", "password"];
    if (!allowedSteps.includes(step)) {
      return reply
        .code(400)
        .send({ ok: false, error: "unknown_step", allowed: allowedSteps });
    }

    const sidCookie = String((req.cookies as any)?.sid ?? "").trim();
    let shmSessionId = String(s.shmSessionId || "").trim();
    let shmUserId = Number(s.shmUserId ?? 0) || 0;
    let login = String(s.login ?? "").trim();

    try {
      if (s.telegramInitData) {
        const rr = await singleFlightTelegramWebAppAuth(
          String(s.telegramInitData).trim(),
          getClientIp(req)
        );
        if (!rr.ok) {
          return reply
            .code(mapShmAuthErrorStatus(rr.status || 502))
            .send({ ok: false, error: "onboarding_reauth_failed" });
        }
        shmSessionId = String(rr.json?.session_id ?? "").trim();
      } else if (s.telegramWidgetPayload) {
        const rr = await singleFlightTelegramWidgetAuth(
          s.telegramWidgetPayload,
          getClientIp(req)
        );
        if (!rr.ok) {
          return reply
            .code(mapShmAuthErrorStatus(rr.status || 502))
            .send({ ok: false, error: "onboarding_reauth_failed" });
        }
        shmSessionId = String(rr.json?.session_id ?? "").trim();
      }

      if (!shmSessionId) {
        return reply
          .code(502)
          .send({ ok: false, error: "no_shm_session_after_reauth" });
      }

      try {
        const ident = await shmGetUserIdentity(shmSessionId);
        shmUserId = ident.userId || shmUserId;
        login = ident.login || login;
      } catch {}

      if (sidCookie) {
        putSession(sidCookie, {
          ...s,
          shmSessionId,
          shmUserId,
          login,
          createdAt: s.createdAt || Date.now(),
        });
      }

      await callShmTemplate(shmSessionId, "onboarding.mark", { step });
      return reply.send({ ok: true, step });
    } catch (e: any) {
      return reply.code(502).send({
        ok: false,
        error: "onboarding_mark_failed",
        detail: String(e?.message ?? e),
      });
    }
  });

  // ── GET /auth/status ──────────────────────────────────────────────────────
  app.get("/auth/status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    return reply.send({
      ok: true,
      authenticated: !!s?.shmSessionId,
      user_id: s?.shmUserId ?? null,
    });
  });

  // ── POST /logout ──────────────────────────────────────────────────────────
  app.post("/logout", async (req, reply) => {
    const sid = (req.cookies as any)?.sid as string | undefined;
    deleteSession(sid);
    return reply.clearCookie("sid", { path: "/" }).send({ ok: true });
  });
}