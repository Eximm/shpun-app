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

function isIOS(): boolean {
  const ua = navigator.userAgent || "";
  // iOS Safari/WebKit (включая iPadOS)
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
}

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
    return { supported: false, permission: "unsupported", hasSubscription: false, standalone };
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
  await apiFetch("/notifications/push/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      endpoint: sub?.endpoint ?? null,
      subscription: sub ?? null,
    }),
  });
}

// Гарантируем регистрацию SW даже если авто-регистрация сломалась
async function ensureServiceWorkerReady(): Promise<ServiceWorkerRegistration> {
  // если уже есть регистрация/контроллер — просто ждём ready
  try {
    const ready = await navigator.serviceWorker.ready;
    if (ready) return ready;
  } catch {
    // ignore
  }

  // пробуем явно зарегистрировать (module -> sw.mjs, fallback -> sw.js)
  let reg: ServiceWorkerRegistration | undefined;

  try {
    reg = await navigator.serviceWorker.register("/sw.mjs", { type: "module" as any });
  } catch {
    // ignore
  }

  if (!reg) {
    reg = await navigator.serviceWorker.register("/sw.js");
  }

  return await navigator.serviceWorker.ready;
}

export async function enablePush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  // iOS: webpush работает только для установленных PWA — сохраняем требование.
  // Android: НЕ блокируем подписку standalone-проверкой (она может ложно возвращать false).
  if (isIOS() && !isStandalonePwa()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await ensureServiceWorkerReady();

  // Уже включено?
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await postSubscribe(existing);
    return true;
  }

  const vapidPublicKey = (import.meta as any).env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) return false;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  await postSubscribe(sub);
  return true;
}

export async function disablePush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  const reg = await ensureServiceWorkerReady();
  const sub = await reg.pushManager.getSubscription();

  if (!sub) {
    try {
      await postUnsubscribe(null);
    } catch {
      // ignore
    }
    return true;
  }

  try {
    await sub.unsubscribe();
  } catch {
    // ignore
  }

  try {
    await postUnsubscribe(sub);
  } catch {
    // ignore
  }

  return true;
}