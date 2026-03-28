import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  plugins:[
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets:['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
      manifest: {
        name: 'MySmart Grocery Hub',
        short_name: 'Grocery Hub',
        description: 'Η premium λίστα για τα ψώνια σου με AI',
        theme_color: '#111827',
        background_color: '#fdfbfb',
        display: 'standalone', // Αυτό κρύβει τον browser (URL bar) και το κάνει να μοιάζει με κανονικό App!
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
      workbox: {
        // Η ΣΤΡΑΤΗΓΙΚΗ ΓΙΑ ΤΟ OFFLINE MODE
        runtimeCaching:[
          {
            // Κρατάμε τα Google Fonts για να μην σπάει η γραμματοσειρά χωρίς ίντερνετ
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: { maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 } // 1 χρόνος
            }
          },
          {
            // Εδώ είναι η μαγεία: Το API των λιστών μας!
            // NetworkFirst: Αν έχει ίντερνετ, φέρε τα νέα data. Αν δεν έχει, φέρε τα παλιά από την Cache!
            urlPattern: /\/api\/lists/i, // Πιάνει το endpoint ανεξαρτήτως IP/Domain
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-lists-cache',
              networkTimeoutSeconds: 5, // Αν αργήσει πάνω από 5 δευτερόλεπτα (κακό σήμα), δείξε την Cache
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 } // 24 ώρες
            }
          }
        ]
      }
    })
  ]
})