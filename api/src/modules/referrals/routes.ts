// api/src/modules/referrals/routes.ts

import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import {
  shmShpunAppReferralsList,
  shmShpunAppReferralsStatus,
} from "../../shared/shm/shmClient.js";

function toInt(v: any, def: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

export async function referralsRoutes(app: FastifyInstance) {
  /**
   * GET /referrals/status
   * Итоговый путь с учетом prefix '/api' => /api/referrals/status
   */
  app.get("/referrals/status", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const shmSessionId = String(s?.shmSessionId ?? "").trim();

    if (!shmSessionId) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }

    const r = await shmShpunAppReferralsStatus(shmSessionId);

    if (!r.ok) {
      return reply
        .code(502)
        .send({ ok: false, error: "shm_failed", status: r.status });
    }

    return reply.send(r.json ?? { ok: false, error: "empty_response" });
  });

  /**
   * GET /referrals/list?limit=7&offset=0
   * Итоговый путь с учетом prefix '/api' => /api/referrals/list
   */
  app.get("/referrals/list", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const shmSessionId = String(s?.shmSessionId ?? "").trim();

    if (!shmSessionId) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }

    const q = (req.query ?? {}) as any;
    let limit = toInt(q.limit, 7);
    let offset = toInt(q.offset, 0);

    // guardrails (на всякий)
    if (limit > 50) limit = 50;
    if (limit < 1) limit = 1;
    if (offset < 0) offset = 0;

    const r = await shmShpunAppReferralsList(shmSessionId, { limit, offset });

    if (!r.ok) {
      return reply
        .code(502)
        .send({ ok: false, error: "shm_failed", status: r.status });
    }

    return reply.send(r.json ?? { ok: false, error: "empty_response" });
  });
}
