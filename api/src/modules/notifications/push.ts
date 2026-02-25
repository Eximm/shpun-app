// api/src/modules/notifications/push.ts
import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { listEvents, listFeed, putEvent, type BillingPushEvent } from "./inbox.js";
import { formatIncoming } from "./format.js";

function envStr(name: string, def = "") {
  const v = String(process.env[name] ?? "").trim();
  return v || def;
}

/**
 * Billing → HTTP PUSH → Shpun App
 * - POST /api/billing/push (unauth, protected by secret header)
 * - GET  /api/notifications (authed, new items after cursor)
 * - GET  /api/notifications/feed (authed, history)
 */
export async function pushRoutes(app: FastifyInstance) {
  // ===== POST /api/billing/push =====
  app.post("/billing/push", async (req, reply) => {
    const secret = envStr("BILLING_PUSH_SECRET", "");
    if (secret) {
      const sign = String(req.headers["x-shpun-sign"] ?? "").trim();
      if (sign !== secret) return reply.code(401).send({ ok: false, error: "bad_signature" });
    }

    const body = (req.body ?? {}) as BillingPushEvent;

    // Форматируем "для людей": короткие title/message, level/toast policy
    const formatted = formatIncoming(body);

    const r = putEvent(formatted);
    if (!r.ok) return reply.code(400).send({ ok: false, error: r.error });
    return reply.send({ ok: true, dedup: r.dedup });
  });

  // ===== GET /api/notifications =====
  // Для глобальных тостов: берём всё, что пришло после cursor (ts)
  app.get("/notifications", async (req, reply) => {
    const s = getSessionFromRequest(req);
    const uid = s?.userId ? Number(s.userId) : 0;

    const q = (req.query ?? {}) as any;
    const afterTs = Number(q.afterTs ?? 0);
    const limit = Number(q.limit ?? 200);

    const { items, nextCursor } = listEvents({ afterTs, userId: uid, limit });
    return reply.send({ ok: true, items, nextCursor });
  });

  // ===== GET /api/notifications/feed =====
  // Для Инфоцентра: история (DESC), с пагинацией "назад"
  app.get("/notifications/feed", async (req, reply) => {
    const s = getSessionFromRequest(req);
    const uid = s?.userId ? Number(s.userId) : 0;

    const q = (req.query ?? {}) as any;
    const beforeTs = Number(q.beforeTs ?? 0);
    const limit = Number(q.limit ?? 50);

    const { items, nextBefore } = listFeed({ userId: uid, beforeTs, limit });
    return reply.send({ ok: true, items, nextBefore });
  });
}