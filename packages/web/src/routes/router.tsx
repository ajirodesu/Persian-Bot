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

// Page bundles — split per-route so the initial JS payload stays small.
const HomePage = lazy(() => import('@/pages/Home'))
const LoginPage = lazy(() => import('@/pages/Login'))
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
const AIAgentPage = lazy(() => import('@/pages/dashboard/ai-agent'))
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
const AdminMcpSkillsPage = lazy(() => import('@/pages/admin/dashboard/mcp-skills'))
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
 * Landing-shaped placeholder: badge, headline, copy, CTAs, and a visual
 * block in the same max-width/column structure as the home page, so the
 * footer below doesn't jump when the chunk lands.
 */
function LandingFallback() {
  return (
    <div
      className="w-full max-w-md mx-auto px-5 pt-6 pb-12 flex flex-col gap-10 lg:max-w-6xl lg:px-8"
      aria-hidden="true"
    >
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <div className="flex flex-col gap-5 pt-2">
          <Skeleton variant="pill" width={120} height={24} />
          <Skeleton variant="rounded" width="100%" height={44} />
          <Skeleton variant="rounded" width="70%" height={44} />
          <Skeleton variant="text" width="100%" />
          <Skeleton variant="text" width="85%" />
          <div className="flex gap-3 pt-2">
            <Skeleton variant="rounded" width={150} height={48} />
            <Skeleton variant="rounded" width={150} height={48} />
          </div>
        </div>
        <Skeleton variant="rounded" width="100%" height={280} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Skeleton variant="rounded" width="100%" height={140} />
        <Skeleton variant="rounded" width="100%" height={140} />
        <Skeleton variant="rounded" width="100%" height={140} />
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
              className="p-4 md:p-6 max-w-7xl w-full mx-auto flex flex-col gap-3"
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
            path: ROUTE_SEGMENTS.AI_AGENT,
            element: withSuspense(<AIAgentPage />),
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
                path: ROUTES.ADMIN.MCP_SKILLS,
                element: withSuspense(<AdminMcpSkillsPage />),
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
