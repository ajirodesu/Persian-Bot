import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client.lib'
import {
  restoreQueryCache,
  startQueryCachePersistence,
} from '@/lib/query-persistence.lib'
import { reportWebVitalsDev } from '@/lib/web-vitals.lib'
import '@/styles/globals.css'
import { HelmetProvider } from '@dr.pogodin/react-helmet'
import { UserAuthProvider } from '@/contexts/UserAuthContext'
import { ConnectivityProvider } from '@/contexts/ConnectivityContext'
import { SnackbarProvider } from '@/contexts/SnackbarContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TimezoneProvider } from '@/contexts/TimezoneContext'
import GlobalErrorBridge from '@/components/GlobalErrorBridge'
import App from '@/App'

// Hydrate the last known dashboard state before the first render, so a
// backend outage on reload paints real data instead of skeletons.
restoreQueryCache(queryClient)
startQueryCachePersistence(queryClient)

// Dev-only performance telemetry — no-op (and tree-shaken out) in production.
void reportWebVitalsDev()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ConnectivityProvider>
        <ThemeProvider>
          <HelmetProvider>
            <UserAuthProvider>
              <TimezoneProvider>
                <SnackbarProvider
                  position="bottom-center"
                  defaultDuration={4000}
                >
                  <GlobalErrorBridge />
                  <App />
                </SnackbarProvider>
              </TimezoneProvider>
            </UserAuthProvider>
          </HelmetProvider>
        </ThemeProvider>
      </ConnectivityProvider>
    </QueryClientProvider>
  </StrictMode>,
)
