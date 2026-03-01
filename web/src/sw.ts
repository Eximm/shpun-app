/// <reference lib="webworker" />

import { clientsClaim } from "workbox-core";
import { precacheAndRoute, createHandlerBoundToURL } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst } from "workbox-strategies";

declare let self: ServiceWorkerGlobalScope;

// ✅ IMPORTANT: activate new SW ASAP (avoid waiting forever in Telegram/WebView)
self.skipWaiting();
clientsClaim();

// ✅ Allow virtual:pwa-register -> updateSW(true) to force activation
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

// Workbox injects manifest here
// ✅ Do NOT precache index.html (it's the main source of "week-old app shell")
const manifest = (self.__WB_MANIFEST || []).filter((e: any) => e?.url !== "index.html");
precacheAndRoute(manifest);

/**
 * Fix for "stuck old index.html" after deploy:
 * - navigation requests must be NetworkFirst (not cache-first from precache)
 * - fallback to cached /index.html only if network truly fails
 */
const appShellHandler = createHandlerBoundToURL("/index.html");

const htmlNetworkFirst = new NetworkFirst({
  cacheName: "html-pages",
  // Telegram WebView can be slow; 3s often triggers fallback too early -> "old version"
  networkTimeoutSeconds: 10,
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

    // ✅ Before falling back to cached app-shell, try to get a fresh index.html from network
    try {
      const fresh = await fetch("/index.html", { cache: "no-store" });
      if (fresh) return fresh;
    } catch {
      // ignore
    }

    // Fallback: cached app shell (only when network really fails)
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