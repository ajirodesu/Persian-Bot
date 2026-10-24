/**
 * Author: AjiroDesu
 *
 * Live connectivity state for every authenticated surface.
 *
 * The dashboard must never blank out because the network moved. This provider
 * turns low-level signals into one honest status:
 *
 *   browser offline → server unreachable → recovering → online
 *
 * Inputs: `online`/`offline` events, API reachability events emitted by the
 * request layer, socket connect/disconnect, tab visibility and focus.
 * Outputs: the banner copy, a "last synced" clock, and a manual `retryNow`.
 *
 * Retry policy: exponential backoff with jitter, capped at 30s, rescheduled
 * only while the tab is visible and the browser claims to be online. Coming
 * back to the tab or regaining network retries immediately instead of waiting
 * out the backoff.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { API_EVENTS } from '@/lib/api-client.lib'
import { getSocket } from '@/lib/socket.lib'

const MAX_BACKOFF_MS = 30_000
const BASE_BACKOFF_MS = 1_000
const RECOVERED_FLASH_MS = 4_000
const HEARTBEAT_MS = 60_000

export type ConnectionPhase =
  | 'online'
  | 'offline'
  | 'unavailable'
  | 'recovering'

interface ConnectivityValue {
  phase: ConnectionPhase
  browserOnline: boolean
  serverReachable: boolean | null
  socketConnected: boolean
  /** Newest successful query timestamp (ms), or null before any success. */
  lastSyncAt: number | null
  /** Timestamp of the last successful API response after an outage. */
  recoveredAt: number | null
  isRetrying: boolean
  nextRetryAt: number | null
  retryNow: () => Promise<void>
}

const ConnectivityContext = createContext<ConnectivityValue | undefined>(
  undefined,
)

// eslint-disable-next-line react-refresh/only-export-components
export function useConnectivity(): ConnectivityValue {
  const context = useContext(ConnectivityContext)
  if (!context) {
    throw new Error('useConnectivity must be used within a ConnectivityProvider')
  }
  return context
}

function jitteredBackoff(failures: number): number {
  const exponential = Math.min(
    MAX_BACKOFF_MS,
    BASE_BACKOFF_MS * 2 ** Math.max(0, failures - 1),
  )
  const jitter = exponential * 0.3 * (Math.random() * 2 - 1)
  return Math.max(500, Math.round(exponential + jitter))
}

export function ConnectivityProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const queryClient = useQueryClient()

  const [browserOnline, setBrowserOnline] = useState(
    () => typeof navigator === 'undefined' || navigator.onLine,
  )
  const [serverReachable, setServerReachable] = useState<boolean | null>(null)
  const [socketConnected, setSocketConnected] = useState(false)
  const [isRetrying, setIsRetrying] = useState(false)
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null)
  const [recoveredAt, setRecoveredAt] = useState<number | null>(null)

  const failuresRef = useRef(0)
  const retryingRef = useRef(false)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recoveredTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hadOutageRef = useRef(false)

  /** Newest successful dashboard query timestamp. */
  const syncFromCache = useCallback(() => {
    let newest = 0
    for (const query of queryClient.getQueryCache().getAll()) {
      const updated = query.state.dataUpdatedAt
      if (updated > newest) newest = updated
    }
    setLastSyncAt((previous) => {
      if (previous === newest) return previous
      return newest > 0 ? newest : previous
    })
  }, [queryClient])

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
  }, [])

  const markRecovered = useCallback(() => {
    if (!hadOutageRef.current) return
    hadOutageRef.current = false
    setRecoveredAt(Date.now())
    if (recoveredTimerRef.current) clearTimeout(recoveredTimerRef.current)
    recoveredTimerRef.current = setTimeout(() => {
      setRecoveredAt(null)
      recoveredTimerRef.current = null
    }, RECOVERED_FLASH_MS)
  }, [])

  const retryNow = useCallback(async () => {
    if (retryingRef.current) return
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      setBrowserOnline(false)
      return
    }
    retryingRef.current = true
    setIsRetrying(true)
    setNextRetryAt(null)
    clearRetryTimer()
    try {
      await queryClient.refetchQueries({ type: 'active' })
    } catch {
      // Individual queries surface their own state.
    } finally {
      retryingRef.current = false
      setIsRetrying(false)
    }
  }, [clearRetryTimer, queryClient])

  const scheduleRetry = useCallback(
    (failures: number) => {
      clearRetryTimer()
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') {
        setNextRetryAt(null)
        return
      }
      const delay = jitteredBackoff(failures)
      setNextRetryAt(Date.now() + delay)
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null
        setNextRetryAt(null)
        void retryNow()
      }, delay)
    },
    [clearRetryTimer, retryNow],
  )

  // ── Network + reachability events ─────────────────────────────────────────
  useEffect(() => {
    const onOnline = () => {
      setBrowserOnline(true)
      // A regained network invalidates any backoff we were waiting out.
      failuresRef.current = 0
      void retryNow()
    }
    const onOffline = () => {
      setBrowserOnline(false)
      clearRetryTimer()
      setNextRetryAt(null)
    }
    const onUnreachable = () => {
      setBrowserOnline(typeof navigator === 'undefined' || navigator.onLine)
      setServerReachable(false)
      hadOutageRef.current = true
      failuresRef.current += 1
      scheduleRetry(failuresRef.current)
    }
    const onReachable = () => {
      failuresRef.current = 0
      clearRetryTimer()
      setNextRetryAt(null)
      setBrowserOnline(true)
      setServerReachable(true)
      markRecovered()
      syncFromCache()
    }

    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    window.addEventListener(API_EVENTS.unreachable, onUnreachable)
    window.addEventListener(API_EVENTS.reachable, onReachable)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      window.removeEventListener(API_EVENTS.unreachable, onUnreachable)
      window.removeEventListener(API_EVENTS.reachable, onReachable)
    }
  }, [clearRetryTimer, markRecovered, retryNow, scheduleRetry, syncFromCache])

  // ── Cache freshness clock ─────────────────────────────────────────────────
  useEffect(() => {
    // Deferred: the first sync must not set state synchronously in the effect.
    const initial = setTimeout(syncFromCache, 0)
    let scheduled: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== 'updated' || event.query.state.status !== 'success') {
        return
      }
      if (scheduled) return
      scheduled = setTimeout(() => {
        scheduled = null
        syncFromCache()
      }, 250)
    })
    return () => {
      clearTimeout(initial)
      unsubscribe()
      if (scheduled) clearTimeout(scheduled)
    }
  }, [queryClient, syncFromCache])

  // ── Socket status ─────────────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket()
    const onConnect = () => setSocketConnected(true)
    const onDisconnect = () => setSocketConnected(false)
    const initial = setTimeout(() => setSocketConnected(socket.connected), 0)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    return () => {
      clearTimeout(initial)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [])

  // ── Return-to-tab recovery: visibility + focus ────────────────────────────
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        setBrowserOnline(false)
        return
      }
      if (serverReachable === false) {
        // Returning to the tab is the strongest signal of user intent; skip
        // the remaining backoff and try immediately.
        failuresRef.current = 0
        void retryNow()
      } else {
        // Refresh data silently — this is the stale-while-revalidate path.
        void queryClient.refetchQueries({ type: 'active' })
      }
    }
    const onFocus = () => {
      if (document.visibilityState === 'visible' && serverReachable === false) {
        void retryNow()
      }
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onFocus)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onFocus)
    }
  }, [queryClient, retryNow, serverReachable])

  // ── Visible-tab heartbeat (kept cheap; pauses when hidden) ────────────────
  useEffect(() => {
    const id = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      if (typeof navigator !== 'undefined' && !navigator.onLine) return
      void queryClient.refetchQueries({ type: 'active' })
    }, HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [queryClient])

  // ── Pause realtime while hidden for a long time ──────────────────────────
  useEffect(() => {
    let hiddenTimer: ReturnType<typeof setTimeout> | null = null
    const onVisibility = () => {
      const socket = getSocket()
      if (document.visibilityState === 'hidden') {
        hiddenTimer = setTimeout(() => {
          if (document.visibilityState === 'hidden' && socket.connected) {
            socket.disconnect()
          }
        }, 5 * 60_000)
      } else {
        if (hiddenTimer) {
          clearTimeout(hiddenTimer)
          hiddenTimer = null
        }
        if (!socket.connected) socket.connect()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      if (hiddenTimer) clearTimeout(hiddenTimer)
    }
  }, [])

  useEffect(
    () => () => {
      clearRetryTimer()
      if (recoveredTimerRef.current) clearTimeout(recoveredTimerRef.current)
    },
    [clearRetryTimer],
  )

  const phase: ConnectionPhase = useMemo(() => {
    if (!browserOnline) return 'offline'
    if (isRetrying) return 'recovering'
    if (serverReachable === false) return 'unavailable'
    return 'online'
  }, [browserOnline, isRetrying, serverReachable])

  const value = useMemo<ConnectivityValue>(
    () => ({
      phase,
      browserOnline,
      serverReachable,
      socketConnected,
      lastSyncAt,
      recoveredAt,
      isRetrying,
      nextRetryAt,
      retryNow,
    }),
    [
      phase,
      browserOnline,
      serverReachable,
      socketConnected,
      lastSyncAt,
      recoveredAt,
      isRetrying,
      nextRetryAt,
      retryNow,
    ],
  )

  return (
    <ConnectivityContext.Provider value={value}>
      {children}
    </ConnectivityContext.Provider>
  )
}
