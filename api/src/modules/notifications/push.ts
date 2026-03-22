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

function safeJsonPreview(v: any, maxLen = 1200): string {
  try {
    const s = JSON.stringify(v);
    if (!s) return "";
    return s.length > maxLen ? `${s.slice(0, maxLen)}…` : s;
  } catch {
    return "[unserializable]";
  }
}

function endpointTail(endpoint: string, n = 28) {
  const s = String(endpoint || "");
  return s.length > n ? "…" + s.slice(-n) : s;
}

export async function pushRoutes(app: FastifyInstance) {
  app.post("/billing/push", async (req, reply) => {
    const secret = envStr("BILLING_PUSH_SECRET", "");

    if (secret) {
      const signRaw = (req.headers as any)["x-shpun-sign"];
      const sign = String(signRaw ?? "").trim();
      if (!sign) {
        console.warn("BILLING_PUSH_REJECT", { reason: "missing_signature" });
        return reply.code(401).send({ ok: false, error: "missing_signature" });
      }
      if (sign !== secret) {
        console.warn("BILLING_PUSH_REJECT", { reason: "bad_signature" });
        return reply.code(401).send({ ok: false, error: "bad_signature" });
      }
    }

    const body = (req.body ?? {}) as BillingPushEvent;
    const formatted = formatIncoming(body);

    console.info("BILLING_PUSH_IN", {
      raw: safeJsonPreview(body),
      formatted: safeJsonPreview(formatted),
    });

    const r = putEvent(formatted);
    if (!r.ok) {
      console.warn("BILLING_PUSH_STORE_FAIL", {
        error: r.error,
        raw: safeJsonPreview(body),
        formatted: safeJsonPreview(formatted),
      });
      return reply.code(400).send({ ok: false, error: r.error });
    }

    const eventId = r.event?.event_id ?? formatted.event_id ?? null;
    const eventTs = r.event?.ts ?? formatted.ts ?? null;
    const uid = Number((r.event as any)?.user_id ?? 0);
    const wantsPush = parseBool((body as any)?.push ?? (formatted as any)?.push);
    const broadcast = isBroadcastEvent(formatted);
    const active = uid > 0 ? isUserActive(uid) : null;

    console.info("BILLING_PUSH_STORED", {
      event_id: eventId,
      ts: eventTs,
      uid,
      type: String(formatted?.type ?? ""),
      target: String((formatted as any)?.target ?? ""),
      dedup: Boolean(r.dedup),
      delivered: r.delivered ?? null,
      wantsPush,
      body_push: (body as any)?.push ?? null,
      formatted_push: (formatted as any)?.push ?? null,
      isBroadcast: broadcast,
      active,
    });

    try {
      if (!wantsPush) {
        console.info("BILLING_PUSH_SKIP", {
          reason: "push_flag_false",
          event_id: eventId,
          uid,
          body_push: (body as any)?.push ?? null,
          formatted_push: (formatted as any)?.push ?? null,
        });
      } else if (uid > 0) {
        if (active) {
          console.info("BILLING_PUSH_SKIP", {
            reason: "user_active",
            event_id: eventId,
            uid,
          });
        } else {
          console.info("BILLING_PUSH_SEND_START", {
            mode: "single",
            event_id: eventId,
            uid,
            type: String(formatted?.type ?? ""),
          });

          const payloadEvent = {
            ...formatted,
            event_id: eventId,
            ts: eventTs,
          };

          const wp = await sendWebPushToUser(uid, payloadEvent);

          console.info("BILLING_PUSH_SEND_RESULT", {
            mode: "single",
            event_id: eventId,
            uid,
            result: wp,
          });
        }
      } else if (broadcast) {
        const rows = stmtListUsersWithPushSubs.all() as Array<{ user_id: number }>;

        console.info("BILLING_PUSH_BROADCAST_START", {
          event_id: eventId,
          type: String(formatted?.type ?? ""),
          candidates: rows.length,
        });

        const payloadEvent = {
          ...formatted,
          event_id: eventId,
          ts: eventTs,
        };

        let totalCandidates = 0;
        let skippedInvalid = 0;
        let skippedActive = 0;
        let attempted = 0;
        let sentUsers = 0;
        let failedUsers = 0;
        let removedSubs = 0;

        for (const row of rows) {
          const targetUid = Number(row.user_id);
          totalCandidates += 1;

          if (!Number.isFinite(targetUid) || targetUid <= 0) {
            skippedInvalid += 1;
            continue;
          }

          if (isUserActive(targetUid)) {
            skippedActive += 1;
            continue;
          }

          attempted += 1;

          try {
            const wp = await sendWebPushToUser(targetUid, payloadEvent);

            if (wp?.ok) {
              if (Number(wp?.sent ?? 0) > 0) sentUsers += 1;
              if (Number(wp?.failed ?? 0) > 0 && Number(wp?.sent ?? 0) <= 0) failedUsers += 1;
              removedSubs += Number(wp?.removed ?? 0) || 0;
            }

            console.info("BILLING_PUSH_BROADCAST_USER_RESULT", {
              event_id: eventId,
              targetUid,
              result: wp,
            });
          } catch (e: any) {
            failedUsers += 1;
            console.warn("BILLING_PUSH_BROADCAST_USER_FAIL", {
              event_id: eventId,
              targetUid,
              msg: String(e?.message || e || ""),
            });
          }
        }

        console.info("BILLING_PUSH_BROADCAST_DONE", {
          event_id: eventId,
          totalCandidates,
          skippedInvalid,
          skippedActive,
          attempted,
          sentUsers,
          failedUsers,
          removedSubs,
        });
      } else {
        console.info("BILLING_PUSH_SKIP", {
          reason: "no_target_user_and_not_broadcast",
          event_id: eventId,
          uid,
          type: String(formatted?.type ?? ""),
          target: String((formatted as any)?.target ?? ""),
        });
      }
    } catch (e: any) {
      console.warn("BILLING_PUSH_HANDLER_FAIL", {
        event_id: eventId,
        uid,
        msg: String(e?.message || e || ""),
        stack: String(e?.stack || ""),
      });
    }

    return reply.send({
      ok: true,
      dedup: r.dedup,
      event_id: eventId,
      ts: eventTs,
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
      console.warn("PUSH_SUBSCRIBE_BAD", {
        uid,
        endpointPresent: Boolean(endpoint),
        p256dhPresent: Boolean(p256dh),
        authPresent: Boolean(auth),
        raw: safeJsonPreview(subBody),
      });
      return reply.code(400).send({ ok: false, error: "bad_subscription" });
    }

    putSubscription(uid, {
      endpoint,
      keys: { p256dh, auth },
      ts: Math.floor(Date.now() / 1000),
    });

    console.info("PUSH_SUBSCRIBE_OK", {
      uid,
      endpoint: endpointTail(endpoint),
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

    console.info("PUSH_UNSUBSCRIBE_OK", {
      uid,
      endpoint: endpoint ? endpointTail(endpoint) : null,
      removeMode: endpoint ? "single" : "all_for_user",
    });

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