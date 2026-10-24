/**
 * Author: AjiroDesu
 *
 * Request failure model. Kept free of `window`/`fetch` so the retry policy and
 * cache fallback can be unit-tested without a browser, and so every surface
 * agrees on the same error classification and copy.
 */

export type ApiErrorKind =
  | 'aborted'
  | 'timeout'
  | 'offline'
  | 'network'
  | 'http'
  | 'parse'

export interface ApiErrorResponse {
  status: number
  data: unknown
  retryAfterMs?: number
}

/** Classified request failure. `instanceof ApiError` works at runtime. */
export class ApiError extends Error {
  public readonly kind: ApiErrorKind
  public readonly status?: number
  public readonly response?: ApiErrorResponse
  public readonly retryAfterMs?: number
  public readonly isAborted: boolean

  constructor(
    message: string,
    kind: ApiErrorKind,
    options: {
      status?: number
      data?: unknown
      retryAfterMs?: number
      cause?: unknown
    } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.isAborted = kind === 'aborted'
    if (options.status !== undefined) {
      this.status = options.status
      this.response = {
        status: options.status,
        data: options.data,
        ...(options.retryAfterMs !== undefined
          ? { retryAfterMs: options.retryAfterMs }
          : {}),
      }
    }
    if (options.retryAfterMs !== undefined) {
      this.retryAfterMs = options.retryAfterMs
    }
    if (options.cause !== undefined) this.cause = options.cause
  }
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504])

/** True when retrying the same request later can plausibly succeed. */
export function isRetryableApiError(error: unknown): boolean {
  if (error instanceof ApiError) {
    if (error.kind === 'aborted') return false
    if (error.kind !== 'http') return true
    return error.status !== undefined && RETRYABLE_STATUS.has(error.status)
  }
  return false
}

/** User-facing copy for each failure class. Kept here so every surface agrees. */
export function apiErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.kind) {
      case 'offline':
        return 'You are offline. Reconnect to sync with the server.'
      case 'timeout':
        return 'The server took too long to respond. It may be waking up.'
      case 'network':
        return 'The server is unreachable. Showing the last saved data.'
      case 'parse':
        return 'The server returned an unreadable response.'
      case 'aborted':
        return 'Request cancelled.'
      case 'http': {
        switch (error.status) {
          case 400:
            return error.message || 'The request was rejected.'
          case 401:
            return 'Your session expired. Sign in again to continue.'
          case 403:
            return 'You do not have access to that resource.'
          case 404:
            return 'That resource no longer exists.'
          case 409:
            return error.message || 'That change conflicts with a newer one.'
          case 429:
            return 'Too many requests. The server asked us to wait a moment.'
          case 502:
          case 503:
          case 504:
            return 'The server is unavailable right now. Showing the last saved data.'
          default:
            return error.message || 'The server could not complete the request.'
        }
      }
    }
  }
  if (error instanceof Error) return error.message
  return 'An unexpected error occurred.'
}
