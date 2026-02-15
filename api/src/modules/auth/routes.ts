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

const ALLOWED_PROVIDERS = new Set(
  ["telegram", "password", "google", "yandex"] as const
);
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

/**
 * Получить user_id по session_id: GET /shm/v1/user
 * SHM принимает session_id либо cookie, либо header session-id.
 * Мы используем header session-id — это стабильнее в сервер-сервер.
 */
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
      `shm_user_failed:${res.status}:${String((json ?? text) || "").slice(
        0,
        200
      )}`
    );
  }

  // Обычно это { data:[{user_id,...}], status:200, ... }
  const u = Array.isArray((json as any)?.data) ? (json as any).data[0] : (json as any)?.data;
  const userId = Number(u?.user_id ?? u?.id ?? 0) || 0;
  if (!userId) throw new Error("shm_user_invalid_response");

  return userId;
}

/**
 * SHM template caller: POST /shm/v1/template/shpun_app
 * (используется только для флагов onboarding/auth link, НЕ для регистрации)
 */
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
    return 0;
  }
}

export async function authRoutes(app: FastifyInstance) {
  // ====== POST /api/auth/:provider ======
  // telegram: { initData }
  // password:
  //   login:    { login, password }
  //   register: { login, password, mode:"register" }
  app.post("/auth/:provider", async (req, reply) => {
    const { provider: rawProvider } = req.params as { provider: string };
    const provider = asProvider(rawProvider);

    if (!provider) {
      return reply
        .code(400)
        .send({ ok: false, status: 400, error: "unknown_provider" });
    }

    const result = await handleAuth(provider, req.body ?? {});
    if (!result.ok) return reply.code(result.status || 400).send(result);

    const shmSessionId = String(result.shmSessionId ?? "").trim();
    if (!shmSessionId) {
      return reply
        .code(502)
        .send({ ok: false, status: 502, error: "no_shm_session" });
    }

    // ✅ ВАЖНО: гарантируем user_id через /v1/user
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

    putSession(localSid, {
      shmSessionId,
      shmUserId,
      createdAt: Date.now(),
    });

    // ✅ Ненавязчивый onboarding:
    let next: "set_password" | "cabinet" = "cabinet";
    if (provider === "telegram") {
      const ps = await getPasswordSetFlag(shmSessionId);
      next = ps === 1 ? "cabinet" : "set_password";
    }

    const loginFromApi = String((result as any).login ?? "").trim();

    return reply
      .setCookie("sid", localSid, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
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

    // 🔒 Сохраняем sid и текущую сессию ДО setPassword
    const sid = String((req.cookies as any)?.sid ?? "").trim();
    const before = getSessionFromRequest(req) as any;

    const r = await setPassword(req, password);
    if (!r.ok) return reply.code((r as any).status || 400).send(r);

    // ✅ КРИТИЧНО: после смены пароля НЕ теряем локальную сессию
    // Если setPassword внутри чистит/реконфигурит что-то — мы жёстко восстанавливаем.
    if (sid && before?.shmSessionId && before?.shmUserId) {
      putSession(sid, {
        shmSessionId: before.shmSessionId,
        shmUserId: before.shmUserId,
        createdAt: before.createdAt ?? Date.now(),
      });

      reply.setCookie("sid", sid, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      });
    }

    // best-effort флаг password_set
    try {
      const s = before || (getSessionFromRequest(req) as any);
      const shmSessionId = (s as any)?.shmSessionId;
      if (shmSessionId) {
        await callShmTemplate(shmSessionId, "password.mark_set");
      }
    } catch {
      // ignore
    }

    return reply.send({ ok: true, password_set: 1 });
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
