import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    // Route pages are already lazy-split (see routes/router.tsx). The remaining win is
    // pulling framework/vendor code that changes far less often than app code into its
    // own chunk, so a redeploy only invalidates the small app chunk in returning users'
    // caches — the big react-vendor chunk stays cache-hit on every subsequent visit.
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (/[\\/]node_modules[\\/](react|react-dom|react-router-dom)[\\/]/.test(id)) {
              return 'react-vendor';
            }
            if (id.includes('socket.io-client')) {
              return 'realtime-vendor';
            }
          }
          return undefined;
        },
      },
    },
    // Silences the default 500kB warning for the react-vendor chunk above — it's an
    // expected, cacheable split, not a signal of an unsplit monolith bundle.
    chunkSizeWarningLimit: 700,
  },
  esbuild: {
    // Strip console/debugger statements from the production bundle — smaller parse/exec
    // payload shipped to every dashboard visitor, zero effect on dev (`vite build` only).
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
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
})
