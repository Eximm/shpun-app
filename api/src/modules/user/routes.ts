// api/src/modules/user/routes.ts
import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { fetchMe } from "./me.js";
import { shmFetch } from "../../shared/shm/shmClient.js";

function toDisplayName(me: any): string {
  const fullName = String(me?.full_name ?? "").trim();
  const login = String(me?.login ?? "").trim();
  const id = me?.user_id;
  return fullName || login || (id ? `User #${id}` : "User");
}

function toNum(v: any, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

async function fetchTelegramUser(sessionId: string) {
  // SHM: GET /shm/v1/telegram/user
  const r = await shmFetch<any>(sessionId, "v1/telegram/user", { method: "GET" });
  if (!r.ok) return null;
  return r.json ?? null;
}

export async function userRoutes(app: FastifyInstance) {
  // ====== GET /api/me ======
  app.get("/me", async (req, reply) => {
    const s = getSessionFromRequest(req);

    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const meRes = await fetchMe(s.shmSessionId);

    if (!meRes.ok) {
      return reply.code(meRes.status || 502).send({
        ok: false,
        error: meRes.error,
        shm: meRes.shm,
      });
    }

    const meRaw = meRes.meRaw;

    // Telegram (best-effort): не ломаем /me если телега недоступна
    const tg = await fetchTelegramUser(s.shmSessionId);
    const telegram = tg
      ? {
          login: tg.login ?? null,
          username: tg.username ?? null,
          chatId: tg.chat_id ?? null,
          status: tg?.ShpynSDNSystem?.status ?? null,
        }
      : null;

    // Стабильный контракт для фронта
    const userId = toNum(meRaw.user_id, 0);
    const balance = toNum(meRaw.balance, 0);
    const bonus = toNum(meRaw.bonus, 0);
    const discount = toNum(meRaw.discount, 0);
    const referralsCount = toNum(meRaw.referrals_count, 0);

    const payload: any = {
      ok: true,
      profile: {
        id: userId,
        displayName: toDisplayName(meRaw),
        login: meRaw.login ?? null,
        fullName: meRaw.full_name ?? null,
        phone: meRaw.phone ?? null,

        passwordSet: !!meRes.me.passwordSet,

        created: meRes.me.created ?? null,
        lastLogin: meRes.me.lastLogin ?? null,
      },

      telegram,

      // Финансы остаются в /me (пригодится для Home/Payments),
      // но в Profile UI мы их больше не показываем.
      balance: { amount: balance, currency: "RUB" },
      bonus,
      discount,

      // ✅ рефералы из биллинга
      referralsCount,

      shm: { status: 200 },
    };

    // ✅ meRaw оставим только в dev (чтобы в проде не светить лишнее)
    if (process.env.NODE_ENV !== "production") {
      payload.meRaw = meRaw;
    }

    return reply.send(payload);
  });

  // ====== POST /api/user/profile ======
  // update full_name / phone via SHM POST v1/user
  app.post("/user/profile", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const full_name = String((req.body as any)?.full_name ?? "").trim();
    const phone = String((req.body as any)?.phone ?? "").trim();

    if (!full_name && !phone) {
      return reply.code(400).send({ ok: false, error: "empty_update" });
    }

    const r = await shmFetch<any>(s.shmSessionId, "v1/user", {
      method: "POST",
      body: {
        ...(full_name ? { full_name } : {}),
        ...(phone ? { phone } : {}),
      },
    });

    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: "shm_update_failed",
        shm: { status: r.status },
        text: r.text,
      });
    }

    return reply.send({ ok: true });
  });

  // ====== POST /api/user/telegram ======
  // set telegram login via SHM POST v1/telegram/user
  app.post("/user/telegram", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    const login = String((req.body as any)?.login ?? "")
      .trim()
      .replace(/^@/, "");

    if (!login) {
      return reply.code(400).send({ ok: false, error: "empty_login" });
    }

    const r = await shmFetch<any>(s.shmSessionId, "v1/telegram/user", {
      method: "POST",
      body: { login },
    });

    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: "shm_telegram_failed",
        shm: { status: r.status },
        text: r.text,
      });
    }

    // Возвращаем актуальные данные телеги
    return reply.send({ ok: true, telegram: r.json ?? null });
  });
}
