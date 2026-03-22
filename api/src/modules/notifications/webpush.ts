// FILE: api/src/modules/notifications/webpush.ts
import webpush from "web-push";
import { listSubscriptions, removeSubscription, type PushSub } from "./subscriptions.js";

function envStr(name: string, def = "") {
  const v = String(process.env[name] ?? "").trim();
  return v || def;
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
  return true;
}

// короткий payload
function buildPushPayload(ev: any) {
  const title = String(ev?.title || "ShpunApp").slice(0, 80);
  const body = String(ev?.body ?? ev?.message ?? "").slice(0, 160);
  const type = String(ev?.type || "").trim();

  let link = "/feed";
  if (type.startsWith("balance.") || type.startsWith("payment.") || type.startsWith("invoice.")) link = "/payments";
  else if (type.startsWith("service.") || type.startsWith("services.")) link = "/services";
  else if (type.startsWith("broadcast.")) link = "/feed";

  return JSON.stringify({
    title,
    body,
    data: {
      link,
      event_id: ev?.event_id ?? null,
      type,
      ts: ev?.ts ?? null,
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

function endpointTail(endpoint: string, n = 28) {
  const s = String(endpoint || "");
  return s.length > n ? "…" + s.slice(-n) : s;
}

async function sendToSub(sub: PushSub, payload: string) {
  return webpush.sendNotification(
    {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    } as any,
    payload
  );
}

export async function sendWebPushToUser(userId: number, formattedEvent: any) {
  if (!ensureVapid()) return { ok: false, error: "vapid_missing" };

  const subs = listSubscriptions(userId);
  if (!subs.length) {
    return { ok: true, sent: 0, failed: 0, removed: 0 };
  }

  const payload = buildPushPayload(formattedEvent);

  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const sub of subs) {
    const host = endpointHost(sub.endpoint);
    const tail = endpointTail(sub.endpoint);

    try {
      await sendToSub(sub, payload);
      sent += 1;
    } catch (e: any) {
      const code = Number(e?.statusCode || e?.status || 0);
      const msg = String(e?.message || "");

      console.warn("WEBPUSH_FAIL", {
        userId,
        host,
        endpoint: tail,
        code,
        msg,
      });

      if (code === 404 || code === 410) {
        try {
          removeSubscription(userId, sub.endpoint);
          removed += 1;
          console.warn("WEBPUSH_SUB_REMOVED", {
            userId,
            host,
            endpoint: tail,
            code,
          });
        } catch (rmErr: any) {
          console.warn("WEBPUSH_SUB_REMOVE_FAIL", {
            userId,
            host,
            endpoint: tail,
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