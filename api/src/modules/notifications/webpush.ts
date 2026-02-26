// api/src/modules/notifications/webpush.ts
import webpush from "web-push";
import { listSubscriptions, removeSubscription, type PushSub } from "./subscriptions.js";

function envStr(name: string, def = "") {
  const v = String(process.env[name] ?? "").trim();
  return v || def;
}

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;

  const pub = envStr("VAPID_PUBLIC_KEY", "");
  const priv = envStr("VAPID_PRIVATE_KEY", "");
  const subj = envStr("VAPID_SUBJECT", "mailto:support@shpyn.online");

  if (!pub || !priv) {
    // без VAPID просто ничего не отправим
    vapidConfigured = true;
    return;
  }

  webpush.setVapidDetails(subj, pub, priv);
  vapidConfigured = true;
}

// делаем короткий payload, чтобы notification выглядело аккуратно
function buildPushPayload(ev: any) {
  const title = String(ev?.title || "ShpunApp").slice(0, 80);
  const body = String(ev?.message || "").slice(0, 160);
  const type = String(ev?.type || "").trim();

  // можно сразу класть deep-link, у вас на фронте уже есть eventLink логика —
  // позже синхронизируем её с бэком, а пока сделаем простые правила
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
  ensureVapid();

  const pub = envStr("VAPID_PUBLIC_KEY", "");
  const priv = envStr("VAPID_PRIVATE_KEY", "");
  if (!pub || !priv) return; // тихо игнорим, пока не настроено

  const subs = listSubscriptions(userId);
  if (!subs.length) return;

  const payload = buildPushPayload(formattedEvent);

  for (const sub of subs) {
    try {
      await sendToSub(sub, payload);
    } catch (e: any) {
      const code = Number(e?.statusCode || e?.status || 0);

      // 404/410 => подписка умерла, удаляем
      if (code === 404 || code === 410) {
        removeSubscription(userId, sub.endpoint);
      }
      // остальные ошибки не роняем
    }
  }
}