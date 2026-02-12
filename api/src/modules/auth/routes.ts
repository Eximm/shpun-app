import type { FastifyInstance } from "fastify";
import {
  shmAuthWithPassword,
  shmAuthWithTelegramWebApp,
} from "../../shared/shm/shmClient.js";
import {
  createLocalSid,
  putSession,
  deleteSession,
} from "../../shared/session/sessionStore.js";

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/telegram
  // body: { initData }
  // -> SHM: GET /shm/v1/telegram/webapp/auth?initData=...
  // <- { session_id }
  app.post("/auth/telegram", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const initData = String(body.initData ?? "").trim();

    if (!initData) {
      return reply.code(400).send({ ok: false, error: "initData_required" });
    }

    const r = await shmAuthWithTelegramWebApp(initData);

    if (!r.ok || !r.json?.session_id) {
      return reply.code(r.status || 401).send({
        ok: false,
        error: "telegram_auth_failed",
        shm: r.json ?? r.text,
      });
    }

    const localSid = createLocalSid();

    putSession(localSid, {
      shmSessionId: r.json.session_id,
      shmUserId: r.json.user_id,
      createdAt: Date.now(),
    });

    reply
      .setCookie("sid", localSid, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        // domain: process.env.COOKIE_DOMAIN, // включим позже, если нужно
        // maxAge: 60 * 60 * 24 * 7,          // можно добавить позже
      })
      .send({ ok: true });
  });

  // POST /api/auth/password (префикс /api добавляется в app/routes/index.ts)
  app.post("/auth/password", async (req, reply) => {
    const body = (req.body ?? {}) as any;
    const login = String(body.login ?? "");
    const password = String(body.password ?? "");

    if (!login || !password) {
      return reply
        .code(400)
        .send({ ok: false, error: "login_or_password_required" });
    }

    const r = await shmAuthWithPassword(login, password);

    if (!r.ok || !r.json?.session_id) {
      return reply.code(r.status || 401).send({
        ok: false,
        error: "auth_failed",
        shm: r.json ?? r.text,
      });
    }

    const localSid = createLocalSid();

    putSession(localSid, {
      shmSessionId: r.json.session_id,
      shmUserId: r.json.user_id,
      createdAt: Date.now(),
    });

    reply
      .setCookie("sid", localSid, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
      })
      .send({ ok: true });
  });

  // POST /api/logout
  app.post("/logout", async (req, reply) => {
    const sid = (req.cookies as any)?.sid as string | undefined;
    deleteSession(sid);

    reply.clearCookie("sid", { path: "/" }).send({ ok: true });
  });
}
