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

const ALLOWED_PROVIDERS = new Set(["telegram", "google", "yandex", "email"] as const);
type AllowedProvider = "telegram" | "google" | "yandex" | "email";

function asProvider(v: any): AllowedProvider | null {
  const p = String(v ?? "").trim().toLowerCase();
  return (ALLOWED_PROVIDERS as any).has(p) ? (p as AllowedProvider) : null;
}

/**
 * Пока у нас нет настоящего флага password_set из settings,
 * используем аккуратную эвристику:
 * - если логин похож на "@<digits>" (типичный тех-логин из телеги)
 * - или логин пустой
 * -> предлагаем set_password
 *
 * Как только подключим SHM template shpun_app -> заменим на реальный password_set.
 */
function inferNextStep(login: string | undefined | null): "set_password" | "cabinet" {
  const l = String(login ?? "").trim();
  if (!l) return "set_password";
  if (/^@\d+$/.test(l)) return "set_password";
  return "cabinet";
}

export async function authRoutes(app: FastifyInstance) {
  // ====== POST /api/auth/:provider ======
  // body зависит от провайдера:
  // telegram: { initData }
  // password/email (в будущем): { login, password }
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

    const next = inferNextStep(result.login);

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
        next, // фронту сразу понятно: set_password или cabinet
      });
  });

  // ====== POST /api/auth/password/set  { password } ======
  app.post("/auth/password/set", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const password = String(body.password ?? "").trim();

    const r = await setPassword(req, password);
    if (!r.ok) return reply.code(r.status || 400).send(r);

    return reply.send({ ok: true });
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
