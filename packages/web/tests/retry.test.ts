/**
 * Retry / backoff policy tests.
 *
 * The dashboard's recovery behaviour depends on these numbers: delays must
 * grow exponentially with jitter, must honour `Retry-After`, must cap at 30s,
 * and must never retry an auth or validation failure.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  MAX_QUERY_RETRIES,
  computeRetryDelay,
  shouldRetryQuery,
} from '@/lib/retry.lib'
import { ApiError, apiErrorMessage, isRetryableApiError } from '@/lib/api-error.lib'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('computeRetryDelay', () => {
  it('grows exponentially and stays within the jitter band', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // zero jitter
    expect(computeRetryDelay(0, new ApiError('x', 'network'))).toBe(800)
    expect(computeRetryDelay(1, new ApiError('x', 'timeout'))).toBe(1600)
    expect(computeRetryDelay(3, new ApiError('x', 'network'))).toBe(6400)
  })

  it('caps at 30 seconds', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
    expect(computeRetryDelay(20, new ApiError('x', 'network'))).toBe(30_000)
  })

  it('applies jitter in both directions', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0)
    const low = computeRetryDelay(2, new ApiError('x', 'network'))
    vi.spyOn(Math, 'random').mockReturnValue(0.999)
    const high = computeRetryDelay(2, new ApiError('x', 'network'))
    expect(low).toBeLessThan(high)
    expect(low).toBeGreaterThanOrEqual(250)
  })

  it('honours a server Retry-After instead of the computed delay', () => {
    const error = new ApiError('slow down', 'http', { status: 429, retryAfterMs: 7_000 })
    expect(computeRetryDelay(3, error)).toBe(7_000)
  })

  it('clamps an absurd Retry-After to the cap', () => {
    const error = new ApiError('slow down', 'http', {
      status: 503,
      retryAfterMs: 10 * 60_000,
    })
    expect(computeRetryDelay(0, error)).toBe(30_000)
  })
})

describe('shouldRetryQuery', () => {
  it('retries transient failures up to the cap', () => {
    const network = new ApiError('down', 'network')
    expect(shouldRetryQuery(0, network)).toBe(true)
    expect(shouldRetryQuery(MAX_QUERY_RETRIES - 1, network)).toBe(true)
    expect(shouldRetryQuery(MAX_QUERY_RETRIES, network)).toBe(false)
  })

  it('retries 429, 500, 502, 503 and 504', () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(shouldRetryQuery(0, new ApiError('x', 'http', { status }))).toBe(true)
    }
  })

  it('never retries auth, validation or aborted failures', () => {
    for (const status of [400, 401, 403, 404, 409, 422]) {
      expect(shouldRetryQuery(0, new ApiError('x', 'http', { status }))).toBe(false)
    }
    expect(shouldRetryQuery(0, new ApiError('cancelled', 'aborted'))).toBe(false)
  })

  it('does not retry unknown error shapes', () => {
    expect(shouldRetryQuery(0, new Error('boom'))).toBe(false)
    expect(isRetryableApiError(new Error('boom'))).toBe(false)
  })
})

describe('apiErrorMessage', () => {
  it('distinguishes the failure classes the UI must explain', () => {
    expect(apiErrorMessage(new ApiError('x', 'offline'))).toMatch(/offline/i)
    expect(apiErrorMessage(new ApiError('x', 'timeout'))).toMatch(/too long/i)
    expect(apiErrorMessage(new ApiError('x', 'network'))).toMatch(/unreachable/i)
    expect(apiErrorMessage(new ApiError('x', 'http', { status: 401 }))).toMatch(
      /session expired/i,
    )
    expect(apiErrorMessage(new ApiError('x', 'http', { status: 429 }))).toMatch(
      /too many requests/i,
    )
    expect(apiErrorMessage(new ApiError('x', 'http', { status: 503 }))).toMatch(
      /unavailable/i,
    )
    expect(apiErrorMessage(new ApiError('x', 'parse'))).toMatch(/unreadable/i)
  })
})
