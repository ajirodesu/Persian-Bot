import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClient } from '@/lib/query-client.lib'
import { reportWebVitalsDev } from '@/lib/web-vitals.lib'
import '@/styles/globals.css'
import { HelmetProvider } from '@dr.pogodin/react-helmet'
import { UserAuthProvider } from '@/contexts/UserAuthContext'
import { SnackbarProvider } from '@/contexts/SnackbarContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import { TimezoneProvider } from '@/contexts/TimezoneContext'
import App from '@/App'

// Dev-only performance telemetry — no-op (and tree-shaken out) in production.
void reportWebVitalsDev()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <HelmetProvider>
        <TimezoneProvider>
          <UserAuthProvider>
            <SnackbarProvider position="bottom-center" defaultDuration={4000}>
              <App />
            </SnackbarProvider>
          </UserAuthProvider>
        </TimezoneProvider>
      </HelmetProvider>
    </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
)
