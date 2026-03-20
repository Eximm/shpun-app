import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import {
  shmShpunAppAdminSettingsGet,
  shmShpunAppAdminSettingsSet,
  shmShpunAppAdminStatus,
} from "../../shared/shm/shmClient.js";

async function ensureAdmin(shmSessionId: string) {
  const r = await shmShpunAppAdminStatus(shmSessionId);
  const isAdmin = r.ok && (r.json?.is_admin === 1 || r.json?.is_admin === true);
  return isAdmin;
}

export async function adminRoutes(app: FastifyInstance) {
  app.get("/admin/settings", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const r = await shmShpunAppAdminSettingsGet(s.shmSessionId);

    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "shm_error" });
    }

    return reply.send(r.json);
  });

  app.put("/admin/settings/order-rules", async (req, reply) => {
    const s = getSessionFromRequest(req);
    if (!s?.shmSessionId) return reply.code(401).send({ ok: false });

    if (!(await ensureAdmin(s.shmSessionId))) {
      return reply.code(403).send({ ok: false, error: "not_admin" });
    }

    const mode = (req.body as any)?.orderBlockMode;

    const r = await shmShpunAppAdminSettingsSet(s.shmSessionId, mode);

    if (!r.ok) {
      return reply.code(502).send({ ok: false, error: "shm_error" });
    }

    return reply.send(r.json);
  });
}