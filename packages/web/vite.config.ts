import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Offline shell: precaches the app shell + hashed static assets so
    // repeat visits and offline loads render instantly. autoUpdate
    // (skipWaiting + clientsClaim) means a new deploy takes over on next
    // navigation — users can never stick on a stale version.
    // Deliberately NO runtime caching for /api or socket traffic:
    // every API response is authenticated per-user data.
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: { enabled: false },
      workbox: {
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,woff2,svg}'],
      },
      manifest: {
        name: 'Cat-Bot',
        short_name: 'Cat-Bot',
        start_url: '/',
        display: 'standalone',
        background_color: '#0b0e11',
        theme_color: '#0b0e11',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 5000,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Stable vendor chunks: framework + realtime + auth + query code
        // changes rarely, so repeat visits revalidate only the small app
        // chunks while vendors serve from the HTTP cache. All load in
        // parallel with the entry on cold boot. Function form (matched on
        // the module path) is what this Vite version's types accept.
        manualChunks: (id: string): string | undefined => {
          if (!id.includes('node_modules')) return undefined
          if (
            id.includes('node_modules/react/') ||
            id.includes('node_modules/react-dom/') ||
            id.includes('node_modules/react-router') ||
            id.includes('node_modules/scheduler/')
          ) {
            return 'react-vendor'
          }
          if (
            id.includes('node_modules/socket.io-client/') ||
            id.includes('node_modules/engine.io-client/') ||
            id.includes('node_modules/engine.io-parser/') ||
            id.includes('node_modules/socket.io-parser/')
          ) {
            return 'socket-vendor'
          }
          if (
            id.includes('node_modules/better-auth/') ||
            id.includes('node_modules/better-call/')
          ) {
            return 'auth-vendor'
          }
          if (id.includes('node_modules/@tanstack/react-query/')) {
            return 'query-vendor'
          }
          return undefined
        },
      },
    },
  },
})
