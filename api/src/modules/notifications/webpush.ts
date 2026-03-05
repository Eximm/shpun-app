// FILE: api/src/modules/notifications/webpush.ts
import webpush from "web-push";
import { listSubscriptions, removeSubscription, type PushSub } from "./subscriptions.js";

function envStr(name: string, def = "") {
  const v = String(process.env[name] ?? "").trim();
  return v || def;
}

function envBool(name: string, def = false) {
  const v = String(process.env[name] ?? "").trim().toLowerCase();
  if (!v) return def;
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

let vapidConfigured = false;
let vapidOk = false;

function ensureVapid(): boolean {
  if (vapidConfigured) return vapidOk;

  const pub = envStr("VAPID_PUBLIC_KEY", "");
  const priv = envStr("VAPID_PRIVATE_KEY", "");
  const subj = envStr("VAPID_SUBJECT", "mailto:support@shpyn.online");

  if (!pub || !priv) {
    console.warn("WEBPUSH_VAPID_MISSING", {
      hasPub: Boolean(pub),
      hasPriv: Boolean(priv),
      subj,
    });
    vapidConfigured = true;
    vapidOk = false;
    return false;
  }

  webpush.setVapidDetails(subj, pub, priv);
  vapidConfigured = true;
  vapidOk = true;
  console.info("WEBPUSH_VAPID_OK", { subj });
  return true;
}

function safeStr(v: unknown, max: number) {
  return String(v ?? "").slice(0, max);
}

function buildLinkByType(type: string): string {
  if (type.startsWith("balance.") || type.startsWith("payment.") || type.startsWith("invoice.")) return "/payments";
  if (type.startsWith("service.") || type.startsWith("services.")) return "/services";
  if (type.startsWith("broadcast.")) return "/feed";
  return "/feed";
}

/**
 * Payload должен соответствовать web/src/sw.ts:
 * - title/body
 * - data.link для перехода по клику
 */
function buildPushPayload(ev: any) {
  const title = safeStr(ev?.title || "ShpunApp", 80);
  const body = safeStr(ev?.body ?? ev?.message ?? "", 160);

  const type = safeStr(ev?.type || "", 64).trim();
  const eventId = ev?.event_id ?? null;
  const ts = ev?.ts ?? null;

  const link = buildLinkByType(type);

  // tag полезен для дедуп на стороне Notification (если добавим в SW позже)
  const tag = safeStr(type || "event", 64) + ":" + safeStr(eventId ?? "na", 64);

  return JSON.stringify({
    title,
    body,
    // можно расширять без ломания SW
    data: {
      link,
      tag,
      event_id: eventId,
      type,
      ts,
    },
  });
}

function endpointHost(endpoint: string) {
  try {
    return new URL(endpoint).host;
  } catch {
    return "bad-endpoint";
  }
}

async function sendToSub(sub: PushSub, payload: string) {
  // web-push поддерживает options третьим аргументом
  // TTL: 1 день, Urgency: normal (можно менять позже, когда увидим типы событий)
  return webpush.sendNotification(
    {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    } as any,
    payload,
    {
      TTL: 24 * 60 * 60,
      headers: {
        Urgency: "normal",
      },
    } as any,
  );
}

export async function sendWebPushToUser(userId: number, formattedEvent: any) {
  if (!ensureVapid()) return { ok: false, error: "vapid_missing" };

  const subs = listSubscriptions(userId);
  if (!subs.length) return { ok: true, sent: 0, failed: 0, removed: 0 };

  const payload = buildPushPayload(formattedEvent);

  const debugOk = envBool("WEBPUSH_DEBUG_OK", false);

  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const sub of subs) {
    const host = endpointHost(sub.endpoint);

    try {
      const res: any = await sendToSub(sub, payload);
      const statusCode = Number(res?.statusCode ?? 0);

      if (debugOk) console.info("WEBPUSH_OK", { userId, host, statusCode });
      sent += 1;
    } catch (e: any) {
      const code = Number(e?.statusCode || e?.status || 0);
      const msg = String(e?.message || "");
      console.warn("WEBPUSH_FAIL", { userId, host, code, msg });

      // 404/410 => подписка умерла, удаляем
      if (code === 404 || code === 410) {
        try {
          removeSubscription(userId, sub.endpoint);
          removed += 1;
          console.warn("WEBPUSH_SUB_REMOVED", { userId, host, code });
        } catch (rmErr: any) {
          console.warn("WEBPUSH_SUB_REMOVE_FAIL", {
            userId,
            host,
            code,
            msg: String(rmErr?.message || rmErr || ""),
          });
        }
      }

      failed += 1;
    }
  }

  return { ok: true, sent, failed, removed };
}