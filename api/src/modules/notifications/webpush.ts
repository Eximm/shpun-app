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

function shortTitle(ev: any) {
  return String(ev?.meta?.short?.title || ev?.title || "ShpunApp").slice(0, 80);
}

function shortBody(ev: any) {
  return String(ev?.meta?.short?.message || ev?.body || ev?.message || "").slice(0, 160);
}

// Определяем ссылку и urgency по типу события
function resolveEventMeta(ev: any): { link: string; urgency: webpush.Urgency; ttl: number } {
  const type = String(ev?.type || "").trim();

  // Платёжные и балансовые события — высокий приоритет, короткий TTL
  // urgency "high" = доставить немедленно, игнорируя Doze-mode на Android
  if (
    type.startsWith("balance.") ||
    type.startsWith("payment.") ||
    type.startsWith("invoice.")
  ) {
    return { link: "/payments", urgency: "high", ttl: 3600 }; // 1 час
  }

  // Сервисные события — нормальный приоритет
  if (type.startsWith("service.") || type.startsWith("services.")) {
    return { link: "/services", urgency: "normal", ttl: 43200 }; // 12 часов
  }

  // Широковещательные — низкий приоритет, можно подождать
  if (type.startsWith("broadcast.")) {
    return { link: "/feed", urgency: "low", ttl: 86400 }; // 24 часа
  }

  // Всё остальное
  return { link: "/feed", urgency: "normal", ttl: 43200 };
}

// Короткий payload для пуша
function buildPushPayload(ev: any, link: string) {
  const title = shortTitle(ev);
  const body = shortBody(ev);
  const type = String(ev?.type || "").trim();

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

async function sendToSub(sub: PushSub, payload: string, urgency: webpush.Urgency, ttl: number) {
  return webpush.sendNotification(
    {
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
    } as any,
    payload,
    {
      urgency,
      TTL: ttl,
    }
  );
}

export async function sendWebPushToUser(userId: number, formattedEvent: any) {
  if (!ensureVapid()) return { ok: false, error: "vapid_missing" };

  const subs = listSubscriptions(userId);
  if (!subs.length) {
    return { ok: true, sent: 0, failed: 0, removed: 0 };
  }

  const { link, urgency, ttl } = resolveEventMeta(formattedEvent);
  const payload = buildPushPayload(formattedEvent, link);

  let sent = 0;
  let failed = 0;
  let removed = 0;

  for (const sub of subs) {
    const host = endpointHost(sub.endpoint);
    const tail = endpointTail(sub.endpoint);

    try {
      await sendToSub(sub, payload, urgency, ttl);
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