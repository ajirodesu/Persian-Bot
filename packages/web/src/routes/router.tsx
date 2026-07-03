/* eslint-disable react-refresh/only-export-components */
import React, { lazy, Suspense } from 'react'
import { createBrowserRouter, Outlet } from 'react-router-dom'
import { ROUTES, ROUTE_SEGMENTS } from '@/constants/routes.constants'

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
const BotConsolePage = lazy(() => import('@/pages/dashboard/bot/index'))
const BotCommandsPage = lazy(() => import('@/pages/dashboard/bot/commands'))
const BotEventsPage = lazy(() => import('@/pages/dashboard/bot/events'))
const BotSettingsPage = lazy(() => import('@/pages/dashboard/bot/settings'))
const AdminLoginPage = lazy(() => import('@/pages/admin'))
const AdminForgotPasswordPage = lazy(() => import('@/pages/admin/ForgotPassword'))
const AdminResetPasswordPage = lazy(() => import('@/pages/admin/ResetPassword'))
const AdminDashboardPage = lazy(() => import('@/pages/admin/dashboard'))
const AdminUsersPage = lazy(() => import('@/pages/admin/dashboard/users'))
const AdminBotsPage = lazy(() => import('@/pages/admin/dashboard/bots'))
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

/**
 * Wraps lazy pages in a Suspense boundary. The blank surface fallback matches
 * the body background to prevent a flash of white during bundle resolution.
 */
const withSuspense = (node: React.ReactElement) => (
  <Suspense fallback={<div className="min-h-screen bg-surface-container-lowest" />}>
    {node}
  </Suspense>
)

export const router = createBrowserRouter([
  // ── Public shell (marketing + auth pages) ──────────────────────────────
  {
    path: ROUTES.HOME,
    element: <Layout />,
    errorElement: <InternalServerError />,
    children: [
      { index: true, element: withSuspense(<HomePage />) },
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
