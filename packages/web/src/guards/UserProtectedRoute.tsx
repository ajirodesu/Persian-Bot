import React from 'react'
import { Navigate, useLocation, Outlet } from 'react-router-dom'
import { useUserAuth } from '@/contexts/UserAuthContext'
import Skeleton from '@/components/ui/feedback/Skeleton'
import ReauthModal from '@/components/auth/ReauthModal'
import { persistedCacheTimestamp } from '@/lib/query-persistence.lib'
import { ROUTES } from '@/constants/routes.constants'

/**
 * UserProtectedRoute guard
 *
 * Three states, no full-screen spinners and no blank page:
 * 1. Checking the session     → shell-shaped skeleton (same geometry as the
 *                               dashboard, so nothing jumps when it resolves).
 * 2. Authenticated            → render the dashboard.
 * 3. Expired / missing session but the dashboard has local context (a known
 *    user and a persisted cache) → keep the dashboard mounted and open the
 *    in-place re-auth modal. Only a genuinely context-free visit redirects
 *    to /login, carrying the intended destination with it.
 */
const UserProtectedRoute: React.FC = () => {
  const { isAuthenticated, isLoading, sessionExpired, lastKnownUser } =
    useUserAuth()
  const location = useLocation()

  if (isLoading) {
    return <DashboardShellSkeleton />
  }

  if (!isAuthenticated) {
    const hasLocalContext =
      Boolean(lastKnownUser) && persistedCacheTimestamp() !== null
    const canResume = hasLocalContext || (sessionExpired && Boolean(lastKnownUser))

    if (!canResume) {
      return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />
    }

    // Preserve the page whenever local context exists. The modal is reserved
    // for a confirmed expiry (401), never for an unknown state caused by a
    // server outage — in that case the connection banner explains the outage.
    return (
      <>
        <Outlet />
        {sessionExpired && <ReauthModal />}
      </>
    )
  }

  return <Outlet />
}

/**
 * Skeleton mirroring the dashboard shell: rail, header bar, then the page
 * heading / primary action / list rhythm. Rendered during the (usually very
 * short) session check instead of a centered spinner on an empty page.
 */
function DashboardShellSkeleton() {
  return (
    <div className="flex min-h-dvh bg-surface-container-high">
      <div className="hidden w-[var(--layout-sidebar-w)] shrink-0 flex-col gap-2 border-r border-hairline bg-surface-container-low p-3 md:flex">
        <Skeleton variant="text" width="60%" height={14} className="mb-3 mt-2" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} variant="rounded" width="100%" height={32} />
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b border-hairline px-4 md:px-6">
          <Skeleton variant="text" width={140} height={14} />
          <Skeleton variant="rounded" width={28} height={28} className="ml-auto" />
        </div>
        <div className="mx-auto flex w-full max-w-[var(--layout-content-max)] flex-col gap-4 px-[var(--layout-main-p)] py-6 md:py-8">
          <Skeleton variant="rounded" width="100%" height={52} />
          <Skeleton variant="text" width={180} />
          <Skeleton variant="rounded" width="100%" height={72} />
          <Skeleton variant="rounded" width="100%" height={72} />
          <Skeleton variant="rounded" width="100%" height={72} />
        </div>
      </div>
    </div>
  )
}

export default UserProtectedRoute
