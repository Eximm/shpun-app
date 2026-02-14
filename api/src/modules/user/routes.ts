import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { shmGetMe } from "../../shared/shm/shmClient.js";

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

    const r = await shmGetMe(s.shmSessionId);

    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: "shm_me_failed",
        shm: r.json ?? r.text,
      });
    }

    const meRaw =
      r.json && Array.isArray((r.json as any).data) && (r.json as any).data[0]
        ? (r.json as any).data[0]
        : null;

    if (!meRaw) {
      return reply.code(502).send({
        ok: false,
        error: "shm_me_empty",
        shm: r.json ?? r.text,
      });
    }

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
      },
      balance: { amount: balance, currency: "RUB" },
      bonus,
      discount,
      // В бете оставим raw для дебага/диагностики (потом уберём)
      meRaw,
      shm: { status: r.status },
    });
  });

  // ⚠️ ВАЖНО:
  // Роут GET /api/services вынесен в api/src/modules/services/routes.ts
  // чтобы не было дублей и конфликтов.
}
