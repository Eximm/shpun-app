// api/src/modules/referrals/routes.ts

import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import {
  shmShpunAppReferralsList,
  shmShpunAppReferralsStatus,
  shmShpunAppReferralsLink,
} from "../../shared/shm/shmClient.js";
import {
  findReferralAlias,
  isValidReferralAlias,
  recordReferralAliasVisit,
} from "../../shared/linkdb/referralAliasesRepo.js";

function toInt(v: any, def: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

export async function referralsRoutes(app: FastifyInstance) {
  app.get("/referrals/resolve", async (req, reply) => {
    const alias = String((req.query as any)?.alias ?? "").trim().toLowerCase();
    if (!isValidReferralAlias(alias)) {
      return reply.code(400).send({ ok: false, error: "invalid_alias" });
    }
    const item = findReferralAlias(alias);
    if (!item) return reply.code(404).send({ ok: false, error: "alias_not_found" });
    recordReferralAliasVisit(alias);

    // Public response deliberately exposes only data needed before registration.
    return reply.send({ ok: true, alias: item.alias, partnerId: item.partner_id });
  });

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

  /**
   * GET /referrals/link
   * Итоговый путь с учетом prefix '/api' => /api/referrals/link
   */
  app.get("/referrals/link", async (req, reply) => {
    const s = getSessionFromRequest(req) as any;
    const shmSessionId = String(s?.shmSessionId ?? "").trim();

    if (!shmSessionId) {
      return reply.code(401).send({ ok: false, error: "unauthorized" });
    }

    const r = await shmShpunAppReferralsLink(shmSessionId);

    if (!r.ok) {
      return reply
        .code(502)
        .send({ ok: false, error: "shm_failed", status: r.status });
    }

    return reply.send(r.json ?? { ok: false, error: "empty_response" });
  });
}
