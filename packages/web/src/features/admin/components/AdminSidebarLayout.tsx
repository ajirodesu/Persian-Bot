import { useState, useEffect, useRef, useCallback } from 'react'
import type { Dispatch, SetStateAction } from 'react'
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
  Files,
  GitBranch,
  ArrowLeft,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { cn } from '@/utils/cn.util'
import RouteProgressBar from '@/components/ui/feedback/RouteProgressBar'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import { AdminHeaderProvider, useAdminHeader } from '@/contexts/AdminHeaderContext'
import Logo from '@/components/ui/Logo'
import IconButton from '@/components/ui/buttons/IconButton'
import { ROUTES } from '@/constants/routes.constants'
import {
  H_HEIGHT,
  H_PX,
  H_BRAND_TEXT,
  H_SIDEBAR_WIDTH,
  H_SIDEBAR_NAV,
  H_SIDEBAR_ICON,
  H_AVATAR,
  H_AVATAR_TEXT,
  H_CHEVRON,
  H_DROPDOWN_ITEM,
  H_DROPDOWN_ICON,
  H_ICON_BTN_MOBILE,
  H_SEPARATOR,
} from '@/constants/header.constants'

// ============================================================================
// Constants
// ============================================================================

const NAV_ITEMS = [
  { path: ROUTES.ADMIN.DASHBOARD, label: 'Overview',      icon: LayoutDashboard },
  { path: ROUTES.ADMIN.USERS,     label: 'Users',         icon: Users },
  { path: ROUTES.ADMIN.BOTS,      label: 'Bot Sessions',  icon: Bot },
  { path: ROUTES.ADMIN.GIT,       label: 'Git',           icon: GitBranch },
  { path: ROUTES.ADMIN.FILES,     label: 'Files',         icon: Files },
  { path: ROUTES.ADMIN.SETTINGS,  label: 'Settings',      icon: Settings },
] as const

/** Width of the desktop sidebar when collapsed to an icon-only rail. */
const COLLAPSED_SIDEBAR_W = 'w-[4.75rem]' as const

/** localStorage key remembering the desktop sidebar collapse state. */
const COLLAPSED_STORAGE_KEY = 'admin-sidebar:collapsed:v1'

// ============================================================================
// SidebarNav
// ============================================================================

function SidebarNav({
  activePath,
  onNavClick,
  collapsed,
  onToggleCollapsed,
}: {
  activePath: string
  onNavClick?: () => void
  /** Desktop only: when true the nav collapses to an icon-only rail. */
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  return (
    <div className="flex h-full flex-col">
      {/* Identity row — h-14, Lucide Cat 28px accent + 17px brand */}
      <div
        className={cn(
          'flex items-center h-14 px-6 border-b shrink-0',
          H_SEPARATOR,
          collapsed && 'justify-center px-0',
        )}
      >
        <Link
          to={ROUTES.ADMIN.DASHBOARD}
          onClick={() => {
            onNavClick?.()
            if (collapsed) onToggleCollapsed?.()
          }}
          title={collapsed ? 'Cat-Bot Admin' : undefined}
          className="flex items-center gap-3.5 text-on-surface hover:opacity-75 transition-opacity duration-100 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg font-semibold tracking-tight"
        >
          <span className="flex items-center justify-center flex-shrink-0 text-primary">
            <Logo className="h-7 w-7" />
          </span>
          {!collapsed && <span className="text-[17px] leading-none">Cat-Bot Admin</span>}
        </Link>
      </div>

      {/* Primary nav — px-3 pt-4 space-y-1 drawer spec */}
      <nav
        className={cn(
          'flex-1 flex flex-col gap-0 overflow-y-auto',
          collapsed ? 'items-center px-0 py-3 space-y-1.5' : 'px-3 pt-4 space-y-1',
        )}
        aria-label="Admin navigation"
      >
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          const isActive = activePath === path
          return (
            <Link
              key={path}
              to={path}
              onClick={(e) => {
                if (isActive) {
                  // Desktop: tapping the current page collapses the sidebar
                  // to an icon rail. Mobile drawer: close instead.
                  if (onToggleCollapsed) {
                    e.preventDefault()
                    onToggleCollapsed()
                  } else {
                    onNavClick?.()
                  }
                  return
                }
                // Desktop: tapping another icon switches pages and keeps the
                // rail collapsed (VSCode/YouTube behaviour). Mobile: closes
                // the drawer.
                onNavClick?.()
              }}
              aria-current={isActive ? 'page' : undefined}
              title={collapsed ? label : undefined}
              className={cn(
                H_SIDEBAR_NAV,
                collapsed && 'justify-center !gap-0 !px-0',
                isActive
                  ? // Collapsed (desktop icon rail): highlight only the
                    // icon itself — no row box. Expanded: normal full-row
                    // highlight.
                    collapsed
                    ? 'bg-transparent border border-transparent font-semibold text-primary'
                    : 'bg-primary/10 border border-primary/20 font-semibold text-primary'
                  : 'border border-transparent font-medium text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface active:bg-surface-container-highest active:opacity-[0.85]',
              )}
            >
              <span
                className={cn(
                  'flex items-center justify-center flex-shrink-0 transition-colors duration-100',
                  isActive ? 'text-primary' : 'text-on-surface-variant',
                )}
              >
                <Icon className={H_SIDEBAR_ICON} />
              </span>
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Footer — ADMIN scope label + live dot, collapse toggle */}
      <div className="border-t border-separator">
        <div
          className={cn(
            'py-4 flex items-center',
            collapsed ? 'justify-center px-0' : 'justify-between px-6',
          )}
        >
          {!collapsed && (
            <>
              <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-surface-variant font-medium">
                Admin Panel
              </span>
              <span className="flex items-center space-x-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              </span>
            </>
          )}
          {onToggleCollapsed && (
            <IconButton
              variant="text"
              size="sm"
              icon={
                collapsed ? (
                  <PanelLeftOpen className="h-4 w-4" />
                ) : (
                  <PanelLeftClose className="h-4 w-4" />
                )
              }
              aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={onToggleCollapsed}
            />
          )}
        </div>
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
          'flex items-center gap-1.5 rounded-[var(--radius-input)] transition-colors duration-fast',
          // Mobile: 36px centered box — same footprint as the hamburger
          // (H_ICON_BTN_MOBILE), so both header edges align. Desktop keeps
          // the avatar-plus-chevron pill.
          'h-9 w-9 justify-center md:h-auto md:w-auto md:justify-start md:px-2 md:py-1.5',
          'hover:bg-on-surface/[var(--state-hover-opacity)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
          open && 'bg-on-surface/[var(--state-hover-opacity)]',
        )}
      >
        <span
          className={cn(
            'flex items-center justify-center rounded-full shrink-0 bg-primary text-on-primary select-none font-bold',
            H_AVATAR,
            H_AVATAR_TEXT,
          )}
        >
          {initials}
        </span>
        <ChevronDown
          className={cn(
            H_CHEVRON,
            'text-on-surface-variant transition-transform duration-fast hidden md:block',
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
            'rounded-[var(--radius-input)] border border-outline-variant/80 bg-surface-container-low',
            'shadow-elevation-3 py-1 overflow-hidden',
            '[animation:fade-in-down_150ms_var(--easing-standard-decelerate)_both]',
          )}
        >
          {/* Identity header */}
          <div className="flex items-center gap-2.5 px-3.5 py-3 border-b border-hairline">
            <span
              className={cn(
                'flex items-center justify-center rounded-full shrink-0 bg-primary text-on-primary select-none font-bold',
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

          {/* Back to Main Dashboard — client-side Link to the existing
              Main Dashboard route; lives in the profile menu so it is
              reachable on desktop and mobile wherever the header is. */}
          <Link
            to={ROUTES.DASHBOARD.ROOT}
            role="menuitem"
            onClick={() => setOpen(false)}
            className={cn(
              H_DROPDOWN_ITEM,
              'font-medium text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)] transition-colors duration-fast',
            )}
          >
            <ArrowLeft className={cn(H_DROPDOWN_ICON, 'shrink-0')} />
            Back to Main Dashboard
          </Link>

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
  // Desktop only: collapse the sidebar to an icon rail (VSCode/YouTube style)
  // when the user taps the currently-active nav item. Persisted across refreshes.
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSED_STORAGE_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(COLLAPSED_STORAGE_KEY, next ? '1' : '0')
      } catch {
        // Ignore storage failures (private mode / quota).
      }
      return next
    })
  }, [])
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
    <AdminHeaderProvider>
    <RouteProgressBar />
    <div className="min-h-screen flex bg-surface-container-high">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'glass-surface hidden md:flex shrink-0 flex-col border-r border-hairline sticky top-0 h-screen overflow-y-hidden transition-[width] duration-normal',
          collapsed ? COLLAPSED_SIDEBAR_W : H_SIDEBAR_WIDTH,
        )}
      >
        <SidebarNav
          activePath={activePath}
          collapsed={collapsed}
          onToggleCollapsed={toggleCollapsed}
        />
      </aside>

      {/* Mobile scrim */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-drawer bg-scrim/50 md:hidden [backdrop-filter:var(--surface-blur-sm)]"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Mobile slide-in drawer */}
      <aside
        className={cn(
          'glass-surface fixed inset-y-0 left-0 z-modal flex flex-col border-r border-hairline md:hidden transition-transform duration-normal',
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
      <div className={cn('flex-1 flex flex-col min-w-0')}>
        {/* Content header — Bot Manager bar. Pages may replace the three
            slots (left button, title, right button) through
            AdminHeaderContext instead of rendering a second header. */}
        <AdminContentHeader
          mobileOpen={mobileOpen}
          setMobileOpen={setMobileOpen}
          currentLabel={currentLabel}
          user={user}
          handleLogout={handleLogout}
        />

        <main className={cn('flex-1 p-4 md:p-6 max-w-7xl w-full mx-auto')}>
          <Outlet />
        </main>
      </div>
    </div>
    </AdminHeaderProvider>
  )
}

function AdminContentHeader({
  mobileOpen,
  setMobileOpen,
  currentLabel,
  user,
  handleLogout,
}: {
  mobileOpen: boolean
  setMobileOpen: Dispatch<SetStateAction<boolean>>
  currentLabel: string
  user: { name?: string | null; email?: string | null } | null
  handleLogout: () => void
}) {
  const { override } = useAdminHeader()
  return (
        <div
          className={cn(
            'sticky top-0 z-[100] flex items-center bg-surface border-b',
            H_SEPARATOR,
            H_HEIGHT,
            H_PX,
          )}
        >
          {/* Left slot — hamburger by default */}
          {override?.left ?? (
          <IconButton
            icon={mobileOpen ? <X /> : <Menu />}
            aria-label={mobileOpen ? 'Close navigation' : 'Open navigation menu'}
            variant="text"
            size="md"
            className={cn('md:hidden', H_ICON_BTN_MOBILE)}
            onClick={() => setMobileOpen((p) => !p)}
          />
          )}

          {/* Desktop: page title */}
          <span
            className={cn(
              H_BRAND_TEXT,
              'hidden md:inline-flex text-on-surface select-none font-semibold tracking-tight min-w-0 truncate',
            )}
          >
            {override?.title ?? currentLabel}
          </span>

          {/* Mobile: page title — centred Bot Manager title */}
          <div
            className={cn(
              'absolute inset-0 flex items-center justify-center pointer-events-none px-14 md:hidden',
            )}
          >
            <span
              className={cn(
                H_BRAND_TEXT,
                'text-on-surface select-none font-semibold tracking-tight truncate',
              )}
            >
              {override?.title ?? currentLabel}
            </span>
          </div>

          {/* Right slot — avatar menu by default */}
          <div className="ml-auto">
            {override?.right ?? <AdminAvatarMenu user={user} onLogout={handleLogout} />}
          </div>
        </div>
  )
}
