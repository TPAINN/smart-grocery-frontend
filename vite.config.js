import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',

  build: {
    // Raise chunk-size warning threshold (we'll split manually below)
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // ── React core ───────────────────────────────────────────
          if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/')) {
            return 'vendor-react';
          }
          // ── Socket.IO ────────────────────────────────────────────
          if (id.includes('node_modules/socket.io-client') || id.includes('node_modules/engine.io-client')) {
            return 'vendor-socket';
          }
          // ── Stripe ───────────────────────────────────────────────
          if (id.includes('node_modules/@stripe/')) {
            return 'vendor-stripe';
          }
          // ── Tabler icons ─────────────────────────────────────────
          if (id.includes('node_modules/@tabler/')) {
            return 'vendor-icons';
          }
          // ── Barcode / QR ─────────────────────────────────────────
          if (id.includes('node_modules/html5-qrcode') || id.includes('node_modules/zxing')) {
            return 'vendor-qrcode';
          }
          // ── IndexedDB ────────────────────────────────────────────
          if (id.includes('node_modules/idb')) {
            return 'vendor-idb';
          }
          // ── Workbox / PWA ────────────────────────────────────────
          if (id.includes('node_modules/workbox-')) {
            return 'vendor-pwa';
          }
        },
      },
    },
  },

  plugins:[
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets:['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'Καλαθάκι — Έξυπνα Ψώνια',
        short_name: 'Καλαθάκι',
        description: 'Η premium λίστα για τα ψώνια σου με AI',
        theme_color: '#111827',
        background_color: '#fdfbfb',
        display: 'standalone',
        orientation: 'portrait',
        icons:[
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable'
          }
        ]
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
      },
    })
  ]
})