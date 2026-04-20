/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute, NavigationRoute } from "workbox-routing";
import { createHandlerBoundToURL } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope;

clientsClaim();
self.skipWaiting();

/* ===============================
   Precache
================================ */

precacheAndRoute(self.__WB_MANIFEST || []);

/* ===============================
   SPA navigation fallback
================================ */

const handler = createHandlerBoundToURL("/index.html");

const navigationRoute = new NavigationRoute(handler, {
  denylist: [/^\/api\//],
});

registerRoute(navigationRoute);

/* ===============================
   Push
================================ */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload: any = {};

  try {
    payload = event.data.json();
  } catch {
    payload = { body: event.data.text() };
  }

  const title = payload.title || "ShpunApp";
  const body = payload.body || "";

  const options: NotificationOptions = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
    data: payload.data || {},
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* ===============================
   Notification click
================================ */

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const link = event.notification.data?.link || "/";

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        for (const client of clients) {
          if ("focus" in client) {
            // Ждём navigate перед focus — иначе focus может отработать
            // до завершения навигации и страница не откроется корректно
            await client.navigate(link);
            return client.focus();
          }
        }
        return self.clients.openWindow(link);
      })
  );
});

/* ===============================
   Push subscription change
================================ */

// Браузер (Firefox, Safari 16.4+) может принудительно обновить подписку.
// Без этого обработчика новая подписка не попадает на сервер
// и пуши молча перестают приходить до следующего ручного включения.
self.addEventListener("pushsubscriptionchange", (event: any) => {
  const resubscribe = async () => {
    const subscription = await self.registration.pushManager.subscribe(
      event.oldSubscription?.options ?? {
        userVisibleOnly: true,
        // applicationServerKey берётся из старой подписки — ключ не меняется
        applicationServerKey: event.oldSubscription?.options?.applicationServerKey,
      }
    );

    // Отправляем новую подписку на сервер
    await fetch("/api/notifications/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // credentials нужны чтобы передать сессионную куку
      credentials: "include",
      body: JSON.stringify(
        typeof subscription.toJSON === "function"
          ? subscription.toJSON()
          : subscription
      ),
    });
  };

  event.waitUntil(resubscribe());
});