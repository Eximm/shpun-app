import { apiFetch } from "../../shared/api/client";

function urlBase64ToUint8Array(base64String: string) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, "+")
    .replace(/_/g, "/");

  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function enablePush() {
  if (!("serviceWorker" in navigator)) return false;
  if (!("PushManager" in window)) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  const reg = await navigator.serviceWorker.ready;

  const vapidPublicKey = (import.meta as any).env.VITE_VAPID_PUBLIC_KEY;
  if (!vapidPublicKey) {
    console.warn("VAPID public key missing");
    return false;
  }

  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
  });

  await apiFetch("/notifications/push/subscribe", {
    method: "POST",
    body: JSON.stringify(sub),
  });

  return true;
}