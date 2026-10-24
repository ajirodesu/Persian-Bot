/**
 * Author: AjiroDesu
 *
 * Last-resort error reporting.
 *
 * Anything that escapes a boundary or a promise lands here: it is logged as a
 * warning (the console stays clean of uncaught-error noise) and surfaced as a
 * single throttled snackbar. Expected noise — aborted requests, browser
 * extensions, ResizeObserver loops — is ignored so real failures stand out.
 */
import { useEffect } from 'react'
import { ApiError } from '@/lib/api-client.lib'
import { useSnackbar } from '@/contexts/SnackbarContext'

const THROTTLE_MS = 6_000

function isIgnorable(reason: unknown): boolean {
  if (reason instanceof ApiError) return reason.isAborted
  if (reason instanceof DOMException) return reason.name === 'AbortError'
  if (reason instanceof Error) {
    if (reason.name === 'AbortError') return true
    if (reason.message.includes('ResizeObserver loop')) return true
    if (reason.message.includes('Loading chunk')) return false
  }
  return false
}

export default function GlobalErrorBridge() {
  const { error } = useSnackbar()

  useEffect(() => {
    let lastShownAt = 0

    const report = (reason: unknown) => {
      if (isIgnorable(reason)) return
      console.warn('[app] unhandled error', reason)
      const now = Date.now()
      if (now - lastShownAt < THROTTLE_MS) return
      lastShownAt = now
      error(
        'Something went wrong. Your saved data is safe — try the action again.',
      )
    }

    const onError = (event: ErrorEvent) => report(event.error ?? event.message)
    const onRejection = (event: PromiseRejectionEvent) => report(event.reason)

    window.addEventListener('error', onError)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener('error', onError)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [error])

  return null
}
