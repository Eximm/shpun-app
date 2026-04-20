// web/vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  base: "/",

  resolve: { dedupe: ["react", "react-dom"] },
  optimizeDeps: { include: ["react", "react-dom"] },

  build: { sourcemap: false, minify: "esbuild" },

  plugins: [
    react(),
    VitePWA({
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",

      // injectRegister: null — SW регистрируется вручную в main.tsx
      // через virtual:pwa-register. registerType убран: он применяется
      // только при автоматической регистрации (injectRegister: 'auto'|'script').
      injectRegister: null,

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

      workbox: { cleanupOutdatedCaches: true },

      devOptions: {
        enabled: process.env.NODE_ENV !== "production",
        type: "module",
      },
    }),
  ],

  server: {
    proxy: {
      "/api": "http://localhost:3000",
    },
  },
});