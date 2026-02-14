import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { fetchMe } from "./me.js";

function toDisplayName(me: any): string {
  const fullName = String(me?.full_name ?? "").trim();
  const login = String(me?.login ?? "").trim();
  const id = me?.user_id;
  return fullName || login || (id ? `User #${id}` : "User");
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

    // Стабильный контракт для фронта (beta-friendly)
    const userId = Number(meRaw.user_id ?? 0) || 0;
    const balance = Number(meRaw.balance ?? 0) || 0;
    const bonus = Number(meRaw.bonus ?? 0) || 0;
    const discount = Number(meRaw.discount ?? 0) || 0;

    return reply.send({
      ok: true,
      profile: {
        id: userId,
        displayName: toDisplayName(meRaw),
        login: meRaw.login ?? null,
        fullName: meRaw.full_name ?? null,
        // задел под онбординг: покажем флаг, когда подключим settings
        passwordSet: meRes.me.passwordSet ?? null,
      },
      balance: { amount: balance, currency: "RUB" },
      bonus,
      discount,
      // В бете оставим raw для дебага/диагностики (потом уберём)
      meRaw,
      shm: { status: 200 },
    });
  });

  // ⚠️ ВАЖНО:
  // Роут GET /api/services вынесен в api/src/modules/services/routes.ts
  // чтобы не было дублей и конфликтов.
}
