import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@/styles/globals.css'
import { HelmetProvider } from '@dr.pogodin/react-helmet'
import { UserAuthProvider } from '@/contexts/UserAuthContext'
import { SnackbarProvider } from '@/contexts/SnackbarContext'
import { ThemeProvider } from '@/contexts/ThemeContext'
import App from '@/App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <HelmetProvider>
        <UserAuthProvider>
          <SnackbarProvider position="bottom-center" defaultDuration={4000}>
            <App />
          </SnackbarProvider>
        </UserAuthProvider>
      </HelmetProvider>
    </ThemeProvider>
  </StrictMode>,
)
