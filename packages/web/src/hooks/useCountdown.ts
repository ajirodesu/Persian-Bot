/**
 * Author: AjiroDesu
 *
 * Deadline-based countdown.
 *
 * Cooldowns are stored as an absolute timestamp, not as an interval counter.
 * A backgrounded tab throttles timers (and a locked phone freezes them), so
 * counting ticks drifts; subtracting `Date.now()` from a stored deadline is
 * always correct when the tab wakes. The interval only drives re-renders.
 */
import { useEffect, useState } from 'react'

export function useCountdown(deadline: number | null): number {
  const [remaining, setRemaining] = useState(() =>
    deadline === null ? 0 : Math.max(0, deadline - Date.now()),
  )

  useEffect(() => {
    if (deadline === null) return
    const tick = () => setRemaining(Math.max(0, deadline - Date.now()))
    // Defer the first tick to the next task rather than setting state
    // synchronously inside the effect body (avoids a cascading render).
    const first = setTimeout(tick, 0)
    const id = setInterval(tick, 1000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearTimeout(first)
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [deadline])

  if (deadline === null) return 0
  return remaining
}

/** Whole seconds remaining, rounded up, for display in a cooldown button. */
export function useCountdownSeconds(deadline: number | null): number {
  const remainingMs = useCountdown(deadline)
  return Math.ceil(remainingMs / 1000)
}
