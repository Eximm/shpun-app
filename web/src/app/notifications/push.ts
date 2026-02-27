import { apiFetch } from "../../shared/api/client";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/\-/g, "+").replace(/_/g, "/");

  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export type PushState = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  hasSubscription: boolean;
  standalone: boolean;
};

export function isStandalonePwa(): boolean {
  try {
    const mm = window.matchMedia?.("(display-mode: standalone)");
    const standalone = Boolean(mm?.matches);
    const iosStandalone = Boolean((navigator as any)?.standalone);
    return standalone || iosStandalone;
  } catch {
    return false;
  }
}

export function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification !== "undefined"
  );
}

export async function getPushState(): Promise<PushState> {
  const supported = isPushSupported();
  const standalone = isStandalonePwa();

  if (!supported) {
    return {
      supported: false,
      permission: "unsupported",
      hasSubscription: false,
      standalone,
    };
  }

  let permission: NotificationPermission | "unsupported" = "unsupported";
  try {
    permission = Notification.permission;
  } catch {
    permission = "unsupported";
  }

  let hasSubscription = false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    hasSubscription = Boolean(sub);
  } catch {
    hasSubscription = false;
  }

  return { supported, permission, hasSubscription, standalone };
}

async function postSubscribe(sub: PushSubscription) {
  await apiFetch("/notifications/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub),
  });
}

async function postUnsubscribe(sub: PushSubscription | null) {
  // IMPORTANT:
  // Не знаем наверняка, что именно ждёт бэк.
  // Поэтому отправляем минимум (endpoint) + сам sub (если есть) — безопасно и удобно.
  await apiFetch("/notifications/push/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: sub?.endpoint ?? null,
      subscription: sub ?? null,
    }),
  });
}

export async function enablePush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  // На iOS WebPush работает только для установленных PWA.
  // На Android тоже логично требовать standalone, чтобы не путать пользователя.
  if (!isStandalonePwa()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.ready;

  // Уже включено?
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    // На всякий случай синхронизируем с сервером
    await postSubscribe(existing);
    return true;
  }

  const vapidPublicKey = (import.meta as any).env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    console.warn("VAPID public key missing");
    return false;
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  await postSubscribe(sub);
  return true;
}

export async function disablePush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();

  // Если подписки нет — всё ок, считаем выключенным
  if (!sub) {
    // синхронизация с сервером “на всякий случай”
    try {
      await postUnsubscribe(null);
    } catch {
      // ignore
    }
    return true;
  }

  // 1) удаляем на устройстве
  let ok = false;
  try {
    ok = await sub.unsubscribe();
  } catch {
    ok = false;
  }

  // 2) удаляем на сервере (даже если unsubscribe вернул false — серверу всё равно лучше сказать)
  try {
    await postUnsubscribe(sub);
  } catch {
    // ignore
  }

  return ok || true;
}