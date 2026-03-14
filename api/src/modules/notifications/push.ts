// FILE: api/src/modules/notifications/push.ts
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
import {
  deleteBroadcastByOriginId,
  listBroadcasts,
} from "../../shared/linkdb/notificationsRepo.js";
import { shmShpunAppAdminStatus } from "../../shared/shm/shmClient.js";

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

function isAdminStatusOk(v: any): boolean {
  const json = v?.json ?? {};
  const isAdmin = json?.is_admin;
  if (isAdmin === 1 || isAdmin === "1" || isAdmin === true) return true;

  const role = String(json?.role ?? "").trim().toLowerCase();
  return role === "admin";
}

async function ensureAdmin(req: any, reply: any) {
  const s = getSessionFromRequest(req);
  if (!s?.shmSessionId) {
    reply.code(401).send({ ok: false, error: "unauthorized" });
    return null;
  }

  const adminRes = await shmShpunAppAdminStatus(s.shmSessionId);
  if (!adminRes.ok || !isAdminStatusOk(adminRes)) {
    reply.code(403).send({ ok: false, error: "forbidden" });
    return null;
  }

  return s;
}

const stmtListUsersWithPushSubs = linkDb.prepare(`
  SELECT DISTINCT user_id
  FROM push_subscriptions
  WHERE user_id IS NOT NULL AND user_id > 0
`);

export async function pushRoutes(app: FastifyInstance) {
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
            // ignore
          }
        }
      }
    } catch {
      // ignore
    }

    return reply.send({
      ok: true,
      dedup: r.dedup,
      event_id: r.event?.event_id ?? null,
      ts: r.event?.ts ?? null,
      delivered: r.delivered ?? null,
    });
  });

  app.get("/admin/broadcasts", async (req, reply) => {
    const s = await ensureAdmin(req, reply);
    if (!s) return;

    const q = (req.query ?? {}) as any;
    const limit = Number(q.limit ?? 200);
    const { items } = listBroadcasts({ limit });

    return reply.send({ ok: true, items });
  });

  app.delete("/admin/broadcast/:originId", async (req, reply) => {
    const s = await ensureAdmin(req, reply);
    if (!s) return;

    const params = (req.params ?? {}) as any;
    const originId = String(params.originId ?? "").trim();
    if (!originId) {
      return reply.code(400).send({ ok: false, error: "missing_origin_id" });
    }

    const del = deleteBroadcastByOriginId(originId);
    if (!del.ok) {
      return reply.code(500).send({ ok: false, error: del.error });
    }

    return reply.send({
      ok: true,
      originId,
      deleted: del.deleted,
    });
  });

  app.post("/notifications/activity", async (req, reply) => {
    const s = getSessionFromRequest(req);
    const uid = s?.userId ? Number(s.userId) : 0;
    if (!uid) return reply.code(401).send({ ok: false, error: "unauthorized" });

    markUserActive(uid);
    return reply.send({ ok: true });
  });

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

  app.post("/notifications/push/unsubscribe", async (req, reply) => {
    const s = getSessionFromRequest(req);
    const uid = s?.userId ? Number(s.userId) : 0;
    if (!uid) return reply.code(401).send({ ok: false, error: "unauthorized" });

    const body = (req.body ?? {}) as any;
    const endpoint = String(body?.endpoint ?? "").trim();

    removeSubscription(uid, endpoint || null);

    return reply.send({ ok: true });
  });

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