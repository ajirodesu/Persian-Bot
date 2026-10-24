/**
 * Author: AjiroDesu
 *
 * HTTP client shared by every dashboard surface.
 *
 * Failure contract (why this exists):
 * - Every failure is classified. "Server down", "you are offline", "timed
 *   out", "401", "429" and "malformed JSON" are different problems, and the
 *   UI must not collapse them into one generic error.
 * - Timeouts abort the underlying fetch. A caller-supplied AbortSignal
 *   cancels only the caller's interest (and aborts the fetch when nobody
 *   else shares it).
 * - Identical concurrent GETs (same URL) share one in-flight fetch. TanStack
 *   Query also dedupes by key; this covers imperative callers.
 * - `Retry-After` is parsed into `retryAfterMs` so the query retry policy can
 *   honour the server instead of guessing.
 * - Responses emit connectivity events. The dashboard listens to these to
 *   render a live status banner instead of console noise.
 * - A 401 on a non-auth endpoint emits `catbot:auth-required`; the session
 *   layer answers with an in-place re-authentication modal. Nothing here
 *   redirects, so in-progress work is never destroyed by a token check.
 */
import { notifySlowFirstRequest } from './cold-start.lib'

export {
  ApiError,
  isRetryableApiError,
  apiErrorMessage,
} from './api-error.lib'
export type { ApiErrorKind, ApiErrorResponse } from './api-error.lib'
import { ApiError } from './api-error.lib'

export interface ApiResponse<T = unknown> {
  data: T
  status: number
  statusText: string
  headers: Headers
}

interface RequestConfig<TBody = unknown> {
  method?: string
  headers?: Record<string, string>
  body?: TBody
  params?: Record<string, unknown>
  timeout?: number
  signal?: AbortSignal
}

export const API_EVENTS = {
  authRequired: 'catbot:auth-required',
  unreachable: 'catbot:api-unreachable',
  reachable: 'catbot:api-reachable',
} as const

function emit(name: string, detail?: unknown): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

/** `Retry-After` is either delta-seconds or an HTTP date. Returns ms or undefined. */
function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined
  const seconds = Number(value)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000
  const date = Date.parse(value)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - Date.now())
}

// Cold-start detection (Render free-tier sleep): the page's first request
// arms a 2s timer; if nothing has settled by then the backend is likely
// waking up, so the UI gets one signal to explain the wait instead of
// spinning silently. Armed once per page load.
let coldStartTimer: ReturnType<typeof setTimeout> | null = null
let coldStartDone = false

function armColdStartTimer(): void {
  if (coldStartDone || coldStartTimer) return
  coldStartTimer = setTimeout(() => {
    coldStartTimer = null
    notifySlowFirstRequest()
  }, 2000)
}

function disarmColdStartTimer(): void {
  if (coldStartTimer) {
    clearTimeout(coldStartTimer)
    coldStartTimer = null
  }
  coldStartDone = true
}

function isAuthEndpoint(endpoint: string): boolean {
  return endpoint.startsWith('/api/auth/')
}

/** In-flight GET registry for imperative callers that pass no signal. */
const inflightGets = new Map<string, Promise<ApiResponse<unknown>>>()

class ApiClient {
  private baseURL: string
  private timeout: number
  private defaultHeaders: Record<string, string>

  constructor(config: {
    baseURL: string
    timeout?: number
    withCredentials?: boolean
    headers?: Record<string, string>
  }) {
    this.baseURL = config.baseURL
    this.timeout = config.timeout || 20000
    this.defaultHeaders = config.headers || {}
  }

  private buildURL(endpoint: string, params?: Record<string, unknown>): string {
    const url = new URL(endpoint, this.baseURL)
    if (params) {
      Object.entries(params).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          url.searchParams.append(key, String(value))
        }
      })
    }
    return url.toString()
  }

  private prepareRequest(body?: unknown, headers?: Record<string, string>) {
    let processedBody: BodyInit | undefined
    const processedHeaders = { ...this.defaultHeaders, ...headers }

    if (body instanceof FormData) {
      processedBody = body
      delete processedHeaders['Content-Type']
    } else if (body !== undefined) {
      processedBody = JSON.stringify(body)
      if (!processedHeaders['Content-Type']) {
        processedHeaders['Content-Type'] = 'application/json'
      }
    }

    return { body: processedBody, headers: processedHeaders }
  }

  private async request<T = unknown>(
    endpoint: string,
    config: RequestConfig = {},
  ): Promise<ApiResponse<T>> {
    const {
      method = 'GET',
      headers = {},
      body,
      params,
      timeout = this.timeout,
      signal,
    } = config

    const url = this.buildURL(endpoint, params)
    const { body: processedBody, headers: processedHeaders } =
      this.prepareRequest(body, headers)

    // Dedupe imperative GETs nobody can cancel individually.
    const dedupeKey = method === 'GET' && !signal ? `GET:${url}` : null
    if (dedupeKey) {
      const existing = inflightGets.get(dedupeKey) as
        | Promise<ApiResponse<T>>
        | undefined
      if (existing) return existing
    }

    const promise = this.performRequest<T>({
      url,
      endpoint,
      method,
      headers: processedHeaders,
      body: processedBody,
      timeout,
      signal,
    })

    if (dedupeKey) {
      inflightGets.set(dedupeKey, promise as Promise<ApiResponse<unknown>>)
      void promise
        .finally(() => inflightGets.delete(dedupeKey))
        .catch(() => {
          // rejection is delivered to the caller; this only clears the registry
        })
    }

    return promise
  }

  private async performRequest<T>({
    url,
    endpoint,
    method,
    headers,
    body,
    timeout,
    signal,
  }: {
    url: string
    endpoint: string
    method: string
    headers: Record<string, string>
    body: BodyInit | undefined
    timeout: number
    signal: AbortSignal | undefined
  }): Promise<ApiResponse<T>> {
    const timeoutController = new AbortController()
    const timeoutId = setTimeout(() => timeoutController.abort(), timeout)

    const combinedController = new AbortController()
    const onExternalAbort = () => combinedController.abort()
    if (signal) {
      if (signal.aborted) combinedController.abort()
      else signal.addEventListener('abort', onExternalAbort, { once: true })
    }
    const onTimeout = () => combinedController.abort()
    timeoutController.signal.addEventListener('abort', onTimeout, {
      once: true,
    })

    const cleanup = () => {
      clearTimeout(timeoutId)
      timeoutController.signal.removeEventListener('abort', onTimeout)
      signal?.removeEventListener('abort', onExternalAbort)
      disarmColdStartTimer()
    }

    armColdStartTimer()

    let response: Response
    try {
      response = await fetch(url, {
        method,
        headers,
        body,
        credentials: 'include',
        signal: combinedController.signal,
        cache: 'no-store',
      })
    } catch (error) {
      cleanup()

      if (error instanceof Error && error.name === 'AbortError') {
        if (signal?.aborted) {
          throw new ApiError('Request cancelled', 'aborted', { cause: error })
        }
        throw new ApiError('The server took too long to respond.', 'timeout', {
          cause: error,
        })
      }

      const offline =
        typeof navigator !== 'undefined' && navigator.onLine === false
      emit(API_EVENTS.unreachable, { offline })
      throw new ApiError(
        offline ? 'You are offline.' : 'The server is unreachable.',
        offline ? 'offline' : 'network',
        { cause: error },
      )
    }

    cleanup()
    // Any HTTP response — even a 500 — proves the server is reachable.
    emit(API_EVENTS.reachable)

    const contentType = response.headers.get('content-type') ?? ''
    const raw = await response.text()
    let data: unknown = null
    if (raw) {
      if (contentType.includes('application/json')) {
        try {
          data = JSON.parse(raw) as unknown
        } catch (error) {
          throw new ApiError(
            'The server returned an unreadable response.',
            'parse',
            { status: response.status, cause: error },
          )
        }
      } else {
        data = raw
      }
    }

    if (!response.ok) {
      const retryAfterMs = parseRetryAfter(response.headers.get('retry-after'))
      if (response.status === 401 && !isAuthEndpoint(endpoint)) {
        emit(API_EVENTS.authRequired, { endpoint })
      }
      const payload = data as { message?: string; error?: string } | null
      const serverMessage = payload?.message ?? payload?.error
      throw new ApiError(serverMessage ?? `HTTP ${response.status}`, 'http', {
        status: response.status,
        data,
        ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      })
    }

    return {
      data: data as T,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    }
  }

  async get<T = unknown>(
    endpoint: string,
    config?: { params?: Record<string, unknown>; signal?: AbortSignal },
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'GET', ...config })
  }

  async post<T = unknown, TBody = unknown>(
    endpoint: string,
    body?: TBody,
    config?: RequestConfig<TBody>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'POST', body, ...config })
  }

  async put<T = unknown, TBody = unknown>(
    endpoint: string,
    body?: TBody,
    config?: RequestConfig<TBody>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'PUT', body, ...config })
  }

  async delete<T = unknown>(
    endpoint: string,
    config?: RequestConfig,
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'DELETE', ...config })
  }

  async patch<T = unknown, TBody = unknown>(
    endpoint: string,
    body?: TBody,
    config?: RequestConfig<TBody>,
  ): Promise<ApiResponse<T>> {
    return this.request<T>(endpoint, { method: 'PATCH', body, ...config })
  }
}

const apiClient = new ApiClient({
  baseURL: window.location.origin,
  withCredentials: true,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 20000,
})

export default apiClient
