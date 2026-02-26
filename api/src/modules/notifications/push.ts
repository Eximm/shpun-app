import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import { listEvents, listFeed, putEvent, type BillingPushEvent } from "./inbox.js";
import { formatIncoming } from "./format.js";
import { putSubscription, removeSubscription } from "./subscriptions.js";
import { sendWebPushToUser } from "./webpush.js";

function envStr(name: string, def = "") {
  const v = String(process.env[name] ?? "").trim();
  return v || def;
}

export async function pushRoutes(app: FastifyInstance) {
  // ===== POST /api/billing/push =====
  app.post("/billing/push", async (req, reply) => {
    const secret = envStr("BILLING_PUSH_SECRET", "");

    if (secret) {
      const signRaw = (req.headers as any)["x-shpun-sign"];
      const sign = String(signRaw ?? "").trim();

      try {
        req.log.info(
          {
            host: (req.headers as any).host,
            url: (req as any).url,
            hasSign: Boolean(sign),
            signLen: sign.length,
            hdrs: Object.keys(req.headers || {}),
          },
          "billing push auth",
        );
      } catch {
        // ignore
      }

      if (!sign) {
        return reply.code(401).send({ ok: false, error: "missing_signature" });
      }
      if (sign !== secret) {
        return reply.code(401).send({ ok: false, error: "bad_signature" });
      }
    } else {
      try {
        req.log.warn({ hasSecret: false }, "billing push: BILLING_PUSH_SECRET is empty (auth disabled)");
      } catch {
        // ignore
      }
    }

    const body = (req.body ?? {}) as BillingPushEvent;
    const formatted = formatIncoming(body);

    const r = putEvent(formatted);
    if (!r.ok) return reply.code(400).send({ ok: false, error: r.error });

    // webpush only for user events
    try {
      const uid = Number((r.event as any)?.user_id ?? 0);
      if (uid > 0) await sendWebPushToUser(uid, r.event);
    } catch {
      // ignore
    }

    return reply.send({ ok: true, dedup: r.dedup, event_id: r.event.event_id, ts: r.event.ts });
  });

  // ===== POST /api/notifications/push/subscribe =====
  app.post("/notifications/push/subscribe", async (req, reply) => {
    const s = getSessionFromRequest(req);
    const uid = s?.userId ? Number(s.userId) : 0;
    if (!uid) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const sub = (req.body ?? {}) as any;
    const endpoint = String(sub?.endpoint ?? "").trim();
    const p256dh = String(sub?.keys?.p256dh ?? "").trim();
    const auth = String(sub?.keys?.auth ?? "").trim();

    if (!endpoint || !p256dh || !auth) {
      return reply.code(400).send({ ok: false, error: "bad_subscription" });
    }

    putSubscription(uid, {
      endpoint,
      keys: { p256dh, auth },
      ts: Math.floor(Date.now() / 1000),
    });

    return reply.send({ ok: true });
  });

  // ===== POST /api/notifications/push/unsubscribe =====
  app.post("/notifications/push/unsubscribe", async (req, reply) => {
    const s = getSessionFromRequest(req);
    const uid = s?.userId ? Number(s.userId) : 0;
    if (!uid) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const body = (req.body ?? {}) as any;
    const endpoint = String(body?.endpoint ?? "").trim();
    removeSubscription(uid, endpoint || null);

    return reply.send({ ok: true });
  });

  // ===== GET /api/notifications =====
  app.get("/notifications", async (req, reply) => {
    const s = getSessionFromRequest(req);
    const uid = s?.userId ? Number(s.userId) : 0;

    const q = (req.query ?? {}) as any;
    const afterTs = Number(q.afterTs ?? 0);
    const afterId = String(q.afterId ?? "");
    const limit = Number(q.limit ?? 200);

    const { items, nextCursor } = listEvents({ afterTs, afterId, userId: uid, limit });
    return reply.send({ ok: true, items, nextCursor });
  });

  // ===== GET /api/notifications/feed =====
  app.get("/notifications/feed", async (req, reply) => {
    const s = getSessionFromRequest(req);
    const uid = s?.userId ? Number(s.userId) : 0;

    const q = (req.query ?? {}) as any;
    const beforeTs = Number(q.beforeTs ?? 0);
    const beforeId = String(q.beforeId ?? "");
    const limit = Number(q.limit ?? 50);

    const { items, nextBefore } = listFeed({ userId: uid, beforeTs, beforeId, limit });
    return reply.send({ ok: true, items, nextBefore });
  });
}