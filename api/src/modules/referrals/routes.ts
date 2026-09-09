// api/src/modules/referrals/routes.ts

import type { FastifyInstance, FastifyRequest } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import {
  shmShpunAppReferralsList,
  shmShpunAppReferralsStatus,
  shmShpunAppReferralsLink,
  shmShpunAppTemplate,
} from "../../shared/shm/shmClient.js";
import {
  findReferralAlias,
  isValidReferralAlias,
  recordReferralAliasRegistrationForUser,
  recordReferralAliasVisit,
} from "../../shared/linkdb/referralAliasesRepo.js";

function isPrivateAddress(value: unknown): boolean {
  const ip = String(value ?? "").replace(/^::ffff:/, "");
  if (ip === "127.0.0.1" || ip === "::1") return true;
  if (/^10\./.test(ip) || /^192\.168\./.test(ip)) return true;
  const match = ip.match(/^172\.(\d+)\./);
  return !!match && Number(match[1]) >= 16 && Number(match[1]) <= 31;
}

function isInternalRequest(req: FastifyRequest): boolean {
  const host = String(req.headers.host ?? "").split(":", 1)[0].toLowerCase();
  return isPrivateAddress(req.ip) && (
    host === "shpun-app-api" ||
    host === "127.0.0.1" ||
    host === "localhost"
  );
}

function toInt(v: any, def: number) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.trunc(n);
}

export async function referralsRoutes(app: FastifyInstance) {
  app.get("/internal/referrals/telegram-resolve", async (req, reply) => {
    if (!isInternalRequest(req)) {
      return reply.code(404).send({ ok: false, error: "not_found" });
    }

    const alias = String((req.query as any)?.alias ?? "").trim().toLowerCase();
    if (!isValidReferralAlias(alias)) {
      return reply.code(400).send({ ok: false, error: "invalid_alias" });
    }

    const item = findReferralAlias(alias);
    if (!item) return reply.code(404).send({ ok: false, error: "alias_not_found" });
    recordReferralAliasVisit(alias);

    return reply.send({
      ok: true,
      alias: item.alias,
      linkType: item.link_type,
      partnerId: item.link_type === "partner" ? item.partner_id : 0,
    });
  });

  app.get("/internal/referrals/telegram-claim", async (req, reply) => {
    if (!isInternalRequest(req)) {
      return reply.code(404).send({ ok: false, error: "not_found" });
    }

    const query = (req.query ?? {}) as any;
    const alias = String(query.alias ?? "").trim().toLowerCase();
    const shmSessionId = String(query.session_id ?? "").trim();
    if (!isValidReferralAlias(alias)) {
      return reply.code(400).send({ ok: false, error: "invalid_alias" });
    }
    if (!shmSessionId) {
      return reply.code(400).send({ ok: false, error: "missing_session_id" });
    }

    const item = findReferralAlias(alias);
    if (!item) return reply.code(404).send({ ok: false, error: "alias_not_found" });
    if (item.link_type !== "campaign") {
      return reply.send({
        ok: true,
        alias: item.alias,
        linkType: item.link_type,
        partnerId: item.partner_id,
        commentWritten: 0,
      });
    }

    const claimResult = await shmShpunAppTemplate<any>(shmSessionId, "campaign.claim", {
      campaign_alias: item.alias,
      campaign_comment: item.billing_comment ?? "",
      referral_secret: String(process.env.SHM_REFERRAL_SECRET ?? ""),
    });
    if (!claimResult.ok) {
      return reply.code(502).send({ ok: false, error: "shm_failed", status: claimResult.status });
    }

    const claimJson: any = claimResult.json ?? {};
    const claimData = claimJson?.data && typeof claimJson.data === "object" ? claimJson.data : claimJson;
    const commentWritten = Number(claimData?.comment_written ?? 0) === 1;
    if (commentWritten) {
      recordReferralAliasRegistrationForUser(item.alias, claimData?.user_id);
    }

    return reply.send({
      ok: true,
      alias: item.alias,
      linkType: item.link_type,
      commentWritten: commentWritten ? 1 : 0,
      userId: Number(claimData?.user_id ?? 0) || 0,
    });
  });

  app.get("/referrals/resolve", async (req, reply) => {
    const alias = String((req.query as any)?.alias ?? "").trim().toLowerCase();
    if (!isValidReferralAlias(alias)) {
      return reply.code(400).send({ ok: false, error: "invalid_alias" });
    }
    const item = findReferralAlias(alias);
    if (!item) return reply.code(404).send({ ok: false, error: "alias_not_found" });
    recordReferralAliasVisit(alias);

    // Public response deliberately exposes only data needed before registration.
    return reply.send({
      ok: true,
      alias: item.alias,
      linkType: item.link_type,
      partnerId: item.link_type === "partner" ? item.partner_id : 0,
    });
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
