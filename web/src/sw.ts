/// <reference lib="webworker" />
import { clientsClaim } from "workbox-core";
import { precacheAndRoute } from "workbox-precaching";

declare let self: ServiceWorkerGlobalScope;

clientsClaim();

// Workbox injects manifest here
precacheAndRoute(self.__WB_MANIFEST || []);

/* =========================================================
   PUSH HANDLER
   ========================================================= */

self.addEventListener("push", (event) => {
  if (!event.data) return;

  let data: any = {};
  try {
    data = event.data.json();
  } catch {
    return;
  }

  const title = String(data?.title || "ShpunApp").slice(0, 80);
  const body = String(data?.body || "").slice(0, 160);
  const link = data?.data?.link || "/feed";

    const options: NotificationOptions = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    data: { link },
    tag: data?.data?.event_id || undefined,
    silent: false,
    };

  event.waitUntil(self.registration.showNotification(title, options));
});

/* =========================================================
   CLICK HANDLER
   ========================================================= */

self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  const link = event.notification?.data?.link || "/";

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });

      for (const client of allClients) {
        if ("focus" in client) {
          client.postMessage({ type: "NAVIGATE", link });
          return client.focus();
        }
      }

      return self.clients.openWindow(link);
    })(),
  );
});