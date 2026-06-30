import { useState, useEffect, useRef } from 'react'
import { Outlet, Link, useNavigate, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  Users,
  Bot,
  LogOut,
  Menu,
  Settings,
  ChevronDown,
  X,
} from 'lucide-react'
import { cn } from '@/utils/cn.util'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import Logo from '@/components/ui/Logo'
import IconButton from '@/components/ui/buttons/IconButton'
import { ROUTES } from '@/constants/routes.constants'
import {
  H_HEIGHT,
  H_PX,
  H_LOGO_ICON,
  H_BRAND_TEXT,
  H_SIDEBAR_WIDTH,
  H_SIDEBAR_NAV,
  H_SIDEBAR_ICON,
  H_AVATAR,
  H_AVATAR_TEXT,
  H_CHEVRON,
  H_DROPDOWN_ITEM,
  H_DROPDOWN_ICON,
} from '@/constants/header.constants'

// ============================================================================
// Constants
// ============================================================================

const NAV_ITEMS = [
  { path: ROUTES.ADMIN.DASHBOARD, label: 'Overview',      icon: LayoutDashboard },
  { path: ROUTES.ADMIN.USERS,     label: 'Users',         icon: Users },
  { path: ROUTES.ADMIN.BOTS,      label: 'Bot Sessions',  icon: Bot },
  { path: ROUTES.ADMIN.SETTINGS,  label: 'Settings',      icon: Settings },
] as const

// ============================================================================
// SidebarNav
// ============================================================================

function SidebarNav({
  activePath,
  onNavClick,
}: {
  activePath: string
  onNavClick?: () => void
}) {
  return (
    <div className="flex flex-col h-full">
      {/* Sidebar header — aligns with content header */}
      <div
        className={cn(
          'flex items-center border-b border-outline-variant/70 shrink-0',
          H_HEIGHT,
          H_PX,
        )}
      >
        <Link
          to={ROUTES.ADMIN.DASHBOARD}
          onClick={onNavClick}
          className={cn(
            'flex items-center gap-2 text-primary hover:opacity-75 transition-opacity duration-fast outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-md font-semibold tracking-tight',
            H_BRAND_TEXT,
          )}
        >
          <Logo className={H_LOGO_ICON} />
          Cat-Bot Admin
        </Link>
      </div>

      {/* Primary nav */}
      <nav
        className="flex-1 px-2.5 py-3 flex flex-col gap-0.5 overflow-y-auto"
        aria-label="Admin navigation"
      >
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          const isActive = activePath === path
          return (
            <Link
              key={path}
              to={path}
              onClick={onNavClick}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                H_SIDEBAR_NAV,
                'rounded-xl font-medium transition-colors duration-fast',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-on-surface-variant hover:bg-on-surface/[var(--state-hover-opacity)] hover:text-on-surface',
              )}
            >
              <Icon className={cn(H_SIDEBAR_ICON, 'shrink-0')} />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Sidebar footer — version hint */}
      <div className="px-4 py-3 border-t border-outline-variant/50">
        <p className="text-label-xs text-on-surface-variant/40 font-mono tracking-widest uppercase">
          Admin Panel
        </p>
      </div>
    </div>
  )
}

// ============================================================================
// AdminAvatarMenu
// ============================================================================

function AdminAvatarMenu({
  user,
  onLogout,
}: {
  user: { name?: string | null; email?: string | null } | null
  onLogout: () => void
}) {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open])

  const displayName = user?.name ?? 'Admin'
  const initials = displayName
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${displayName} — account menu`}
        className={cn(
          'flex items-center gap-1.5 rounded-lg px-2 py-1.5 transition-colors duration-fast',
          'hover:bg-on-surface/[var(--state-hover-opacity)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          open && 'bg-on-surface/[var(--state-hover-opacity)]',
        )}
      >
        <span
          className={cn(
            'flex items-center justify-center rounded-full shrink-0 bg-primary-container text-on-primary-container select-none font-bold',
            H_AVATAR,
            H_AVATAR_TEXT,
          )}
        >
          {initials}
        </span>
        <ChevronDown
          className={cn(
            H_CHEVRON,
            'text-on-surface-variant transition-transform duration-fast hidden sm:block',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Admin account menu"
          className={cn(
            'absolute right-0 top-full mt-1.5 z-dropdown min-w-[210px]',
            'rounded-xl border border-outline-variant/80 bg-surface-container-low',
            'shadow-elevation-3 py-1 overflow-hidden',
            '[animation:fade-in-down_150ms_var(--easing-standard-decelerate)_both]',
          )}
        >
          {/* Identity header */}
          <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-outline-variant/60">
            <span
              className={cn(
                'flex items-center justify-center rounded-full shrink-0 bg-primary-container text-on-primary-container select-none font-bold',
                H_AVATAR,
                H_AVATAR_TEXT,
              )}
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p className="text-label-md font-semibold text-on-surface truncate">
                {displayName}
              </p>
              {user?.email && (
                <p className="text-label-xs text-on-surface-variant/70 truncate">
                  {user.email}
                </p>
              )}
            </div>
          </div>

          {/* Logout */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onLogout()
            }}
            className={cn(
              H_DROPDOWN_ITEM,
              'font-medium text-error hover:bg-error/[var(--state-hover-opacity)] transition-colors duration-fast',
            )}
          >
            <LogOut className={cn(H_DROPDOWN_ICON, 'shrink-0')} />
            Log out
          </button>
        </div>
      )}
    </div>
  )
}

// ============================================================================
// AdminSidebarLayout
// ============================================================================

export default function AdminSidebarLayout() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user, logout } = useAdminAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const activePath = location.pathname

  const [prevPath, setPrevPath] = useState(activePath)
  if (activePath !== prevPath) {
    setPrevPath(activePath)
    setMobileOpen(false)
  }

  useEffect(() => {
    if (!mobileOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [mobileOpen])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [mobileOpen])

  const handleLogout = () => {
    logout()
      .catch(() => {})
      .finally(() => {
        navigate(ROUTES.ADMIN.ROOT)
      })
  }

  const currentLabel =
    NAV_ITEMS.find((i) => i.path === activePath)?.label ?? 'Admin'

  return (
    <div className="min-h-screen flex bg-surface-container-high">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden md:flex shrink-0 flex-col bg-surface border-r border-outline-variant/70 sticky top-0 h-screen overflow-y-hidden',
          H_SIDEBAR_WIDTH,
        )}
      >
        <SidebarNav activePath={activePath} />
      </aside>

      {/* Mobile scrim */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-drawer bg-scrim/50 md:hidden backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile slide-in drawer */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-modal flex flex-col bg-surface border-r border-outline-variant/70 md:hidden transition-transform duration-normal',
          H_SIDEBAR_WIDTH,
          mobileOpen ? 'translate-x-0 shadow-elevation-4' : '-translate-x-full',
        )}
        aria-label="Mobile admin navigation"
        aria-modal={mobileOpen}
      >
        <SidebarNav
          activePath={activePath}
          onNavClick={() => setMobileOpen(false)}
        />
      </aside>

      {/* Main content column */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Content header */}
        <div
          className={cn(
            'sticky top-0 z-sticky bg-surface/90 backdrop-blur-xl border-b border-outline-variant/70 flex items-center',
            H_HEIGHT,
            H_PX,
          )}
        >
          {/* Mobile hamburger */}
          <IconButton
            icon={mobileOpen ? <X /> : <Menu />}
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation menu'}
            variant="text"
            size="md"
            className="md:hidden"
            onClick={() => setMobileOpen((p) => !p)}
          />

          {/* Desktop: page title */}
          <span
            className={cn(
              H_BRAND_TEXT,
              'hidden md:inline-flex text-on-surface select-none font-semibold tracking-tight',
            )}
          >
            {currentLabel}
          </span>

          {/* Mobile: page title — absolutely centred */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none md:hidden">
            <span
              className={cn(
                H_BRAND_TEXT,
                'text-on-surface select-none font-semibold tracking-tight',
              )}
            >
              {currentLabel}
            </span>
          </div>

          {/* Avatar menu */}
          <div className="ml-auto">
            <AdminAvatarMenu user={user} onLogout={handleLogout} />
          </div>
        </div>

        <main className="flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
