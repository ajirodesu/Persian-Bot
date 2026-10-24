/**
 * Author: AjiroDesu
 *
 * Query retry policy. Pure functions, imported by the client and by tests.
 *
 * Exponential backoff with ±25% jitter, capped at 30s, at most 5 attempts.
 * A server-provided `Retry-After` always wins over the computed delay. Only
 * retryable failures retry; 400/401/403/404/422 surface immediately.
 */
import { ApiError, isRetryableApiError } from './api-error.lib'

export const MAX_QUERY_RETRIES = 5
const BASE_RETRY_DELAY_MS = 800
const MAX_RETRY_DELAY_MS = 30_000

/** Exponential backoff with ±25% jitter; honours `Retry-After`. */
export function computeRetryDelay(
  attemptIndex: number,
  error: unknown,
): number {
  if (error instanceof ApiError && error.retryAfterMs !== undefined) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, error.retryAfterMs))
  }
  const exponential = Math.min(
    MAX_RETRY_DELAY_MS,
    BASE_RETRY_DELAY_MS * 2 ** attemptIndex,
  )
  // Jitter desynchronises every client reconnecting after the same outage.
  const jitter = exponential * 0.25 * (Math.random() * 2 - 1)
  return Math.max(250, Math.round(exponential + jitter))
}

export function shouldRetryQuery(
  failureCount: number,
  error: unknown,
): boolean {
  if (failureCount >= MAX_QUERY_RETRIES) return false
  return isRetryableApiError(error)
}
