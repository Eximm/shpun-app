/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";

declare let self: ServiceWorkerGlobalScope;

clientsClaim();

// Workbox injects manifest here
precacheAndRoute(self.__WB_MANIFEST || []);

/**
 * Fix for "stuck old index.html" after deploy:
 * - navigation requests must be NetworkFirst (not cache-first from precache)
 * - fallback to precached /index.html if network fails
 */
const appShellHandler = createHandlerBoundToURL("/index.html");

const htmlNetworkFirst = new NetworkFirst({
  cacheName: "html-pages",
  networkTimeoutSeconds: 3,
});

registerRoute(
  ({ request, url }) => {
    if (request.mode !== "navigate") return false;
    if (url.pathname.startsWith("/api/")) return false;
    if (url.pathname.startsWith("/assets/")) return false;
    if (url.pathname.startsWith("/icons/")) return false;
    return true;
  },
  async ({ event, request, url }) => {
    try {
      const response = await htmlNetworkFirst.handle({
        event: event as FetchEvent,
        request,
      });
      if (response) return response;
    } catch {
      // ignore
    }

    // IMPORTANT: appShellHandler expects RouteHandlerCallbackOptions, including `url`
    return appShellHandler({ event, request, url } as any);
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

  // link must always be a string (avoid objects/null)
  const linkRaw = data?.data?.link;
  const link = typeof linkRaw === "string" && linkRaw.length ? linkRaw : "/feed";

  /**
   * Android/Chrome:
   * - `badge` is commonly used as the small status-bar icon.
   * - It must be a simple monochrome (white) shape on transparent background.
   */
  const options: NotificationOptions = {
    body,
    icon: "/icons/icon-192.png",
    badge: "/icons/badge-96.png",
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