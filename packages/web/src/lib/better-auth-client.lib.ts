/**
 * Authentication Client
 *
 * No explicit baseURL is set here. In development, Vite's server.proxy (vite.config.ts)
 * forwards /api/* requests to the Express server at http://localhost:3000, making auth
 * requests appear same-origin — no CORS preflight, no cross-port cookie issues.
 *
 * In production, deploy the web app and API behind the same origin (same domain/reverse-proxy)
 * so same-origin behaviour holds without any additional configuration.
 *
 * If you need to target a separate API domain, set VITE_SERVER_URL in .env and uncomment
 * the baseURL line below.
 */
import { createAuthClient } from 'better-auth/react'

export const authUserClient = createAuthClient({
  // baseURL: import.meta.env['VITE_SERVER_URL'] as string,
  fetchOptions: {
    // Include cookies on every request so the session token travels with auth calls
    credentials: 'include',
    onError(context: { error: Error; response?: Response }) {
      // 401 on the session probe means "signed out", which is a normal state
      // on public pages. Anything else is genuinely unexpected.
      if (context.response?.status === 401) return
      console.warn('Auth request failed:', context.error)
    },
  },
})
