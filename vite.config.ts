import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  server: {
    host: "::",
    port: 8080,
    // Fail loudly if 8080 is taken instead of silently drifting to 8081/8082.
    // A leftover dev server on 8080 was causing users to keep opening a STALE
    // dashboard (old code) while the fresh one ran on another port — making
    // fixes appear to do nothing. Strict port surfaces that immediately.
    strictPort: true,
    hmr: {
      overlay: false,
    },
  },
  plugins: [
    react(),
    mode === "development" && componentTagger(),
    VitePWA({
      // Disable the PWA/service worker in local development. A SW has no benefit
      // when running `vite` locally and actively causes harm: it precaches the
      // built app and then serves STALE assets (old JS bundles, and font URLs
      // like /assets/fonts/Inter-*.woff2 that a past build referenced) — which
      // is why pulled fixes appeared not to take and the console filled with
      // font decode errors. PWA is enabled only for production builds.
      disable: mode === 'development',
      devOptions: { enabled: false },
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'TradingCore',
        short_name: 'TradingCore',
        description: 'Professional autonomous trading system for Gate.io',
        theme_color: '#10b981',
        background_color: '#0a0a0f',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.gateio\.ws\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'gate-api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60,
              },
            },
          },
        ],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
