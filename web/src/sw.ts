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
    badge: "/icons/icon-192.png",
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
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ("focus" in client) {
          client.navigate(link);
          return client.focus();
        }
      }
      return self.clients.openWindow(link);
    })
  );
});