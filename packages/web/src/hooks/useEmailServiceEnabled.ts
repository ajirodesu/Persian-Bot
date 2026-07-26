import { useEffect, useState } from 'react'
import apiClient from '@/lib/api-client.lib'

/**
 * useEmailServiceEnabled
 *
 * Reports whether transactional email (password reset, account verification)
 * is actually deliverable right now.
 *
 * WHY THIS REPLACES `import.meta.env.VITE_EMAIL_SERVICES_ENABLE`:
 * That variable is baked into the web bundle at `npm run build` time. An
 * admin who sets GMAIL_USER/GOOGLE_APP_PASSWORD on the bot and restarts it
 * would still see "Feature Unavailable" until the frontend was *also*
 * rebuilt with the flag flipped — a confusing, easy-to-miss extra step.
 *
 * This hook instead asks the backend, which checks the real Gmail
 * credentials at request time (GET /api/v1/validate/email-service-status).
 * The result is cached at module scope for the lifetime of the tab so the
 * ~8 pages that need this don't each fire their own request.
 */

let cachedEnabled: boolean | null = null
let inFlight: Promise<boolean> | null = null

async function doFetch(): Promise<boolean> {
  try {
    const res = await apiClient.get<{ enabled: boolean }>(
      '/api/v1/validate/email-service-status',
    )
    const enabled = res.data.enabled === true
    cachedEnabled = enabled
    return enabled
  } catch {
    // Network/server error — fail closed (treat as unavailable) rather than
    // silently exposing a flow that can't actually send mail.
    cachedEnabled = false
    return false
  } finally {
    inFlight = null
  }
}

function fetchEmailServiceStatus(): Promise<boolean> {
  if (cachedEnabled !== null) return Promise.resolve(cachedEnabled)
  if (inFlight) return inFlight

  inFlight = doFetch()
  return inFlight
}

export interface UseEmailServiceEnabledResult {
  /** True once the backend has confirmed Gmail SMTP credentials are configured. */
  isEmailEnabled: boolean
  /** True while the initial check is in flight. */
  isLoading: boolean
}

export function useEmailServiceEnabled(): UseEmailServiceEnabledResult {
  const [isEmailEnabled, setIsEmailEnabled] = useState(cachedEnabled ?? false)
  const [isLoading, setIsLoading] = useState(cachedEnabled === null)

  useEffect(() => {
    if (cachedEnabled !== null) {
      setIsEmailEnabled(cachedEnabled)
      setIsLoading(false)
      return
    }

    let cancelled = false
    fetchEmailServiceStatus().then((enabled) => {
      if (cancelled) return
      setIsEmailEnabled(enabled)
      setIsLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [])

  return { isEmailEnabled, isLoading }
}

export default useEmailServiceEnabled
