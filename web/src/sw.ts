/// <reference lib="webworker" />

import { clientsClaim, skipWaiting } from "workbox-core";
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";

declare let self: ServiceWorkerGlobalScope;

// Быстрее подхватываем новую версию SW без “закройте все вкладки”
skipWaiting();
clientsClaim();

// Workbox injects manifest here
precacheAndRoute(self.__WB_MANIFEST || []);

/**
 * ВАЖНО:
 * Если отдавать navigation (SPA) из precache cache-first,
 * можно получить старый index.html со старыми хэшами ассетов после деплоя.
 *
 * Решение:
 * - navigation: NetworkFirst (в онлайне всегда свежий HTML)
 * - fallback: precached /index.html (для офлайна/плохой сети)
 */
const appShellHandler = createHandlerBoundToURL("/index.html");

const htmlNetworkFirst = new NetworkFirst({
  cacheName: "html-pages",
  networkTimeoutSeconds: 3, // Telegram WebView часто вялый, не ждём бесконечно
});

registerRoute(
  // match: только навигации (переходы по страницам SPA)
  ({ request }) => request.mode === "navigate",
  // handler
  async (opts) => {
    try {
      // opts.event в этом маршруте обычно FetchEvent, но типы Workbox местами “шире”
      const response = await htmlNetworkFirst.handle({
        event: opts.event as FetchEvent,
        request: opts.request,
      });

      if (response) return response;
    } catch {
      // ignore and fallback
    }

    // Фолбэк: прекаченный index.html
    return appShellHandler(opts);
  },
);

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