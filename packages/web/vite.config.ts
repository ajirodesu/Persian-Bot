import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

// Resolve the cat-bot API origin for the dev proxy from the backend's own
// .env, so the proxy always follows wherever the API actually listens
// (default 3000 per packages/cat-bot/src/engine/config/env.config.ts).
function resolveApiTarget(): string {
  const fallback = 'http://localhost:3000'
  try {
    const envFile = readFileSync(
      fileURLToPath(new URL('../cat-bot/.env', import.meta.url)),
      'utf8',
    )
    const portLine = envFile
      .split(/\r?\n/)
      .find((line) => /^\s*PORT\s*=/.test(line))
    const port = portLine?.split('=')[1]?.trim().replace(/^["']|["']$/g, '')
    return port ? `http://localhost:${port}` : fallback
  } catch {
    return fallback
  }
}

const apiTarget = resolveApiTarget()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: '0.0.0.0',
    // MUST differ from the backend's PORT — both previously used 5000, so
    // whichever process booted second died with EADDRINUSE (the bot exits,
    // killing the whole API) and the dashboard showed "500 Something went
    // wrong". 5173 is Vite's standard dev port; the backend keeps its own.
    port: 5173,
    allowedHosts: true,
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
      '/socket.io': {
        target: apiTarget,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
