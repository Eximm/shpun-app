// api/src/modules/auth/routes.ts

import type { FastifyInstance } from "fastify";
import { handleAuth } from "./authService.js";
import { setPassword } from "./password.js";
import {
  createLocalSid,
  putSession,
  deleteSession,
  getSessionFromRequest,
} from "../../shared/session/sessionStore.js";
import { shmAuthWithTelegramWebApp } from "../../shared/shm/shmClient.js";
import { createTransfer, consumeTransfer } from "../../shared/linkdb/transferRepo.js";

const ALLOWED_PROVIDERS = new Set(["telegram", "password", "google", "yandex"] as const);
type AllowedProvider = "telegram" | "password" | "google" | "yandex";

function asProvider(v: any): AllowedProvider | null {
  const p = String(v ?? "").trim().toLowerCase();
  return (ALLOWED_PROVIDERS as any).has(p) ? (p as AllowedProvider) : null;
}

function shmRoot(): string {
  const b0 = String(process.env.SHM_BASE ?? "").trim(); // ожидаем ".../shm/" или ".../shm"
  const b = (b0 || "https://bill.shpyn.online/shm/").replace(/\/+$/, "");
  if (b.endsWith("/shm/v1")) return b.slice(0, -3);
  return b;
}
function shmV1(): string {
  return `${shmRoot()}/v1`;
}

async function safeReadJson(res: Response): Promise<any | null> {
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) return null;
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function shmGetUserId(sessionId: string): Promise<number> {
  const res = await fetch(`${shmV1()}/user`, {
    method: "GET",
    headers: {
      accept: "application/json",
      "session-id": sessionId,
    },
  });

  const json = await safeReadJson(res);
  const text = json ? "" : await res.text().catch(() => "");

  if (!res.ok) {
    throw new Error(
      `shm_user_failed:${res.status}:${String((json ?? text) || "").slice(0, 200)}`
    );
  }

  const u = Array.isArray((json as any)?.data) ? (json as any).data[0] : (json as any)?.data;
  const userId = Number(u?.user_id ?? u?.id ?? 0) || 0;
  if (!userId) throw new Error("shm_user_invalid_response");

  return userId;
}

async function callShmTemplate<T = any>(
  sessionId: string,
  action: string,
  extraData?: any
): Promise<T> {
  const url = `${shmV1()}/template/shpun_app`;
  const body = JSON.stringify({
    session_id: sessionId,
    action,
    ...(extraData ? { data: extraData } : {}),
  });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", accept: "application/json" },
    body,
  });

  const json = await safeReadJson(res);
  const text = json ? "" : await res.text().catch(() => "");

  if (!res.ok) {
    const msg =
      (json as any)?.error ||
      (json as any)?.message ||
      `SHM template failed: ${res.status}`;
    throw new Error(`${msg}:${String(text || "").slice(0, 200)}`);
  }

  return (json ?? {}) as T;
}

async function getPasswordSetFlag(shmSessionId: string): Promise<0 | 1> {
  try {
    const r: any = await callShmTemplate(shmSessionId, "status");
    const v = r?.data?.auth?.password_set;
    return v === 1 || v === "1" ? 1 : 0;
  } catch {
    // важно: не “угадываем” что пароль не установлен — лучше считать установленным, чем мучить людей
    return 1;
  }
}

// ===== Public base URL (для редиректов) =====
function getPublicAppBase(req: any): string {
  // 0) приоритет: forwarded headers (nginx/cf)
  const xfProto = String(req.headers?.["x-forwarded-proto"] ?? "").trim();
  const xfHost = String(req.headers?.["x-forwarded-host"] ?? "").trim();
  if (xfHost) {
    const proto = xfProto || "https";
    return `${proto}://${xfHost}`;
  }

  // 1) если пришёл реальный Origin и он в allowlist — используем его
  const origin = String(req.headers?.origin ?? "").trim();
  const allow = String(process.env.APP_ORIGIN ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (origin && allow.includes(origin)) return origin;

  // 2) иначе берём первый из APP_ORIGIN
  if (allow.length) return allow[0];

  // 3) fallback
  return "https://app.shpyn.online";
}

function normalizeRedirectPath(input: any, fallback = "/app"): string {
  const v = String(input ?? "").trim();
  if (!v) return fallback;

  // только относительные пути внутри приложения (защита от open-redirect)
  if (!v.startsWith("/")) return fallback;
  if (v.startsWith("//")) return fallback;
  if (v.includes("\r") || v.includes("\n")) return fallback;
  if (/[^\x20-\x7E]/.test(v)) return fallback;

  return v;
}

function getRequestIp(req: any): string {
  return String(req.headers?.["x-real-ip"] ?? req.ip ?? "").trim();
}

function cookieSecure(): boolean {
  // в проде — secure обязательно, иначе браузер может не принять cookie в https
  return process.env.NODE_ENV === "production";
}

export async function authRoutes(app: FastifyInstance) {
  // ====== POST /api/auth/:provider ======
  app.post("/auth/:provider", async (req, reply) => {
    const { provider: rawProvider } = req.params as { provider: string };
    const provider = asProvider(rawProvider);

    if (!provider) {
      return reply.code(400).send({ ok: false, status: 400, error: "unknown_provider" });
    }

    const body = (req.body ?? {}) as any;

    const result = await handleAuth(provider, body);
    if (!result.ok) return reply.code(result.status || 400).send(result);

    const shmSessionId = String((result as any).shmSessionId ?? "").trim();
    if (!shmSessionId) {
      return reply.code(502).send({ ok: false, status: 502, error: "no_shm_session" });
    }

    let shmUserId = Number((result as any).shmUserId ?? 0) || 0;
    if (!shmUserId) {
      try {
        shmUserId = await shmGetUserId(shmSessionId);
      } catch (e: any) {
        return reply.code(502).send({
          ok: false,
          status: 502,
          error: "shm_user_lookup_failed",
          detail: e?.message,
        });
      }
    }

    const localSid = createLocalSid();

    const telegramInitData = provider === "telegram" ? String(body.initData ?? "").trim() : "";

    putSession(localSid, {
      shmSessionId,
      shmUserId,
      createdAt: Date.now(),
      ...(telegramInitData ? { telegramInitData } : {}),
    });

    // ✅ next: только сервер решает, куда идти.
    let next: "set_password" | "home" = "home";

    if (provider === "telegram") {
      const ps = await getPasswordSetFlag(shmSessionId);
      next = ps === 1 ? "home" : "set_password";
    }

    const loginFromApi = String((result as any).login ?? "").trim();

    return reply
      .setCookie("sid", localSid, {
        httpOnly: true,
        sameSite: "lax",
        secure: cookieSecure(),
        path: "/",
      })
      .send({
        ok: true,
        user_id: shmUserId,
        login: loginFromApi,
        next,
      });
  });

  // ====== POST /api/auth/password/set  { password } ======
  app.post("/auth/password/set", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const password = String(body.password ?? "").trim();

    const sid = String((req.cookies as any)?.sid ?? "").trim();
    const s = getSessionFromRequest(req) as any;

    const r = await setPassword(req, password);
    if (!r.ok) return reply.code((r as any).status || 400).send(r);

    // ✅ после смены пароля SHM может инвалидировать session_id — обновляем по initData
    try {
      const initData = String(s?.telegramInitData ?? "").trim();
      if (initData && sid) {
        const rr = await shmAuthWithTelegramWebApp(initData);
        if ((rr as any)?.ok && (rr as any).json?.session_id) {
          const newShmSessionId = String((rr as any).json.session_id);
          const newUserId = await shmGetUserId(newShmSessionId);

          putSession(sid, {
            ...s,
            shmSessionId: newShmSessionId,
            shmUserId: newUserId,
          });
        }
      }
    } catch {
      // ignore
    }

    // best-effort флаг password_set
    try {
      const ss = getSessionFromRequest(req) as any;
      const shmSessionId = String(ss?.shmSessionId ?? "").trim();
      if (shmSessionId) {
        await callShmTemplate(shmSessionId, "password.mark_set");
      }
    } catch {
      // ignore
    }

    return reply.send({ ok: true, password_set: 1 });
  });

  // ====== POST /api/auth/transfer/start ======
  // Создаёт одноразовый код на 60 сек и возвращает consume_url (API), который:
  // - ставит sid cookie
  // - редиректит на /app (Home)
  app.post("/auth/transfer/start", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const shmSessionId = String(s?.shmSessionId ?? "").trim();
    const shmUserId = Number(s?.shmUserId ?? 0) || 0;

    if (!shmSessionId || !shmUserId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const ip = getRequestIp(req);
    const ua = String(req.headers["user-agent"] ?? "");

    const { code, expiresAt } = createTransfer({
      shmUserId,
      shmSessionId,
      ttlSeconds: 60,
      ip,
      ua,
    });

    const base = getPublicAppBase(req);

    // Важно: ведём в API consume, а не в SPA "/transfer"
    // чтобы cookie sid была поставлена сервером.
    const consumeUrl = `${base}/api/auth/transfer/consume?code=${encodeURIComponent(code)}`;

    return reply.send({ ok: true, consume_url: consumeUrl, expires_at: expiresAt });
  });

  // ====== GET /api/auth/transfer/consume?code=...&redirect=/app ======
  // Открывается в браузере/PWA. Обменивает code -> создаёт sid cookie -> редиректит в приложение
  app.get("/auth/transfer/consume", async (req, reply) => {
    const q = req.query as any;
    const code = String(q.code ?? "").trim();

    // default: Home (/app)
    const redirectTo = normalizeRedirectPath(q.redirect, "/app");

    if (!code) return reply.code(400).send({ ok: false, error: "code_required" });

    const r = consumeTransfer(code);
    if (!r.ok) {
      // UX: мягко отправляем на login с параметром, но без утечек
      const base = getPublicAppBase(req);
      const url = `${base}/login?e=${encodeURIComponent(r.error)}`;
      return reply.redirect(303, url);
    }

    const localSid = createLocalSid();
    putSession(localSid, {
      shmSessionId: r.shmSessionId,
      shmUserId: r.shmUserId,
      createdAt: Date.now(),
    });

    return reply
      .setCookie("sid", localSid, {
        httpOnly: true,
        sameSite: "lax",
        secure: cookieSecure(),
        path: "/",
      })
      .redirect(303, redirectTo);
  });

  // ====== GET /api/auth/status ======
  app.get("/auth/status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    return reply.send({
      ok: true,
      authenticated: !!s?.shmSessionId,
      user_id: s?.shmUserId ?? null,
      has_sid_cookie: !!(req.cookies as any)?.sid,
    });
  });

  // ====== POST /api/logout ======
  app.post("/logout", async (req, reply) => {
    const sid = (req.cookies as any)?.sid as string | undefined;
    deleteSession(sid);
    return reply.clearCookie("sid", { path: "/" }).send({ ok: true });
  });
}
