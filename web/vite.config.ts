// web/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/",

  resolve: {
    dedupe: ["react", "react-dom"],
  },

  optimizeDeps: {
    include: ["react", "react-dom"],
  },

  build: {
    sourcemap: false,
    minify: "esbuild",
  },

  plugins: [
    react(),
    VitePWA({
      // Мы регистрируем SW сами через virtual:pwa-register в main.tsx
      injectRegister: null,

      // Обновления SW — через ваш UI/логику (prompt)
      registerType: "prompt",

      includeAssets: [
        "icons/icon-192.png",
        "icons/icon-512.png",
        "icons/icon-512-maskable.png",
        "icons/apple-touch-icon.png",
      ],

      manifest: {
        name: "ShpunApp",
        short_name: "ShpunApp",
        description:
          "Shpun SDN System — кабинет, баланс, услуги и управление подпиской.",
        start_url: "/app",
        scope: "/",
        display: "standalone",
        background_color: "#0b0f17",
        theme_color: "#0b1220",
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icons/icon-512-maskable.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },

      // ✅ КЛЮЧЕВОЕ: SW не должен перехватывать /api/*
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/shm\//, /^\/\.well-known\//],

        // более "чистое" поведение при обновлениях
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },

      // dev: не включаем PWA, чтобы не ловить "призраков" кэша при разработке
      devOptions: {
        enabled: false,
      },
    }),
  ],

  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
