/**
 * Author: AjiroDesu
 *
 * User session state.
 *
 * The important behaviour here is what happens on expiry: the dashboard is
 * NOT torn down. The provider:
 * - refreshes silently before `expiresAt` (and again when the tab wakes near
 *   expiry), so most idle periods roll the 30-day session forward invisibly;
 * - listens for 401s emitted by the request layer and flips `sessionExpired`
 *   instead of navigating, which lets the shell render an in-place re-auth
 *   modal over the preserved page;
 * - remembers only the display name + email of the last user (for the modal
 *   prefill), never a token or password.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authUserClient } from '@/lib/better-auth-client.lib'
import { API_EVENTS } from '@/lib/api-client.lib'
import { clearPersistedQueryCache } from '@/lib/query-persistence.lib'

// Type definitions
interface User {
  id: string
  name: string
  email: string
  image?: string
  role: string
  createdAt: Date
  updatedAt: Date
}

interface Session {
  session: {
    userId: string
    expiresAt: Date
    token: string
    [key: string]: unknown
  }
  user: User
}

interface LastKnownUser {
  name: string
  email: string
}

interface UserAuthContextType {
  session: Session | null
  user: User | null
  error: Error | null
  login: (
    email: string,
    password: string,
    rememberMe?: boolean,
  ) => Promise<void>
  logout: () => Promise<void>
  refreshSession: () => void
  sessionExpired: boolean
  /** Clears the expired flag after a successful in-place sign-in. */
  acknowledgeReauth: () => void
  lastKnownUser: LastKnownUser | null
  isAuthenticated: boolean
  isLoading: boolean
}

const LAST_USER_KEY = 'catbot:last-user:v1'
/** Refresh this long before the server-side expiry. */
const REFRESH_AHEAD_MS = 60_000
/** On wake, refresh if the session expires within this window. */
const WAKE_REFRESH_WINDOW_MS = 5 * 60_000

const UserAuthContext = createContext<UserAuthContextType | undefined>(
  undefined,
)

function readLastUser(): LastKnownUser | null {
  try {
    const raw = window.localStorage.getItem(LAST_USER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<LastKnownUser>
    if (typeof parsed.email !== 'string') return null
    return { email: parsed.email, name: parsed.name ?? parsed.email }
  } catch {
    return null
  }
}

function writeLastUser(user: User | null): void {
  try {
    if (!user) window.localStorage.removeItem(LAST_USER_KEY)
    else
      window.localStorage.setItem(
        LAST_USER_KEY,
        JSON.stringify({ email: user.email, name: user.name }),
      )
  } catch {
    // storage unavailable — the modal simply has no prefill
  }
}

function clearFormDrafts(): void {
  try {
    for (const key of Object.keys(window.localStorage)) {
      if (key.startsWith('catbot:form-draft:')) window.localStorage.removeItem(key)
    }
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith('catbot:form-draft:')) window.sessionStorage.removeItem(key)
    }
  } catch {
    // nothing to clear
  }
}

// eslint-disable-next-line react-refresh/only-export-components
export const useUserAuth = () => {
  const context = useContext(UserAuthContext)
  if (!context) {
    throw new Error('useUserAuth must be used within a UserAuthProvider')
  }
  return context
}

export const UserAuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const queryClient = useQueryClient()
  const {
    data: session,
    isPending,
    error,
    refetch,
  } = authUserClient.useSession()

  const [sessionExpired, setSessionExpired] = useState(false)
  const [lastKnownUser, setLastKnownUser] = useState<LastKnownUser | null>(() =>
    typeof window === 'undefined' ? null : readLastUser(),
  )

  const hadSessionRef = useRef(false)
  const explicitLogoutRef = useRef(false)
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const typedSession = session as Session | null

  // Remember / forget the user identity for the re-auth modal.
  useEffect(() => {
    // Deferred to a microtask: the provider mirrors the auth library's state,
    // and setting state directly in an effect would cascade a render.
    queueMicrotask(() => {
      if (typedSession?.user) {
        hadSessionRef.current = true
        setLastKnownUser({
          email: typedSession.user.email,
          name: typedSession.user.name,
        })
        writeLastUser(typedSession.user)
        setSessionExpired(false)
      } else if (
        !isPending &&
        hadSessionRef.current &&
        !explicitLogoutRef.current
      ) {
        // Session disappeared without an explicit sign-out: most likely
        // expired while the tab slept. Keep the dashboard mounted and ask
        // in place.
        setSessionExpired(true)
      }
    })
  }, [typedSession, isPending])

  const login = useCallback(
    async (email: string, password: string, rememberMe: boolean = false) => {
      const result = await authUserClient.signIn.email(
        {
          email,
          password,
          rememberMe,
        },
        {
          onError: (ctx) => {
            throw new Error(ctx.error.message || 'Login failed')
          },
        },
      )

      if (result.error) {
        throw new Error(result.error.message || 'Login failed')
      }

      explicitLogoutRef.current = false
      hadSessionRef.current = true
      setSessionExpired(false)
      await refetch()
      // The page was preserved; refresh every mounted query against the new
      // session rather than asking the user to reload.
      void queryClient.invalidateQueries()
    },
    [queryClient, refetch],
  )

  const logout = useCallback(async () => {
    explicitLogoutRef.current = true
    try {
      const result = await authUserClient.signOut()
      if (result.error) {
        throw new Error(result.error.message || 'Logout failed')
      }
      await refetch()
    } catch (logoutError) {
      explicitLogoutRef.current = false
      throw logoutError
    }
    hadSessionRef.current = false
    setSessionExpired(false)
    setLastKnownUser(null)
    writeLastUser(null)
    clearPersistedQueryCache()
    clearFormDrafts()
    queryClient.clear()
  }, [queryClient, refetch])

  const acknowledgeReauth = useCallback(() => {
    setSessionExpired(false)
    hadSessionRef.current = true
  }, [])

  // ── Silent refresh before expiry ─────────────────────────────────────────
  const scheduleRefresh = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
      refreshTimerRef.current = null
    }
    const expiresAt = typedSession?.session?.expiresAt
    if (!expiresAt) return
    const expiresMs = new Date(expiresAt).getTime()
    if (Number.isNaN(expiresMs)) return
    const delay = Math.max(5_000, expiresMs - Date.now() - REFRESH_AHEAD_MS)
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null
      void refetch()
    }, delay)
  }, [refetch, typedSession])

  useEffect(() => {
    scheduleRefresh()
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [scheduleRefresh])

  // ── Wake from idle: refresh if the session is close to expiry ────────────
  useEffect(() => {
    const onWake = () => {
      if (document.visibilityState !== 'visible') return
      const expiresAt = typedSession?.session?.expiresAt
      if (!expiresAt) return
      const remaining = new Date(expiresAt).getTime() - Date.now()
      if (remaining < WAKE_REFRESH_WINDOW_MS) void refetch()
    }
    document.addEventListener('visibilitychange', onWake)
    window.addEventListener('focus', onWake)
    return () => {
      document.removeEventListener('visibilitychange', onWake)
      window.removeEventListener('focus', onWake)
    }
  }, [refetch, typedSession])

  // ── 401 from the request layer ───────────────────────────────────────────
  useEffect(() => {
    const onAuthRequired = () => {
      // Confirm with the source of truth before alarming the user; a single
      // 401 can be a stale request racing a fresh cookie.
      void authUserClient
        .getSession()
        .then((result) => {
          if (!result?.data) setSessionExpired(true)
          else void refetch()
        })
        .catch(() => setSessionExpired(true))
    }
    window.addEventListener(API_EVENTS.authRequired, onAuthRequired)
    return () =>
      window.removeEventListener(API_EVENTS.authRequired, onAuthRequired)
  }, [refetch])

  const value = useMemo<UserAuthContextType>(
    () => ({
      session: typedSession,
      user: typedSession?.user ?? null,
      error,
      isAuthenticated: !!typedSession,
      isLoading: isPending,
      sessionExpired,
      acknowledgeReauth,
      lastKnownUser,
      login,
      logout,
      refreshSession: () => {
        void refetch()
      },
    }),
    [
      typedSession,
      error,
      isPending,
      sessionExpired,
      acknowledgeReauth,
      lastKnownUser,
      login,
      logout,
      refetch,
    ],
  )

  return (
    <UserAuthContext.Provider value={value}>
      {children}
    </UserAuthContext.Provider>
  )
}

export type { User, Session, UserAuthContextType }
