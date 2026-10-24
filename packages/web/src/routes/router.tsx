/* eslint-disable react-refresh/only-export-components */
import React, { lazy, Suspense } from 'react'
import { createBrowserRouter, Outlet, useLocation } from 'react-router-dom'
import { ROUTES, ROUTE_SEGMENTS } from '@/constants/routes.constants'
import Skeleton from '@/components/ui/feedback/Skeleton'
import RouteErrorBoundary from '@/components/ui/feedback/RouteErrorBoundary'

// Layout shells — NOT lazy-loaded; must render immediately so nav chrome
// appears before any page bundle resolves.
import Layout from '@/components/layout/Layout'
import DashboardLayout from '@/features/users/components/DashboardLayout'
import UserProtectedRoute from '@/guards/UserProtectedRoute'
import PublicRoute from '@/guards/PublicRoute'
import AdminProtectedRoute from '@/guards/AdminProtectedRoute'
import AdminPublicRoute from '@/guards/AdminPublicRoute'
import AdminSidebarLayout from '@/features/admin/components/AdminSidebarLayout'
import { AdminAuthProvider } from '@/contexts/AdminAuthContext'
import ScrollToTop from '@/components/ScrollToTop'

// Error pages — NOT lazy-loaded; must be available even when the app bundle
// fails to load or the API is entirely unreachable.
import NotFound from '@/pages/errors/NotFound'
import InternalServerError from '@/pages/errors/InternalServerError'

// Login is eager: it is the most common entry point, and a lazy chunk swap
// behind the document footer caused a large layout shift (CLS 0.58).
import LoginPage from '@/pages/Login'

// Page bundles — split per-route so the initial JS payload stays small.
const HomePage = lazy(() => import('@/pages/Home'))
const SignupPage = lazy(() => import('@/pages/Signup'))
const ForgotPasswordPage = lazy(() => import('@/pages/ForgotPassword'))
const ResetPasswordPage = lazy(() => import('@/pages/ResetPassword'))
const AccountVerificationPage = lazy(() => import('@/pages/AccountVerification'))
const SettingsPage = lazy(() => import('@/pages/dashboard/settings'))
const BotManagerPage = lazy(() => import('@/pages/dashboard'))
const NewBotPage = lazy(() => import('@/pages/dashboard/create-new-bot'))
const BotLayout = lazy(
  () => import('@/features/users/components/DashboardBotLayout'),
)
const ChatRoomPage = lazy(() => import('@/pages/dashboard/chat-room'))
const BotConsolePage = lazy(() => import('@/pages/dashboard/bot/index'))
const BotCommandsPage = lazy(() => import('@/pages/dashboard/bot/commands'))
const BotEventsPage = lazy(() => import('@/pages/dashboard/bot/events'))
const BotSettingsPage = lazy(() => import('@/pages/dashboard/bot/settings'))
const BotDatabasePage = lazy(() => import('@/pages/dashboard/bot/database'))
const AdminLoginPage = lazy(() => import('@/pages/admin'))
const AdminForgotPasswordPage = lazy(() => import('@/pages/admin/ForgotPassword'))
const AdminResetPasswordPage = lazy(() => import('@/pages/admin/ResetPassword'))
const AdminDashboardPage = lazy(() => import('@/pages/admin/dashboard'))
const AdminUsersPage = lazy(() => import('@/pages/admin/dashboard/users'))
const AdminBotsPage = lazy(() => import('@/pages/admin/dashboard/bots'))
const AdminFilesPage = lazy(() => import('@/pages/admin/dashboard/files'))
const AdminFileEditorPage = lazy(
  () => import('@/pages/admin/dashboard/file-editor'),
)
const AdminGitPage = lazy(() => import('@/pages/admin/dashboard/git'))
const AdminSettingsPage = lazy(() => import('@/pages/admin/dashboard/settings'))

/**
 * AdminLayout — scopes AdminAuthProvider to the admin route subtree.
 * Isolates admin session state from UserAuthContext; App.tsx needs no changes.
 */
function AdminLayout() {
  return (
    <AdminAuthProvider>
      <ScrollToTop />
      <Outlet />
    </AdminAuthProvider>
  )
}

const withSuspense = (
  node: React.ReactElement,
  fallback?: React.ReactNode,
) => (
  <SuspenseWithBoundary fallback={fallback}>{node}</SuspenseWithBoundary>
)

/**
 * Landing-shaped placeholder: the masthead strip, then the same 7/5 document
 * split the home page renders (rule + headline + copy + actions on the left,
 * surface index on the right), so the footer below doesn't jump when the
 * chunk lands.
 */
function LandingFallback() {
  return (
    <div className="bg-surface" aria-hidden="true">
      {/* Masthead strip */}
      <div className="border-b border-hairline">
        <div className="mx-auto flex w-full max-w-[var(--layout-nav-max)] items-center justify-between gap-4 px-[var(--layout-section-px)] py-2.5">
          <Skeleton
            variant="text"
            width={180}
            height={11}
            className="bg-surface-container-low!"
          />
          <Skeleton
            variant="text"
            width={160}
            height={11}
            className="hidden bg-surface-container-low! md:block"
          />
          <Skeleton
            variant="text"
            width={48}
            height={11}
            className="bg-surface-container-low!"
          />
        </div>
      </div>

      {/* Control surface — 7-column copy block, 5-column index panel */}
      <div className="mx-auto w-full max-w-[var(--layout-nav-max)] px-[var(--layout-section-px)] py-12 md:py-20">
        <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
          <div className="lg:col-span-7">
            <Skeleton
              variant="text"
              width={190}
              height={11}
              className="bg-surface-container-low!"
            />

            <div className="mt-6 flex flex-col gap-3">
              <Skeleton
                variant="rounded"
                width="92%"
                height={64}
                className="bg-surface-container-low!"
              />
              <Skeleton
                variant="rounded"
                width="74%"
                height={64}
                className="bg-surface-container-low!"
              />
              <Skeleton
                variant="rounded"
                width="46%"
                height={64}
                className="bg-surface-container-low!"
              />
            </div>

            <div className="mt-5 flex flex-col gap-2">
              <Skeleton
                variant="text"
                textSize="body-lg"
                width="100%"
                className="bg-surface-container-low!"
              />
              <Skeleton
                variant="text"
                textSize="body-lg"
                width="82%"
                className="bg-surface-container-low!"
              />
            </div>

            <div className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center">
              <Skeleton
                variant="rounded"
                width={210}
                height={48}
                className="bg-surface-container-low!"
              />
              <Skeleton
                variant="rounded"
                width={120}
                height={48}
                className="bg-surface-container-low!"
              />
            </div>
          </div>

          <div className="lg:col-span-5 lg:border-l lg:border-hairline lg:pl-8">
            <Skeleton
              variant="text"
              width={140}
              height={11}
              className="bg-surface-container-low!"
            />

            <div className="mt-4 border-t border-hairline">
              {[0, 1, 2, 3, 4].map((row) => (
                <div
                  key={row}
                  className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-hairline py-3"
                >
                  <Skeleton
                    variant="text"
                    width={18}
                    height={10}
                    className="bg-surface-container-low!"
                  />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton
                      variant="text"
                      width={160}
                      height={16}
                      className="bg-surface-container-low!"
                    />
                    <Skeleton
                      variant="text"
                      width={200}
                      height={10}
                      className="bg-surface-container-low!"
                    />
                  </div>
                  <Skeleton
                    variant="text"
                    width={12}
                    height={12}
                    className="bg-surface-container-low!"
                  />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function SuspenseWithBoundary({
  children,
  fallback,
}: {
  children: React.ReactElement
  fallback?: React.ReactNode
}) {
  const { pathname } = useLocation()
  return (
    <RouteErrorBoundary resetKey={pathname}>
      <Suspense
        fallback={
          fallback ?? (
            <div
              className="p-4 md:p-6 max-w-[var(--layout-content-max)] w-full mx-auto flex flex-col gap-3"
              aria-hidden="true"
            >
              <Skeleton variant="rounded" width="100%" height={56} />
              <Skeleton variant="rounded" width="100%" height={180} />
              <Skeleton variant="text" width="60%" />
              <Skeleton variant="text" width="85%" />
            </div>
          )
        }
      >
        {children}
      </Suspense>
    </RouteErrorBoundary>
  )
}

export const router = createBrowserRouter([
  // ── Public shell (marketing + auth pages) ──────────────────────────────
  {
    path: ROUTES.HOME,
    element: <Layout />,
    errorElement: <InternalServerError />,
    children: [
      { index: true, element: withSuspense(<HomePage />, <LandingFallback />) },
      {
        element: <PublicRoute />,
        children: [
          { path: ROUTE_SEGMENTS.LOGIN,  element: withSuspense(<LoginPage />) },
          { path: ROUTE_SEGMENTS.SIGNUP, element: withSuspense(<SignupPage />) },
        ],
      },
      {
        path: ROUTE_SEGMENTS.FORGOT_PASSWORD,
        element: withSuspense(<ForgotPasswordPage />),
      },
      {
        path: ROUTE_SEGMENTS.ACCOUNT_VERIFICATION,
        element: withSuspense(<AccountVerificationPage />),
      },
      {
        path: ROUTE_SEGMENTS.RESET_PASSWORD,
        element: withSuspense(<ResetPasswordPage />),
      },
      // 404 — catches any unmatched path within the public shell
      { path: '*', element: <NotFound /> },
    ],
  },

  // ── Dashboard shell (operator tool) ────────────────────────────────────
  {
    element: <UserProtectedRoute />,
    errorElement: <InternalServerError />,
    children: [
      {
        path: ROUTES.DASHBOARD.ROOT,
        element: <DashboardLayout />,
        children: [
          { index: true, element: withSuspense(<BotManagerPage />) },
          {
            path: ROUTE_SEGMENTS.SETTINGS,
            element: withSuspense(<SettingsPage />),
          },
          {
            path: ROUTE_SEGMENTS.CREATE_NEW_BOT,
            element: withSuspense(<NewBotPage />),
          },
          {
            path: ROUTE_SEGMENTS.CHAT_ROOM,
            element: withSuspense(<ChatRoomPage />),
          },
          {
            path: ROUTE_SEGMENTS.BOT,
            element: withSuspense(<BotLayout />),
            children: [
              { index: true, element: withSuspense(<BotConsolePage />) },
              {
                path: ROUTE_SEGMENTS.COMMANDS,
                element: withSuspense(<BotCommandsPage />),
              },
              {
                path: ROUTE_SEGMENTS.EVENTS,
                element: withSuspense(<BotEventsPage />),
              },
              {
                path: ROUTE_SEGMENTS.DATABASE,
                element: withSuspense(<BotDatabasePage />),
              },
              {
                path: ROUTE_SEGMENTS.SETTINGS,
                element: withSuspense(<BotSettingsPage />),
              },
            ],
          },
        ],
      },
    ],
  },

  // ── Admin shell — AdminAuthProvider scoped to this subtree only ─────────
  {
    element: <AdminLayout />,
    errorElement: <InternalServerError />,
    children: [
      {
        element: <AdminPublicRoute />,
        children: [
          {
            path: ROUTES.ADMIN.ROOT,
            element: withSuspense(<AdminLoginPage />),
          },
        ],
      },
      {
        path: ROUTES.ADMIN.FORGOT_PASSWORD,
        element: withSuspense(<AdminForgotPasswordPage />),
      },
      {
        path: ROUTES.ADMIN.RESET_PASSWORD,
        element: withSuspense(<AdminResetPasswordPage />),
      },
      {
        element: <AdminProtectedRoute />,
        children: [
          {
            element: <AdminSidebarLayout />,
            children: [
              {
                path: ROUTES.ADMIN.DASHBOARD,
                element: withSuspense(<AdminDashboardPage />),
              },
              {
                path: ROUTES.ADMIN.USERS,
                element: withSuspense(<AdminUsersPage />),
              },
              {
                path: ROUTES.ADMIN.BOTS,
                element: withSuspense(<AdminBotsPage />),
              },
              {
                path: ROUTES.ADMIN.GIT,
                element: withSuspense(<AdminGitPage />),
              },
              {
                path: ROUTES.ADMIN.FILES,
                element: withSuspense(<AdminFilesPage />),
              },
              {
                path: ROUTES.ADMIN.FILES_EDIT,
                element: withSuspense(<AdminFileEditorPage />),
              },
              {
                path: ROUTES.ADMIN.SETTINGS,
                element: withSuspense(<AdminSettingsPage />),
              },
            ],
          },
        ],
      },
    ],
  },
])
