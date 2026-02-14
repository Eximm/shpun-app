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

const ALLOWED_PROVIDERS = new Set(["telegram", "password", "google", "yandex"] as const);
type AllowedProvider = "telegram" | "password" | "google" | "yandex";

function asProvider(v: any): AllowedProvider | null {
  const p = String(v ?? "").trim().toLowerCase();
  return (ALLOWED_PROVIDERS as any).has(p) ? (p as AllowedProvider) : null;
}

/**
 * SHM template caller: POST /shm/v1/template/shpun_app
 * ВАЖНО: base должен заканчиваться на "/shm/" (как у нас принято в проекте).
 */
function shmBase(): string {
  const b = String(process.env.SHM_BASE ?? "").trim();
  // ожидаем вида: https://bill.shpyn.online/shm/
  if (!b) return "https://bill.shpyn.online/shm/";
  return b.endsWith("/") ? b : b + "/";
}

async function callShmTemplate<T = any>(sessionId: string, action: string, extraData?: any): Promise<T> {
  const url = `${shmBase()}v1/template/shpun_app`;
  const body = JSON.stringify({ session_id: sessionId, action, ...(extraData ? { data: extraData } : {}) });

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });

  const text = await res.text();
  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`SHM template non-JSON response (${res.status}): ${text?.slice(0, 200)}`);
  }

  if (!res.ok) {
    const msg = json?.error || json?.message || `SHM template failed: ${res.status}`;
    throw new Error(msg);
  }

  return json as T;
}

/**
 * Берём password_set из shpun_app status.
 * Возвращаем 0/1, если не получилось — считаем 0 (чтобы в первый раз не потерять onboarding).
 */
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
  // body зависит от провайдера:
  // telegram: { initData }
  // password: { login, password }
  app.post("/auth/:provider", async (req, reply) => {
    const { provider: rawProvider } = req.params as { provider: string };
    const provider = asProvider(rawProvider);

    if (!provider) {
      return reply.code(400).send({ ok: false, status: 400, error: "unknown_provider" });
    }

    const result = await handleAuth(provider, req.body ?? {});
    if (!result.ok) return reply.code(result.status || 400).send(result);

    const localSid = createLocalSid();

    putSession(localSid, {
      shmSessionId: result.shmSessionId!,
      shmUserId: result.shmUserId!,
      createdAt: Date.now(),
    });

    // ✅ Ненавязчивый onboarding:
    // Только при Telegram и только если password_set == 0.
    let next: "set_password" | "cabinet" = "cabinet";
    if (provider === "telegram") {
      const ps = await getPasswordSetFlag(result.shmSessionId!);
      next = ps === 1 ? "cabinet" : "set_password";
    }

    return reply
      .setCookie("sid", localSid, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      })
      .send({
        ok: true,
        user_id: result.shmUserId,
        login: result.login ?? "",
        next, // фронту понятно: set_password только 1 раз
      });
  });

  // ====== POST /api/auth/password/set  { password } ======
  app.post("/auth/password/set", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const password = String(body.password ?? "").trim();

    const r = await setPassword(req, password);
    if (!r.ok) return reply.code(r.status || 400).send(r);

    // ✅ фиксируем флаг password_set в SHM (shpun_app)
    try {
      const s = getSessionFromRequest(req);
      const shmSessionId = s?.shmSessionId;
      if (shmSessionId) {
        await callShmTemplate(shmSessionId, "password.mark_set");
      }
    } catch {
      // не валим операцию установки пароля, даже если отметка не удалась
    }

    return reply.send({ ok: true, password_set: 1 });
  });

  // ====== GET /api/auth/status ======
  // маленький дебаг-хелпер: есть ли сессия
  app.get("/auth/status", async (req, reply) => {
    const s = getSessionFromRequest(req);
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
