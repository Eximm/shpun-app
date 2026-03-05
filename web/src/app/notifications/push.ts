// FILE: web/src/app/notifications/push.ts
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

const LS_DISABLED = "push_disabled_by_user";

function isIOS(): boolean {
  const ua = navigator.userAgent || "";
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1)
  );
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

export function isPushDisabledByUser(): boolean {
  try {
    return localStorage.getItem(LS_DISABLED) === "1";
  } catch {
    return false;
  }
}

export function setPushDisabledByUser(disabled: boolean) {
  try {
    if (disabled) localStorage.setItem(LS_DISABLED, "1");
    else localStorage.removeItem(LS_DISABLED);
  } catch {
    // ignore
  }
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

function subToJson(sub: PushSubscription): any {
  try {
    // @ts-ignore
    if (typeof sub.toJSON === "function") return sub.toJSON();
  } catch {
    // ignore
  }
  return sub as any;
}

function normalizeEndpoint(endpoint: unknown): string | null {
  const s = String(endpoint ?? "").trim();
  return s ? s : null;
}

async function postSubscribe(sub: PushSubscription) {
  await apiFetch("/notifications/push/subscribe", {
    method: "POST",
    body: subToJson(sub),
  });
}

async function postUnsubscribe(endpoint: string | null) {
  await apiFetch("/notifications/push/unsubscribe", {
    method: "POST",
    body: { endpoint: endpoint ?? null },
  });
}

/**
 * Мы НЕ регистрируем SW вручную: он регистрируется централизованно через virtual:pwa-register.
 * Здесь только ждём готовность.
 */
async function ensureServiceWorkerReady(): Promise<ServiceWorkerRegistration> {
  return await navigator.serviceWorker.ready;
}

function getVapidPublicKeyFromEnv(): string | null {
  const k = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY;
  const s = String(k ?? "").trim();
  return s ? s : null;
}

async function subscribeAndSync(reg: ServiceWorkerRegistration): Promise<boolean> {
  // 1) если подписка уже есть — просто синхронизируем на сервер
  const existing = await reg.pushManager.getSubscription();
  if (existing) {
    await postSubscribe(existing);
    return true;
  }

  // 2) новая подписка
  const vapidPublicKey = getVapidPublicKeyFromEnv();
  if (!vapidPublicKey) return false;

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  await postSubscribe(sub);
  return true;
}

/**
 * Автовосстановление подписки БЕЗ запроса permission.
 * Безопасно вызывать из useEffect/хуков.
 */
export async function ensurePushSubscribed(): Promise<boolean> {
  if (!isPushSupported()) return false;

  // уважать ручное выключение
  if (isPushDisabledByUser()) return false;

  // iOS: только установленная PWA
  if (isIOS() && !isStandalonePwa()) return false;

  // без prompt
  if (Notification.permission !== "granted") return false;

  const reg = await ensureServiceWorkerReady();
  return await subscribeAndSync(reg);
}

/**
 * Включение пушей ПО КНОПКЕ (user gesture).
 */
export async function enablePushByUserGesture(): Promise<boolean> {
  if (!isPushSupported()) return false;

  // iOS: только установленная PWA
  if (isIOS() && !isStandalonePwa()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  setPushDisabledByUser(false);

  const reg = await ensureServiceWorkerReady();
  return await subscribeAndSync(reg);
}

export const enablePush = enablePushByUserGesture;

export async function disablePush(): Promise<boolean> {
  if (!isPushSupported()) return false;

  setPushDisabledByUser(true);

  let sub: PushSubscription | null = null;
  try {
    const reg = await ensureServiceWorkerReady();
    sub = await reg.pushManager.getSubscription();
  } catch {
    sub = null;
  }

  // даже если локальной подписки нет — серверу полезно знать, что пользователь отключил пуши
  if (!sub) {
    try {
      await postUnsubscribe(null);
    } catch {
      // ignore
    }
    return true;
  }

  const endpoint = normalizeEndpoint(sub.endpoint);

  try {
    await sub.unsubscribe();
  } catch {
    // ignore
  }

  try {
    await postUnsubscribe(endpoint);
  } catch {
    // ignore
  }

  return true;
}