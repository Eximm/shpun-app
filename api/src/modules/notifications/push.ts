import type { FastifyInstance } from "fastify";
import { getSessionFromRequest } from "../../shared/session/sessionStore.js";
import {
  listEvents,
  listFeed,
  listNewsFeed,
  putEvent,
  type BillingPushEvent,
} from "./inbox.js";
import { formatIncoming } from "./format.js";
import { putSubscription, removeSubscription } from "./subscriptions.js";
import { sendWebPushToUser } from "./webpush.js";
import { markUserActive, isUserActive } from "./activity.js";
import { linkDb } from "../../shared/linkdb/db.js";

function envStr(name: string, def = "") {
  const v = String(process.env[name] ?? "").trim();
  return v || def;
}

function parseBool(v: any): boolean {
  const s = String(v ?? "").trim().toLowerCase();
  if (!s) return false;
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

function pickKeys(body: any): { endpoint: string; p256dh: string; auth: string } {
  const root = body ?? {};
  const sub = root?.subscription ?? root;

  const endpoint = String(sub?.endpoint ?? "").trim();

  const keysObj = sub?.keys ?? {};
  const p256dh = String(keysObj?.p256dh ?? sub?.p256dh ?? "").trim();
  const auth = String(keysObj?.auth ?? sub?.auth ?? "").trim();

  return { endpoint, p256dh, auth };
}

function isBroadcastEvent(e: BillingPushEvent): boolean {
  const type = String(e?.type ?? "").trim();
  if (e?.target === "all") return true;
  if (type === "broadcast.news") return true;
  if (type.startsWith("broadcast.")) return true;
  return false;
}

// Только пользователи, у которых есть push subscriptions
const stmtListUsersWithPushSubs = linkDb.prepare(`
  SELECT DISTINCT user_id
  FROM push_subscriptions
  WHERE user_id IS NOT NULL AND user_id > 0
`);

export async function pushRoutes(app: FastifyInstance) {
  // ===== POST /api/billing/push =====
  app.post("/billing/push", async (req, reply) => {
    const secret = envStr("BILLING_PUSH_SECRET", "");

    if (secret) {
      const signRaw = (req.headers as any)["x-shpun-sign"];
      const sign = String(signRaw ?? "").trim();
      if (!sign) return reply.code(401).send({ ok: false, error: "missing_signature" });
      if (sign !== secret) return reply.code(401).send({ ok: false, error: "bad_signature" });
    }

    const body = (req.body ?? {}) as BillingPushEvent;
    const formatted = formatIncoming(body);

    const r = putEvent(formatted);
    if (!r.ok) return reply.code(400).send({ ok: false, error: r.error });

    // ВАЖНО:
    // - если пользователь активен в приложении -> webpush не шлём
    // - если приложение закрыто / inactive -> webpush шлём
    try {
      const uid = Number((r.event as any)?.user_id ?? 0);

      if (uid > 0) {
        if (!isUserActive(uid)) {
          await sendWebPushToUser(uid, r.event ?? formatted);
        }
      } else if (isBroadcastEvent(formatted)) {
        const rows = stmtListUsersWithPushSubs.all() as Array<{ user_id: number }>;
        for (const row of rows) {
          const targetUid = Number(row.user_id);
          if (!Number.isFinite(targetUid) || targetUid <= 0) continue;
          if (isUserActive(targetUid)) continue;

          try {
            await sendWebPushToUser(targetUid, {
              ...formatted,
              user_id: targetUid,
            });
          } catch {
            // ignore per-user push errors
          }
        }
      }
    } catch {
      // ignore push errors
    }

    return reply.send({
      ok: true,
      dedup: r.dedup,
      event_id: r.event?.event_id ?? null,
      ts: r.event?.ts ?? null,
      delivered: r.delivered ?? null,
    });
  });

  // ===== POST /api/notifications/activity =====
  app.post("/notifications/activity", async (req, reply) => {
    const s = getSessionFromRequest(req);
    const uid = s?.userId ? Number(s.userId) : 0;
    if (!uid) return reply.code(401).send({ ok: false, error: "unauthorized" });

    markUserActive(uid);
    return reply.send({ ok: true });
  });

  // ===== POST /api/notifications/push/subscribe =====
  app.post("/notifications/push/subscribe", async (req, reply) => {
    const s = getSessionFromRequest(req);
    const uid = s?.userId ? Number(s.userId) : 0;
    if (!uid) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const subBody = req.body ?? {};
    const { endpoint, p256dh, auth } = pickKeys(subBody);

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
    if (!uid) return reply.code(401).send({ ok: false, error: "unauthorized" });

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
    if (!uid) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const q = (req.query ?? {}) as any;
    const beforeTs = Number(q.beforeTs ?? 0);
    const beforeId = String(q.beforeId ?? "");
    const limit = Number(q.limit ?? 50);
    const onlyNews = parseBool(q.onlyNews);

    const { items, nextBefore } = onlyNews
      ? listNewsFeed({ userId: uid, beforeTs, beforeId, limit })
      : listFeed({ userId: uid, beforeTs, beforeId, limit });

    return reply.send({ ok: true, items, nextBefore });
  });
}