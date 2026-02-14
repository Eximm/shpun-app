import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { fetchMe } from "./me.js";

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

    // Стабильный контракт для фронта
    const userId = toNum(meRaw.user_id, 0);
    const balance = toNum(meRaw.balance, 0);
    const bonus = toNum(meRaw.bonus, 0);
    const discount = toNum(meRaw.discount, 0);

    const payload: any = {
      ok: true,
      profile: {
        id: userId,
        displayName: toDisplayName(meRaw),
        login: meRaw.login ?? null,
        fullName: meRaw.full_name ?? null,

        // ✅ реальный boolean из shpun_app status
        passwordSet: !!meRes.me.passwordSet,

        // ✅ стабильные даты для витрины
        created: meRes.me.created ?? null,
        lastLogin: meRes.me.lastLogin ?? null,
      },
      balance: { amount: balance, currency: "RUB" },
      bonus,
      discount,
      shm: { status: 200 },
    };

    // ✅ meRaw оставим только в dev (чтобы в проде не светить лишнее)
    if (process.env.NODE_ENV !== "production") {
      payload.meRaw = meRaw;
    }

    return reply.send(payload);
  });

  // ⚠️ ВАЖНО:
  // Роут GET /api/services вынесен в api/src/modules/services/routes.ts
  // чтобы не было дублей и конфликтов.
}
