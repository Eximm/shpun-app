// web/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  // безопасно для CF + поддоменов
  base: "/",

  // 🔧 очень важно при симптомах Minified React error #310:
  // гарантируем одну копию react/react-dom в бандле
  resolve: {
    dedupe: ["react", "react-dom"],
  },

  // помогает Vite не подтягивать вторые копии react через prebundle
  optimizeDeps: {
    include: ["react", "react-dom"],
  },

  // ✅ включаем sourcemap, чтобы стек показывал src-файлы и строки
  build: {
    sourcemap: true,
  },

  plugins: [
    react(),
    VitePWA({
      // ✅ ВАЖНО: не вшиваем авто-регистрацию SW в HTML
      // (мы зарегистрируем SW вручную и только НЕ в Telegram)
      injectRegister: null,

      // Оставляем стратегию обновления
      registerType: "autoUpdate",

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
    }),
  ],

  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});
