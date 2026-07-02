import React, { createContext, useContext, useMemo, useCallback } from 'react'

/**
 * Dashboard Sidebar Context
 *
 * Single source of truth for the mobile off-canvas sidebar's open/closed
 * state. `DashboardLayout` owns the drawer + scrim markup; any page rendered
 * inside it (e.g. the Chat Room, which renders its own header instead of the
 * shared content header) can open/close that same drawer via `toggle()`
 * without re-implementing a second hamburger/drawer pair.
 */

interface DashboardSidebarContextType {
  mobileOpen: boolean
  setMobileOpen: (open: boolean) => void
  toggle: () => void
}

const DashboardSidebarContext = createContext<DashboardSidebarContextType | undefined>(
  undefined,
)

// eslint-disable-next-line react-refresh/only-export-components
export const useDashboardSidebar = () => {
  const context = useContext(DashboardSidebarContext)
  if (!context) {
    throw new Error('useDashboardSidebar must be used within a DashboardSidebarProvider')
  }
  return context
}

export const DashboardSidebarProvider: React.FC<{
  children: React.ReactNode
  open: boolean
  onOpenChange: (open: boolean) => void
}> = ({ children, open, onOpenChange }) => {
  const toggle = useCallback(() => onOpenChange(!open), [open, onOpenChange])

  const value = useMemo<DashboardSidebarContextType>(
    () => ({ mobileOpen: open, setMobileOpen: onOpenChange, toggle }),
    [open, onOpenChange, toggle],
  )

  return (
    <DashboardSidebarContext.Provider value={value}>
      {children}
    </DashboardSidebarContext.Provider>
  )
}
