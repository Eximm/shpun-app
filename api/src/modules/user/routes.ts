import type { FastifyInstance } from "fastify";
import { getSession } from "../../shared/session/sessionStore.js";
import { shmGetMe, shmGetUserServices } from "../../shared/shm/shmClient.js";

function clampInt(v: any, def: number, min: number, max: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.min(max, Math.max(min, i));
}

function toDisplayName(me: any): string {
  const fullName = String(me?.full_name ?? "").trim();
  const login = String(me?.login ?? "").trim();
  const id = me?.user_id;
  return fullName || login || (id ? `User #${id}` : "User");
}

export async function userRoutes(app: FastifyInstance) {
  // ====== GET /api/me ======
  app.get("/me", async (req, reply) => {
    const sid = (req.cookies as any)?.sid as string | undefined;
    const s = getSession(sid);

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

  // ====== GET /api/services ======
  app.get("/services", async (req, reply) => {
    const sid = (req.cookies as any)?.sid as string | undefined;
    const s = getSession(sid);

    if (!s?.shmSessionId) {
      return reply.code(401).send({ ok: false, error: "not_authenticated" });
    }

    // Ограничиваем, чтобы не уложить SHM/нас большим лимитом
    const limit = clampInt((req.query as any)?.limit, 50, 1, 200);
    const offset = clampInt((req.query as any)?.offset, 0, 0, 1_000_000);

    const r = await shmGetUserServices(s.shmSessionId, {
      limit,
      offset,
      filter: {},
    });

    if (!r.ok) {
      return reply.code(r.status || 502).send({
        ok: false,
        error: "shm_services_failed",
        shm: r.json ?? r.text,
      });
    }

    const items = (r.json as any)?.data ?? [];
    const meta = {
      items: (r.json as any)?.items ?? items.length,
      limit: (r.json as any)?.limit ?? limit,
      offset: (r.json as any)?.offset ?? offset,
      status: r.status,
    };

    // Группировка для быстрого UI (не ломает основной items)
    const grouped = {
      active: [] as any[],
      blocked: [] as any[],
      other: [] as any[],
    };

    for (const it of items) {
      const st = String(it?.status ?? "").toUpperCase();
      if (st === "ACTIVE") grouped.active.push(it);
      else if (st === "BLOCK") grouped.blocked.push(it);
      else grouped.other.push(it);
    }

    return reply.send({
      ok: true,
      items,
      grouped,
      meta,
    });
  });
}
