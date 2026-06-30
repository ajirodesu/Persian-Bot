import React from 'react'
import { Navigate, useLocation, Outlet } from 'react-router-dom'
import { useUserAuth } from '@/contexts/UserAuthContext'
import Progress from '@/components/ui/feedback/Progress'
import { ROUTES } from '@/constants/routes.constants'

/**
 * UserProtectedRoute guard component
 *
 * Protects routes that require authentication (e.g., /dashboard).
 * If user is NOT authenticated, redirect to login page (/login).
 */
const UserProtectedRoute: React.FC = () => {
  const { isAuthenticated, isLoading } = useUserAuth()
  const location = useLocation()

  // Show loading state while checking authentication
  if (isLoading) {
    return <Progress.Circular fullScreen message="Checking authentication..." />
  }

  // If not authenticated, redirect to login page (/login)
  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} state={{ from: location }} replace />
  }

  // If authenticated, render the protected route
  return <Outlet />
}

export default UserProtectedRoute
