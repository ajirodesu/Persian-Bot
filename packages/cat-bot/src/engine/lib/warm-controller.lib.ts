/**
 * Warm-up controller — keeps the first command's hot path warm across boot and
 * long idle periods without blocking the gateway from connecting.
 *
 * The controller coalesces concurrent warm-ups, serves fresh callers without
 * waiting, bounds how long a dispatch may wait for the first warm-up, and
 * avoids hammering a failing database by backing off after a failure.
 *
 * It is intentionally pure (a `warm` callback and a clock) so it can be
 * unit-tested without a database or a running platform listener.
 */

export interface WarmControllerOptions {
  /** Performs the actual cache warm-up. Rejections are recorded, not thrown. */
  warm: () => Promise<void>
  /** How long a completed warm-up is considered fresh. Default 12 minutes. */
  freshMs?: number
  /** Maximum time a dispatch waits for a warm-up (boot or after idle). Default 8s. */
  waitMs?: number
  /** Back-off after a failed warm-up. Default 5s. */
  retryMs?: number
  /** Injectable clock for tests. */
  now?: () => number
}

export interface WarmController {
  /** Starts (or joins) a warm-up regardless of freshness. */
  warm: () => Promise<void>
  /** Waits only when the cache is cold/stale; no-op for fresh callers. */
  ensureWarm: (maxWaitMs?: number) => Promise<void>
  /** True when the last successful warm-up is still inside the freshness window. */
  isWarm: () => boolean
  /** Timestamp of the last successful warm-up (0 before the first one). */
  lastWarmAt: () => number
}

function waitAtMost(promise: Promise<void>, ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      settled = true
      resolve(true)
    }, ms)
    // The warm promise never rejects (failures are swallowed by the
    // controller), so this always settles and clears the timer on the normal path.
    void promise.finally(() => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(false)
    })
  })
}

export function createWarmController(
  options: WarmControllerOptions,
): WarmController {
  const freshMs = options.freshMs ?? 12 * 60 * 1000
  const waitMs = options.waitMs ?? 8_000
  const retryMs = options.retryMs ?? 5_000
  const now = options.now ?? Date.now

  let inflight: Promise<void> | null = null
  let lastWarm = 0
  let lastFailure = 0
  let failed = false

  const warm = (): Promise<void> => {
    if (inflight) return inflight
    inflight = Promise.resolve()
      .then(options.warm)
      .then(
        () => {
          lastWarm = now()
          lastFailure = 0
          failed = false
        },
        () => {
          lastFailure = now()
          failed = true
        },
      )
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  const isWarm = (): boolean =>
    lastWarm > 0 && now() - lastWarm < freshMs

  const ensureWarm = async (maxWaitMs = waitMs): Promise<void> => {
    if (isWarm()) return
    // A recently failed warm-up means the database is unhealthy; do not make
    // every message pay the timeout again.
    if (failed && now() - lastFailure < retryMs) return
    const timedOut = await waitAtMost(warm(), maxWaitMs)
    if (timedOut) {
      // A stuck DB must not make every subsequent message wait the full timeout.
      lastFailure = now()
      failed = true
    }
  }

  return {
    warm,
    ensureWarm,
    isWarm,
    lastWarmAt: () => lastWarm,
  }
}
