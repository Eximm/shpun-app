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
      // Мы используем свой SW (src/sw.ts) и Workbox injectManifest
      strategies: "injectManifest",
      srcDir: "src",

      // ВАЖНО: исходник SW
      filename: "sw.ts",

      // ВАЖНО: итоговый файл на проде должен быть /sw.js
      injectManifest: {
        swDest: "sw.js",
      },

      // SW регистрируешь сам в коде — оставляем null
      injectRegister: null,

      // Для Telegram лучше autoUpdate, а не prompt
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
        description: "Shpun SDN System — кабинет, баланс, услуги и управление подпиской.",

        start_url: "/",
        id: "/",
        scope: "/",

        display: "standalone",
        background_color: "#0b0f17",
        theme_color: "#0b1220",
        lang: "ru",

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

      workbox: {
        cleanupOutdatedCaches: true,
      },

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