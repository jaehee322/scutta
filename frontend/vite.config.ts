import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      pwaAssets: {
        image: "public/favicon.svg",
        preset: "minimal-2023",
        overrideManifestIcons: true,
      },
      manifest: {
        name: "SCUTTA 경기 기록",
        short_name: "SCUTTA",
        description: "SCUTTA 탁구 동아리 경기 기록과 랭킹",
        theme_color: "#3182f6",
        background_color: "#f2f4f6",
        display: "standalone",
        orientation: "portrait-primary",
        start_url: "/",
        scope: "/",
        lang: "ko-KR",
        categories: ["sports", "lifestyle"],
      },
      workbox: {
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/api\//, /^\/health$/],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
});
