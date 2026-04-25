// api/src/modules/auth/routes.ts

import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
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
  const prod =
    String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
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

function hasShmSession(rr: any): boolean {
  return !!String(rr?.json?.session_id ?? "").trim();
}

function formatDateDDMMYYYY(date = new Date()): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = String(date.getFullYear());
  return `${day}.${month}.${year}`;
}

async function updateAuthMeta(
  shmSessionId: string,
  req: any,
  source: "telegram" | "widget" | "password"
): Promise<void> {
  try {
    await callShmTemplate(shmSessionId, "auth.meta.update", {
      last_login_at: formatDateDDMMYYYY(),
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
   Deterministic Telegram tech credentials
============================================================ */

function getTelegramTechPasswordSalt(): string {
  return String(
    process.env.TELEGRAM_AUTH_SALT ||
      process.env.APP_SECRET ||
      process.env.SESSION_SECRET ||
      "shpun_telegram_auth_fallback"
  );
}

function buildTelegramLogin(tgId: string): string {
  return `@${String(tgId).trim()}`;
}

function generateTelegramTechPassword(tgId: string): string {
  const cleanId = String(tgId ?? "").trim();
  const salt = getTelegramTechPasswordSalt();
  const hex = createHash("sha256")
    .update(`tg-auth:${cleanId}:${salt}`)
    .digest("hex");
  return `tg_${cleanId}_${hex.slice(0, 24)}`;
}

function isProbablyRegisterConflict(status: number, detail?: unknown): boolean {
  const s = String(detail ?? "").toLowerCase();
  return (
    status === 409 ||
    s.includes("exists") ||
    s.includes("already") ||
    s.includes("duplicate") ||
    s.includes("used") ||
    s.includes("login") ||
    s.includes("логин") ||
    s.includes("занят") ||
    s.includes("существ")
  );
}

type TgCredentialBundle = {
  tgId: string;
  tgLogin?: string;
  login: string;
  password: string;
};

function buildMiniAppTelegramCredentials(initData: string): TgCredentialBundle | null {
  const { tgId, tgLogin } = parseTelegramInitDataUser(initData);
  if (!tgId) return null;
  return {
    tgId,
    tgLogin,
    login: buildTelegramLogin(tgId),
    password: generateTelegramTechPassword(tgId),
  };
}

function buildWidgetTelegramCredentials(bodyOrQuery: any): TgCredentialBundle | null {
  const tgId = bodyOrQuery?.id != null ? String(bodyOrQuery.id).trim() : "";
  const tgLogin =
    bodyOrQuery?.username != null ? String(bodyOrQuery.username).trim() : "";
  if (!tgId) return null;
  return {
    tgId,
    tgLogin,
    login: buildTelegramLogin(tgId),
    password: generateTelegramTechPassword(tgId),
  };
}

async function tryPasswordLoginByTelegram(
  req: any,
  creds: TgCredentialBundle
): Promise<
  | { ok: true; shmSessionId: string; shmUserId?: number; login?: string }
  | { ok: false; status: number; error: string; detail?: unknown }
> {
  const res = await handleAuth("password", {
    mode: "login",
    login: creds.login,
    password: creds.password,
    client_ip: getClientIp(req),
  });

  if (!res.ok || !String(res.shmSessionId ?? "").trim()) {
    return {
      ok: false,
      status: res.status || 401,
      error: res.error || "telegram_password_login_failed",
      detail: res.detail,
    };
  }

  return {
    ok: true,
    shmSessionId: String(res.shmSessionId).trim(),
    shmUserId: Number(res.shmUserId ?? 0) || undefined,
    login: String(res.login ?? "").trim() || creds.login,
  };
}

async function ensureTelegramUserByPasswordRegister(
  req: any,
  partnerId: any,
  creds: TgCredentialBundle
): Promise<{ ok: true } | { ok: false; status: number; error: string; detail?: unknown }> {
  const reg = await handleAuth("password", {
    mode: "telegram_register",
    login: creds.login,
    password: creds.password,
    client: creds.tgLogin || creds.login,
    client_ip: getClientIp(req),
    partner_id: partnerId,
  });

  if (reg.ok) {
    dbg(req, "telegram_password_register_ok", {
      tgId: creds.tgId,
      login: creds.login,
    });
    return { ok: true };
  }

  if (isProbablyRegisterConflict(reg.status || 0, reg.detail)) {
    dbg(req, "telegram_password_register_conflict_treated_as_existing", {
      tgId: creds.tgId,
      login: creds.login,
      status: reg.status,
    });
    return { ok: true };
  }

  return {
    ok: false,
    status: reg.status || 502,
    error: reg.error || "telegram_register_failed",
    detail: reg.detail,
  };
}

async function bindTelegramToSession(
  req: any,
  shmSessionId: string,
  tgId: string,
  tgLogin?: string
): Promise<boolean> {
  try {
    await callShmTemplate(shmSessionId, "auth.telegram", {
      telegram_id: tgId,
      telegram_login: tgLogin ?? "",
    });
    dbg(req, "telegram_bind_ok", {
      tgId,
      sessionId: maskValue(shmSessionId),
    });
    return true;
  } catch (e: any) {
    dbg(req, "telegram_bind_failed", {
      tgId,
      error: String(e?.message ?? e),
      sessionId: maskValue(shmSessionId),
    });
    return false;
  }
}

async function resolveTelegramMiniAppSession(
  req: any,
  body: any,
  initData: string
): Promise<
  | {
      ok: true;
      shmSessionId: string;
      source: "telegram" | "telegram_password_existing" | "telegram_password_new";
    }
  | {
      ok: false;
      status: number;
      error: string;
      detail?: unknown;
    }
> {
  const clientIp = getClientIp(req);

  let rr = await singleFlightTelegramWebAppAuth(initData, clientIp);
  if (rr.ok && hasShmSession(rr)) {
    return {
      ok: true,
      shmSessionId: String(rr.json?.session_id ?? "").trim(),
      source: "telegram",
    };
  }

  const creds = buildMiniAppTelegramCredentials(initData);
  if (!creds) {
    return { ok: false, status: 400, error: "telegram_id_missing" };
  }

  const existing = await tryPasswordLoginByTelegram(req, creds);
  if (existing.ok) {
    await bindTelegramToSession(req, existing.shmSessionId, creds.tgId, creds.tgLogin);

    rr = await singleFlightTelegramWebAppAuth(initData, clientIp);
    if (rr.ok && hasShmSession(rr)) {
      return {
        ok: true,
        shmSessionId: String(rr.json?.session_id ?? "").trim(),
        source: "telegram",
      };
    }

    return {
      ok: true,
      shmSessionId: existing.shmSessionId,
      source: "telegram_password_existing",
    };
  }

  const reg = await ensureTelegramUserByPasswordRegister(req, body?.partner_id, creds);
  if (!reg.ok) {
    return reg;
  }

  const created = await tryPasswordLoginByTelegram(req, creds);
  if (!created.ok) {
    return {
      ok: false,
      status: created.status,
      error: created.error,
      detail: created.detail,
    };
  }

  await bindTelegramToSession(req, created.shmSessionId, creds.tgId, creds.tgLogin);

  rr = await singleFlightTelegramWebAppAuth(initData, clientIp);
  if (rr.ok && hasShmSession(rr)) {
    return {
      ok: true,
      shmSessionId: String(rr.json?.session_id ?? "").trim(),
      source: "telegram",
    };
  }

  return {
    ok: true,
    shmSessionId: created.shmSessionId,
    source: "telegram_password_new",
  };
}

async function resolveTelegramWidgetSession(
  req: any,
  payload: any
): Promise<
  | {
      ok: true;
      shmSessionId: string;
      source: "widget" | "widget_password_existing" | "widget_password_new";
    }
  | {
      ok: false;
      status: number;
      error: string;
      detail?: unknown;
    }
> {
  const clientIp = getClientIp(req);

  let rr = await singleFlightTelegramWidgetAuth(payload, clientIp);
  if (rr.ok && hasShmSession(rr)) {
    return {
      ok: true,
      shmSessionId: String(rr.json?.session_id ?? "").trim(),
      source: "widget",
    };
  }

  const creds = buildWidgetTelegramCredentials(payload);
  if (!creds) {
    return { ok: false, status: 400, error: "telegram_id_missing" };
  }

  const existing = await tryPasswordLoginByTelegram(req, creds);
  if (existing.ok) {
    await bindTelegramToSession(req, existing.shmSessionId, creds.tgId, creds.tgLogin);

    rr = await singleFlightTelegramWidgetAuth(payload, clientIp);
    if (rr.ok && hasShmSession(rr)) {
      return {
        ok: true,
        shmSessionId: String(rr.json?.session_id ?? "").trim(),
        source: "widget",
      };
    }

    return {
      ok: true,
      shmSessionId: existing.shmSessionId,
      source: "widget_password_existing",
    };
  }

  const reg = await ensureTelegramUserByPasswordRegister(req, payload?.partner_id, creds);
  if (!reg.ok) {
    return reg;
  }

  const created = await tryPasswordLoginByTelegram(req, creds);
  if (!created.ok) {
    return {
      ok: false,
      status: created.status,
      error: created.error,
      detail: created.detail,
    };
  }

  await bindTelegramToSession(req, created.shmSessionId, creds.tgId, creds.tgLogin);

  rr = await singleFlightTelegramWidgetAuth(payload, clientIp);
  if (rr.ok && hasShmSession(rr)) {
    return {
      ok: true,
      shmSessionId: String(rr.json?.session_id ?? "").trim(),
      source: "widget",
    };
  }

  return {
    ok: true,
    shmSessionId: created.shmSessionId,
    source: "widget_password_new",
  };
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

  // ── Telegram Mini App ────────────────────────────────────────────────────
  app.post("/auth/telegram", async (req, reply) => {
    const body = readJsonBody(req);
    const initData = String(body.initData ?? "").trim();
    if (!initData) {
      return reply.code(400).send({ ok: false, error: "init_data_required" });
    }

    const resolved = await resolveTelegramMiniAppSession(req, body, initData);
    if (!resolved.ok) {
      return reply.code(resolved.status).send({
        ok: false,
        error: resolved.error,
        detail: resolved.detail,
      });
    }

    const shmSessionId = String(resolved.shmSessionId ?? "").trim();

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

    const parsed = parseTelegramInitDataUser(initData);
    if (parsed.tgId) {
      await bindTelegramToSession(req, shmSessionId, parsed.tgId, parsed.tgLogin);
    }

    await updateAuthMeta(shmSessionId, req, "telegram");

    const ps = await getPasswordSetFlag(shmSessionId);
    dbg(req, "telegram_auth_resolved", {
      source: resolved.source,
      shmSessionId: maskValue(shmSessionId),
      shmUserId,
      login,
      next: ps === 1 ? "home" : "set_password",
    });

    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .send({
        ok: true,
        user_id: shmUserId,
        login,
        next: ps === 1 ? "home" : "set_password",
      });
  });

  // ── Telegram Widget POST ─────────────────────────────────────────────────
  app.post("/auth/telegram_widget", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    if (isProbablyEmptyTelegramWidgetPayload(body)) {
      return reply.code(400).send({ ok: false, error: "missing_telegram_payload" });
    }

    const resolved = await resolveTelegramWidgetSession(req, body);
    if (!resolved.ok) {
      return reply.code(resolved.status).send({
        ok: false,
        error: resolved.error,
        detail: resolved.detail,
      });
    }

    const shmSessionId = String(resolved.shmSessionId ?? "").trim();

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

    const tgId = body?.id != null ? String(body.id).trim() : "";
    const tgLogin =
      body?.username != null ? String(body.username).trim() : "";
    if (tgId) {
      await bindTelegramToSession(req, shmSessionId, tgId, tgLogin);
    }

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

  // ── Telegram Widget Redirect (GET) ───────────────────────────────────────
  app.get("/auth/telegram_widget_redirect", async (req, reply) => {
    const payload = (req.query ?? {}) as any;
    if (isProbablyEmptyTelegramWidgetPayload(payload)) {
      return reply.redirect("/login?e=missing_telegram_payload");
    }

    const resolved = await resolveTelegramWidgetSession(req, payload);
    if (!resolved.ok) {
      return reply.redirect(`/login?e=${encodeURIComponent(resolved.error || "tg_widget_failed")}`);
    }

    const shmSessionId = String(resolved.shmSessionId ?? "").trim();

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
      await tryAttachPartner(shmSessionId, payload?.partner_id);
    } catch {}

    const localSid = reuseOrCreateSid(req);
    putSession(localSid, {
      shmSessionId,
      shmUserId,
      login,
      createdAt: Date.now(),
      telegramWidgetPayload: pickTelegramWidgetPayload(payload),
    });

    const tgId = payload?.id != null ? String(payload.id).trim() : "";
    const tgLogin =
      payload?.username != null ? String(payload.username).trim() : "";
    if (tgId) {
      await bindTelegramToSession(req, shmSessionId, tgId, tgLogin);
    }

    await updateAuthMeta(shmSessionId, req, "widget");

    reply.setCookie("sid", localSid, cookieOptions(req));
    const ps = await getPasswordSetFlag(shmSessionId);

    return ps === 1
      ? reply.redirect(withAuthOk("/login"))
      : reply.redirect(withAuthOk("/set-password"));
  });

  // ── Password login / register ────────────────────────────────────────────
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

    return reply
      .setCookie("sid", localSid, cookieOptions(req))
      .send({ ok: true, user_id: shmUserId, login, next: "home" });
  });

  // ── Set password (onboarding) ────────────────────────────────────────────
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
          }
        }
      } catch {}
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
          if (rr.ok && hasShmSession(rr)) {
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
            }
          } else {
            const creds = buildMiniAppTelegramCredentials(
              String(session.telegramInitData).trim()
            );
            if (creds) {
              const fb = await tryPasswordLoginByTelegram(req, creds);
              if (fb.ok) {
                if (sid) {
                  let fbUid = 0;
                  let fbLogin = currentLogin;
                  try {
                    const ident = await shmGetUserIdentity(fb.shmSessionId);
                    fbUid = ident.userId;
                    fbLogin = ident.login || fbLogin;
                  } catch {}
                  putSession(sid, {
                    ...session,
                    shmSessionId: fb.shmSessionId,
                    shmUserId: fbUid || session?.shmUserId,
                    login: fbLogin,
                    createdAt: session?.createdAt || Date.now(),
                  });
                }
                newSessionId = fb.shmSessionId;
              }
            }
          }
        } else if (hasTgWidget) {
          const rr = await singleFlightTelegramWidgetAuth(
            session.telegramWidgetPayload,
            getClientIp(req)
          );
          if (rr.ok && hasShmSession(rr)) {
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
            }
          } else {
            const creds = buildWidgetTelegramCredentials(session.telegramWidgetPayload);
            if (creds) {
              const fb = await tryPasswordLoginByTelegram(req, creds);
              if (fb.ok) {
                if (sid) {
                  let fbUid = 0;
                  let fbLogin = currentLogin;
                  try {
                    const ident = await shmGetUserIdentity(fb.shmSessionId);
                    fbUid = ident.userId;
                    fbLogin = ident.login || fbLogin;
                  } catch {}
                  putSession(sid, {
                    ...session,
                    shmSessionId: fb.shmSessionId,
                    shmUserId: fbUid || session?.shmUserId,
                    login: fbLogin,
                    createdAt: session?.createdAt || Date.now(),
                  });
                }
                newSessionId = fb.shmSessionId;
              }
            }
          }
        }
      } catch {}
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

  // ── Onboarding mark ──────────────────────────────────────────────────────
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
        if (rr.ok && hasShmSession(rr)) {
          shmSessionId = String(rr.json?.session_id ?? "").trim();
        } else {
          const creds = buildMiniAppTelegramCredentials(String(s.telegramInitData).trim());
          if (creds) {
            const fb = await tryPasswordLoginByTelegram(req, creds);
            if (!fb.ok) {
              return reply
                .code(mapShmAuthErrorStatus(rr.status || 502))
                .send({ ok: false, error: "onboarding_reauth_failed" });
            }
            shmSessionId = fb.shmSessionId;
          } else {
            return reply
              .code(mapShmAuthErrorStatus(rr.status || 502))
              .send({ ok: false, error: "onboarding_reauth_failed" });
          }
        }
      } else if (s.telegramWidgetPayload) {
        const rr = await singleFlightTelegramWidgetAuth(
          s.telegramWidgetPayload,
          getClientIp(req)
        );
        if (rr.ok && hasShmSession(rr)) {
          shmSessionId = String(rr.json?.session_id ?? "").trim();
        } else {
          const creds = buildWidgetTelegramCredentials(s.telegramWidgetPayload);
          if (creds) {
            const fb = await tryPasswordLoginByTelegram(req, creds);
            if (!fb.ok) {
              return reply
                .code(mapShmAuthErrorStatus(rr.status || 502))
                .send({ ok: false, error: "onboarding_reauth_failed" });
            }
            shmSessionId = fb.shmSessionId;
          } else {
            return reply
              .code(mapShmAuthErrorStatus(rr.status || 502))
              .send({ ok: false, error: "onboarding_reauth_failed" });
          }
        }
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

  // ── Auth status ──────────────────────────────────────────────────────────
  app.get("/auth/status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    return reply.send({
      ok: true,
      authenticated: !!s?.shmSessionId,
      user_id: s?.shmUserId ?? null,
    });
  });

  // ── Logout ───────────────────────────────────────────────────────────────
  app.post("/logout", async (req, reply) => {
    const sid = (req.cookies as any)?.sid as string | undefined;
    deleteSession(sid);
    return reply.clearCookie("sid", { path: "/" }).send({ ok: true });
  });

  // ── Сброс пароля: проверка токена и получение login2 ────────────────────
  // Публичный. GET /auth/password-reset/verify?token=...
  // Возвращает login2 пользователя чтобы показать его на странице сброса.
  app.get("/auth/password-reset/verify", async (req, reply) => {
    const token = String((req.query as any)?.token ?? "").trim();

    if (!token) {
      return reply.code(400).send({ ok: false, error: "token_required" });
    }

    const r = await shmFetch<any>(null, `v1/user/passwd/reset/verify`, {
      method: "GET",
      query: { token },
    });

    if (!r.ok) {
      return reply.code(r.status === 400 ? 400 : 502).send({
        ok: false,
        error: r.status === 400 ? "invalid_or_expired_token" : "shm_verify_failed",
      });
    }

    // Биллинг возвращает данные пользователя — вытаскиваем login2
    const j: any = r.json ?? {};
    const u = Array.isArray(j?.data) ? j.data[0] : j?.data ?? j ?? {};
    const login2 = String(u?.login2 ?? u?.data?.login2 ?? "").trim();
    const login  = String(u?.login  ?? u?.data?.login  ?? "").trim();

    return reply.send({
      ok: true,
      login2: login2 || null,
      login:  login  || null,
    });
  });

  // ── Сброс пароля: запрос письма ──────────────────────────────────────────
  // Публичный. Принимает { login }.
  // Всегда отвечает { ok: true } — не раскрываем существование аккаунта.
  app.post("/auth/password-reset", async (req, reply) => {
    const body  = readJsonBody(req);
    const login = String(body?.login ?? "").trim().toLowerCase();

    if (!login) {
      return reply.code(400).send({ ok: false, error: "login_required" });
    }

    try {
      await shmFetch(null, "v1/user/passwd/reset", {
        method: "POST",
        body: { login },
      });
    } catch {
      // best-effort — не раскрываем ошибку
    }

    return reply.send({ ok: true });
  });

  // ── Сброс пароля: установка нового пароля по токену ──────────────────────
  // Публичный. Принимает { token, password }.
  app.post("/auth/password-reset/confirm", async (req, reply) => {
    const body     = readJsonBody(req);
    const token    = String(body?.token    ?? "").trim();
    const password = String(body?.password ?? "").trim();

    if (!token) {
      return reply.code(400).send({ ok: false, error: "token_required" });
    }
    if (!password || password.length < 8) {
      return reply.code(400).send({ ok: false, error: "password_too_short" });
    }

    const r = await shmFetch<any>(null, "v1/user/passwd/reset/verify", {
      method: "POST",
      body: { token, password },
    });

    if (!r.ok) {
      return reply.code(r.status === 400 ? 400 : 502).send({
        ok: false,
        error: r.status === 400 ? "invalid_or_expired_token" : "shm_reset_failed",
      });
    }

    // Биллинг возвращает данные пользователя — вытаскиваем login2 и login
    const j: any = r.json ?? {};
    const u = Array.isArray(j?.data) ? j.data[0] : j?.data ?? {};
    const login2 = String(u?.login2 ?? "").trim();
    const login  = String(u?.login  ?? "").trim();

    return reply.send({
      ok: true,
      login2: login2 || null,
      login:  login  || null,
    });
  });
}