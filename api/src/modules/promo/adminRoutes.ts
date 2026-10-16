import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { shmShpunAppPromoOpportunities } from "../../shared/shm/shmClient.js";
import { ensureAdmin } from "../admin/routes.js";
import { buildPromotionCatalog } from "./catalog.js";
import {
  getPromotionDisplaySettingsMap,
  isPromotionCampaignId,
  setPromotionDisplaySetting,
} from "./displaySettingsRepo.js";

function isOk(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

async function getAdminSession(req: unknown, reply: any): Promise<string | null> {
  const session = getSessionFromRequest(req as any);
  if (!session?.shmSessionId) {
    reply.code(401).send({ ok: false, error: "not_authenticated" });
    return null;
  }
  if (!(await ensureAdmin(session.shmSessionId))) {
    reply.code(403).send({ ok: false, error: "not_admin" });
    return null;
  }
  return session.shmSessionId;
}

export async function promoAdminRoutes(app: FastifyInstance) {
  app.get("/admin/promo-catalog", async (req, reply) => {
    const shmSessionId = await getAdminSession(req, reply);
    if (!shmSessionId) return;

    const result = await shmShpunAppPromoOpportunities(shmSessionId);
    const billing = result.json ?? {};
    if (!result.ok || !isOk((billing as any)?.ok)) {
      return reply.code(502).send({
        ok: false,
        error: "promo_catalog_failed",
        message: "Не удалось обновить каталог акций из биллинга.",
      });
    }

    return reply.send({
      ok: true,
      source: "billing",
      scannedAt: new Date().toISOString(),
      items: buildPromotionCatalog(billing, getPromotionDisplaySettingsMap()),
    });
  });

  app.patch("/admin/promo-catalog/:campaignId", async (req, reply) => {
    const shmSessionId = await getAdminSession(req, reply);
    if (!shmSessionId) return;

    const campaignId = String((req.params as any)?.campaignId ?? "");
    if (!isPromotionCampaignId(campaignId)) {
      return reply.code(404).send({ ok: false, error: "campaign_not_found" });
    }

    const body = (req.body ?? {}) as Record<string, unknown>;
    if (typeof body.enabled !== "boolean") {
      return reply.code(400).send({ ok: false, error: "enabled_required" });
    }
    const priority = Number(body.priority);
    if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
      return reply.code(400).send({ ok: false, error: "bad_priority" });
    }

    return reply.send({
      ok: true,
      setting: setPromotionDisplaySetting(campaignId, { enabled: body.enabled, priority }),
    });
  });
}
