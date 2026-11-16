import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { ensureAdmin } from "../admin/routes.js";
import { getAppearance, saveAppearance, type AppearanceSettings } from "./repo.js";

export async function appearanceRoutes(app: FastifyInstance, authorize = ensureAdmin) {
  // Only public visual settings, no account or administrative information.
  app.get("/appearance", async (_req, reply) => reply.header("Cache-Control", "no-store").send({ ok: true, settings: getAppearance() }));
  app.put<{ Body: AppearanceSettings }>("/admin/appearance", {
    schema: { body: { type: "object", additionalProperties: false,
      required: ["theme", "effectsEnabled", "gamesEnabled"], properties: {
        theme: { type: "string", enum: ["classic", "neon", "winter"] },
        effectsEnabled: { type: "boolean" }, gamesEnabled: { type: "boolean" },
      } } },
  }, async (req, reply) => {
    const session = getSessionFromRequest(req);
    if (!session?.shmSessionId) return reply.code(401).send({ ok: false, error: "unauthorized" });
    if (!(await authorize(session.shmSessionId))) return reply.code(403).send({ ok: false, error: "not_admin" });
    return reply.send({ ok: true, settings: saveAppearance(req.body) });
  });
}
