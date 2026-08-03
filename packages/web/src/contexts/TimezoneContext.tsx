import React, { createContext, useContext, useEffect, useState } from 'react'
import apiClient, { type ApiError } from '@/lib/api-client.lib'
import { getBrowserTimezone, isValidTimezone } from '@/utils/datetime.util'

interface TimezoneResponse {
  timezone: string | null
}

interface TimezoneContextType {
  /** The timezone every dashboard time display should render in — the saved
   * preference when one exists, otherwise the browser's local timezone. */
  timezone: string
  /** The raw saved value from the backend; null until the account picks one. */
  savedTimezone: string | null
  /** The browser/OS timezone — used as the picker's default and as a fallback. */
  browserTimezone: string
  /** True while the initial GET is in flight. */
  isLoading: boolean
  /** True while a save is in flight. */
  isSaving: boolean
  error: string | null
  /** Validates, persists, and applies a new timezone. Throws on failure so
   * callers can show inline form errors. */
  setTimezone: (timezone: string) => Promise<void>
}

const TimezoneContext = createContext<TimezoneContextType | undefined>(
  undefined,
)

// eslint-disable-next-line react-refresh/only-export-components
export const useTimezone = () => {
  const context = useContext(TimezoneContext)
  if (!context) {
    throw new Error('useTimezone must be used within a TimezoneProvider')
  }
  return context
}

/**
 * App-wide timezone provider.
 *
 * Deliberately NOT scoped to UserAuthContext or AdminAuthContext — the
 * backend's GET/PUT /api/v1/settings/timezone accepts either session cookie
 * (see requireAnySession), so this provider works the same way whether it's
 * mounted under the regular dashboard or the admin portal. On a public page
 * (no session at all) the GET simply 401s and the provider falls back to the
 * browser's local timezone without surfacing an error to the user.
 */
export const TimezoneProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const browserTimezone = getBrowserTimezone()
  const [savedTimezone, setSavedTimezone] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await apiClient.get<TimezoneResponse>(
          '/api/v1/settings/timezone',
        )
        if (cancelled) return
        const tz = res.data.timezone
        setSavedTimezone(tz && isValidTimezone(tz) ? tz : null)
      } catch (err) {
        // No session on this page, or the request failed — silently fall
        // back to the browser timezone rather than showing an error banner
        // on pages that don't even display a timezone setting.
        const apiErr = err as ApiError
        if (apiErr.response?.status !== 401) {
          console.error('[TimezoneProvider] failed to load timezone', err)
        }
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const setTimezone = async (timezone: string) => {
    if (!isValidTimezone(timezone)) {
      throw new Error('Invalid timezone selected.')
    }
    setIsSaving(true)
    setError(null)
    try {
      await apiClient.put<TimezoneResponse>('/api/v1/settings/timezone', {
        timezone,
      })
      setSavedTimezone(timezone)
    } catch (err) {
      const apiErr = err as ApiError
      const message =
        (apiErr.response?.data as { error?: string } | undefined)?.error ||
        apiErr.message ||
        'Failed to save timezone.'
      setError(message)
      throw new Error(message)
    } finally {
      setIsSaving(false)
    }
  }

  const value: TimezoneContextType = {
    timezone: savedTimezone ?? browserTimezone,
    savedTimezone,
    browserTimezone,
    isLoading,
    isSaving,
    error,
    setTimezone,
  }

  return (
    <TimezoneContext.Provider value={value}>
      {children}
    </TimezoneContext.Provider>
  )
}
