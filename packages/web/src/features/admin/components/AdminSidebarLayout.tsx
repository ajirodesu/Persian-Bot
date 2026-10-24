import { useState, useEffect, useRef, useCallback } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import ConnectionBanner from '@/components/ui/feedback/ConnectionBanner'
import { useTimezone } from '@/contexts/TimezoneContext'
import WidgetErrorBoundary from '@/components/ui/feedback/WidgetErrorBoundary'
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
} from 'lucide-react'
import { cn } from '@/utils/cn.util'
import RouteProgressBar from '@/components/ui/feedback/RouteProgressBar'
import SidebarFooter from '@/components/layout/SidebarFooter'
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
  H_SIDEBAR_INDEX,
  H_SECTION_LABEL,
  H_SHELL_SCOPE,
  H_LOGO_ICON,
  H_AVATAR,
  H_AVATAR_TEXT,
  H_CHEVRON,
  H_DROPDOWN_ITEM,
  H_DROPDOWN_ICON,
  H_ICON_BTN_MOBILE,
  H_SEPARATOR,
  H_SURFACE,
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
// NavRow — one line of the admin ledger
// ============================================================================

/**
 * A single navigational line: mono ordinal, icon, label, and a 2px left rule
 * that turns primary while the row is the current page. All six admin
 * destinations render through this one component so their geometry cannot
 * drift apart.
 *
 * Clicking the row for the page you are already on keeps its historical
 * behaviour: on desktop it collapses the rail, in the mobile drawer it closes.
 */
function NavRow({
  to,
  label,
  ordinal,
  icon,
  isActive,
  collapsed,
  onNavClick,
  onToggleCollapsed,
}: {
  to: string
  label: string
  ordinal: string
  icon: ReactNode
  isActive: boolean
  collapsed?: boolean
  onNavClick?: () => void
  onToggleCollapsed?: () => void
}) {
  return (
    <Link
      to={to}
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
        collapsed && 'justify-center !gap-0 !px-0 !border-l-0',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        isActive
          ? // `border-l-primary` (not `border-primary`) so the 2px current-page
            // rule reliably wins over the base row's `border-transparent`:
            // cn() is a plain join, so equal-property utilities would fall
            // back to stylesheet order.
            'border-l-primary bg-primary/[0.06] text-on-surface'
          : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface active:bg-surface-container-highest',
      )}
    >
      {!collapsed && (
        <span
          aria-hidden="true"
          className={cn(
            H_SIDEBAR_INDEX,
            isActive ? 'text-primary' : 'text-on-surface-variant/85',
          )}
        >
          {ordinal}
        </span>
      )}
      <span
        className={cn(
          'flex shrink-0 items-center justify-center',
          isActive ? 'text-primary' : 'text-on-surface-variant',
        )}
      >
        {icon}
      </span>
      {!collapsed && <span className="truncate">{label}</span>}
    </Link>
  )
}

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
      {/* Identity row — h-14, 20px mark + condensed wordmark + mono scope tag */}
      <div
        className={cn(
          'flex h-14 shrink-0 items-center border-b px-6',
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
          className={cn(
            'flex min-w-0 items-center gap-2.5 text-on-surface',
            'transition-opacity duration-fast hover:opacity-80',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            !collapsed && 'w-full',
          )}
        >
          <span className="flex shrink-0 items-center justify-center text-primary">
            <Logo className={H_LOGO_ICON} />
          </span>
          {!collapsed && (
            <>
              <span className={cn(H_BRAND_TEXT, 'truncate')}>CAT-BOT</span>
              <span className={cn(H_SHELL_SCOPE, 'ml-auto pr-1')}>/ ADMIN</span>
            </>
          )}
        </Link>
      </div>

      {/* Primary nav — a ledger table with one rule label above the rows */}
      <nav
        className={cn(
          'flex flex-1 flex-col overflow-y-auto',
          collapsed ? 'items-center gap-1 py-3' : 'pb-3',
        )}
        aria-label="Admin navigation"
      >
        {!collapsed && <div className={H_SECTION_LABEL}>ADMIN</div>}

        {NAV_ITEMS.map(({ path, label, icon: Icon }, index) => (
          <NavRow
            key={path}
            to={path}
            label={label}
            ordinal={String(index + 1).padStart(2, '0')}
            icon={<Icon className="h-4 w-4 shrink-0" />}
            isActive={activePath === path}
            collapsed={collapsed}
            onNavClick={onNavClick}
            onToggleCollapsed={onToggleCollapsed}
          />
        ))}
      </nav>

      {/* Footer — live status + Admin Panel scope, collapse toggle */}
      <SidebarFooter
        scopeLabel="Admin Panel"
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
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
          // the avatar-plus-chevron trigger.
          'h-9 w-9 justify-center md:h-auto md:w-auto md:justify-start md:px-2 md:py-1.5',
          'hover:bg-on-surface/[var(--state-hover-opacity)]',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
          open && 'bg-on-surface/[var(--state-hover-opacity)]',
        )}
      >
        <span
          className={cn(
            'flex shrink-0 select-none items-center justify-center rounded-[var(--radius-compact)]',
            'border border-primary/50 bg-primary text-on-primary',
            H_AVATAR,
            H_AVATAR_TEXT,
          )}
        >
          {initials}
        </span>
        <ChevronDown
          className={cn(
            H_CHEVRON,
            'hidden text-on-surface-variant transition-transform duration-fast md:block',
            open && 'rotate-180',
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Admin account menu"
          className={cn(
            'absolute right-0 top-full z-dropdown mt-1.5 min-w-[210px]',
            'overflow-hidden rounded-[var(--radius-input)] border border-outline-variant bg-surface-container-low',
            'py-1 shadow-none',
            '[animation:fade-in-down_150ms_var(--easing-standard-decelerate)_both]',
          )}
        >
          {/* Identity header — square stamp, name, mono address */}
          <div className="flex items-center gap-2.5 border-b border-hairline px-3.5 py-3">
            <span
              className={cn(
                'flex shrink-0 select-none items-center justify-center rounded-[var(--radius-compact)]',
                'border border-primary/50 bg-primary text-on-primary',
                H_AVATAR,
                H_AVATAR_TEXT,
              )}
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-title-sm text-on-surface">
                {displayName}
              </p>
              {user?.email && (
                <p className="truncate font-mono text-[10px] uppercase tracking-[0.04em] text-on-surface-variant/85">
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
              'text-on-surface hover:bg-on-surface/[var(--state-hover-opacity)]',
            )}
          >
            <ArrowLeft className={H_DROPDOWN_ICON} />
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
              'text-error hover:bg-error/[var(--state-hover-opacity)]',
            )}
          >
            <LogOut className={H_DROPDOWN_ICON} />
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
  const { refreshTimezone } = useTimezone()

  // Admin sessions are separate from the user session the timezone provider
  // waits on, so load the saved preference once this shell is authenticated.
  useEffect(() => {
    refreshTimezone()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
      <div className="flex min-h-screen bg-surface-container-high">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            'hidden shrink-0 flex-col border-r border-hairline bg-surface-container-low md:flex',
            'sticky top-0 h-screen overflow-y-hidden transition-[width] duration-normal',
            collapsed ? COLLAPSED_SIDEBAR_W : H_SIDEBAR_WIDTH,
          )}
        >
          <SidebarNav
            activePath={activePath}
            collapsed={collapsed}
            onToggleCollapsed={toggleCollapsed}
          />
        </aside>

        {/* Mobile scrim — flat ink, no blur */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-drawer bg-scrim/60 md:hidden"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Mobile slide-in drawer */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-modal flex flex-col border-r border-hairline bg-surface-container-low md:hidden',
            'transition-transform duration-normal',
            H_SIDEBAR_WIDTH,
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          aria-label="Mobile admin navigation"
          aria-modal={mobileOpen}
          inert={!mobileOpen}
        >
          <SidebarNav
            activePath={activePath}
            onNavClick={() => setMobileOpen(false)}
          />
        </aside>

        {/* Main content column */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Content header — pages may replace the three slots (left button,
              label, right button) through AdminHeaderContext instead of
              rendering a second header. */}
          <AdminContentHeader
            mobileOpen={mobileOpen}
            setMobileOpen={setMobileOpen}
            currentLabel={currentLabel}
            user={user}
            handleLogout={handleLogout}
          />

          <ConnectionBanner />

          <main className="mx-auto flex-1 w-full max-w-[var(--layout-content-max)] px-[var(--layout-main-p)] py-6 md:py-8">
            <WidgetErrorBoundary label="Admin content" resetKey={activePath}>
              <Outlet />
            </WidgetErrorBoundary>
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
        'sticky top-0 z-[100] flex items-center gap-2 border-b',
        H_SURFACE,
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

      {/* One left-aligned cluster: scope prefix + current label. An override
          title replaces the label only, never the scope prefix. */}
      <div className="flex min-w-0 items-center gap-2">
        <span className={cn(H_SHELL_SCOPE, 'hidden sm:inline')}>ADMIN /</span>
        <span className={cn(H_BRAND_TEXT, 'min-w-0 truncate text-on-surface')}>
          {override?.title ?? currentLabel}
        </span>
      </div>

      {/* Right slot — avatar menu by default */}
      <div className="ml-auto pl-2">
        {override?.right ?? <AdminAvatarMenu user={user} onLogout={handleLogout} />}
      </div>
    </div>
  )
}
