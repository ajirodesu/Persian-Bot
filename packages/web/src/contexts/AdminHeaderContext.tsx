import React, { createContext, useContext, useMemo, useState } from 'react'

/**
 * Admin Header Override
 *
 * Lets a page rendered inside AdminSidebarLayout replace the content
 * header's three slots (left button, title, right button) without adding a
 * second header. Pages that don't set an override get the standard
 * hamburger · page-title · avatar header. The override is cleared when the
 * owning page unmounts.
 */

export interface AdminHeaderOverride {
  /** Replaces the hamburger (rendered without its mobile-only hiding). */
  left?: React.ReactNode
  /** Rendered inside the standard title spans (desktop + mobile). */
  title?: React.ReactNode
  /** Replaces the avatar menu. */
  right?: React.ReactNode
}

interface AdminHeaderContextType {
  override: AdminHeaderOverride | null
  setOverride: (override: AdminHeaderOverride | null) => void
}

const AdminHeaderContext = createContext<AdminHeaderContextType | undefined>(
  undefined,
)

// eslint-disable-next-line react-refresh/only-export-components
export const useAdminHeader = () => {
  const context = useContext(AdminHeaderContext)
  if (!context) {
    throw new Error('useAdminHeader must be used within an AdminHeaderProvider')
  }
  return context
}

export const AdminHeaderProvider: React.FC<{
  children: React.ReactNode
}> = ({ children }) => {
  const [override, setOverride] = useState<AdminHeaderOverride | null>(null)

  const value = useMemo<AdminHeaderContextType>(
    () => ({ override, setOverride }),
    [override],
  )

  return (
    <AdminHeaderContext.Provider value={value}>
      {children}
    </AdminHeaderContext.Provider>
  )
}
