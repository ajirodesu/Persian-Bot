/**
 * Warm-controller semantics.
 *
 * The controller is what guarantees a command is dispatched against a warm
 * cache after boot, after a frozen process wakes up, and while a warm-up is
 * already in flight. These tests pin those guarantees without a database.
 */
import { describe, expect, it, vi } from 'vitest'
import { createWarmController } from '@/engine/lib/warm-controller.lib.js'

describe('createWarmController', () => {
  it('runs the warm-up once and treats it as fresh', async () => {
    const warm = vi.fn(async () => undefined)
    const controller = createWarmController({ warm, freshMs: 1_000 })

    await controller.warm()
    await controller.ensureWarm()
    await controller.ensureWarm()

    expect(warm).toHaveBeenCalledTimes(1)
    expect(controller.isWarm()).toBe(true)
  })

  it('coalesces concurrent warm-ups', async () => {
    let release: (() => void) | undefined
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const warm = vi.fn(() => gate)
    const controller = createWarmController({ warm })

    const first = controller.warm()
    const second = controller.warm()
    expect(first).toBe(second)

    release?.()
    await Promise.all([first, second])
    expect(warm).toHaveBeenCalledTimes(1)
  })

  it('re-warms after the freshness window', async () => {
    let clock = 10_000
    const warm = vi.fn(async () => undefined)
    const controller = createWarmController({
      warm,
      freshMs: 1_000,
      now: () => clock,
    })

    await controller.warm()
    clock += 1_001
    expect(controller.isWarm()).toBe(false)
    await controller.ensureWarm()

    expect(warm).toHaveBeenCalledTimes(2)
  })

  it('backs off after a failed warm-up instead of stalling every message', async () => {
    let clock = 0
    const warm = vi.fn(async () => {
      throw new Error('db down')
    })
    const controller = createWarmController({
      warm,
      retryMs: 5_000,
      now: () => clock,
    })

    await controller.warm()
    await controller.ensureWarm()
    expect(warm).toHaveBeenCalledTimes(1)

    clock = 5_001
    await controller.ensureWarm()
    expect(warm).toHaveBeenCalledTimes(2)
  })

  it('bounds how long a dispatch waits for a stuck warm-up', async () => {
    const controller = createWarmController({
      warm: () => new Promise<void>(() => undefined),
      waitMs: 20,
    })

    const started = Date.now()
    await controller.ensureWarm()
    expect(Date.now() - started).toBeLessThan(250)

    // A stuck warm-up must not make the next message wait the full window again.
    const retryStarted = Date.now()
    await controller.ensureWarm()
    expect(Date.now() - retryStarted).toBeLessThan(10)
  })
})
