import {
  Fragment,
  useState,
  useEffect,
  useRef,
  useCallback,
  memo,
} from 'react'
import type { ReactNode } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  LogOut,
  Menu,
  X,
  Bot,
  MessageSquare,
  Settings as SettingsIcon,
  Plus,
  ShieldCheck,
} from 'lucide-react'
import SidebarFooter from '@/components/layout/SidebarFooter'
import Logo from '@/components/ui/Logo'
import ScrollToTop from '@/components/ScrollToTop'
import { getPlatformIconComponent } from '@/components/icons/platform-icon.util'
import { botService } from '@/features/users/services/bot.service'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { DashboardSidebarProvider } from '@/contexts/DashboardSidebarContext'
import { cn } from '@/utils/cn.util'
import RouteProgressBar from '@/components/ui/feedback/RouteProgressBar'
import {
  prefetchDashboardHome,
  prefetchChatRoom,
  prefetchDashboardSettings,
} from '@/lib/route-prefetch.lib'
import IconButton from '@/components/ui/buttons/IconButton'
import { ROUTES } from '@/constants/routes.constants'
import { connectSocket } from '@/lib/socket.lib'
import { useConnectivity } from '@/contexts/ConnectivityContext'
import ConnectionBanner from '@/components/ui/feedback/ConnectionBanner'
import WidgetErrorBoundary from '@/components/ui/feedback/WidgetErrorBoundary'
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
  { path: ROUTES.DASHBOARD.ROOT, label: 'Bot Manager', icon: Bot },
  { path: ROUTES.DASHBOARD.CHAT_ROOM, label: 'Chat Room', icon: MessageSquare },
  { path: ROUTES.DASHBOARD.SETTINGS, label: 'Settings', icon: SettingsIcon },
] as const

/**
 * Hover/focus chunk prefetch per nav destination — warms the route bundle
 * while the pointer is still travelling toward the click.
 */
const NAV_PREFETCH: Record<string, () => void> = {
  [ROUTES.DASHBOARD.ROOT]: prefetchDashboardHome,
  [ROUTES.DASHBOARD.CHAT_ROOM]: prefetchChatRoom,
  [ROUTES.DASHBOARD.SETTINGS]: prefetchDashboardSettings,
}

/** Width of the desktop sidebar when collapsed to an icon-only rail. */
const COLLAPSED_SIDEBAR_W = 'w-[4.75rem]' as const

/** localStorage key remembering the desktop sidebar collapse state. */
const COLLAPSED_STORAGE_KEY = 'dashboard-sidebar:collapsed:v1'

/**
 * Routes that only claim the sidebar (and their content header label) while
 * they are actually open — never statically listed in NAV_ITEMS. Mirrors how
 * the "currently open bot" entry behaves: it appears for exactly as long as
 * its route is active and disappears the instant you navigate away.
 */
const DYNAMIC_NAV_PATHS: readonly string[] = [ROUTES.DASHBOARD.CREATE_NEW_BOT]

/**
 * Active-route resolution shared by the sidebar nav.
 *
 * Bot Manager sits at the dashboard root ("/dashboard"), so a naive prefix
 * check (`pathname.startsWith(itemPath)`) makes it light up on *every*
 * nested route — including ones already owned by another nav item, like
 * "/dashboard/chat-room" or "/dashboard/settings". That produced two
 * simultaneously-highlighted sidebar entries. Bot Manager should only be
 * treated as active for its own nested routes (e.g. bot detail pages),
 * never for a path that another top-level nav item already claims.
 */
function isNavItemActive(itemPath: string, pathname: string): boolean {
  const isRootRoute = itemPath === ROUTES.DASHBOARD.ROOT
  const matches = (path: string) => pathname === path || pathname.startsWith(`${path}/`)

  if (!isRootRoute) return matches(itemPath)

  if (pathname === itemPath) return true

  const claimedByAnotherNavItem = NAV_ITEMS.some(
    (item) => item.path !== itemPath && matches(item.path),
  )
  // A dynamically-shown route (e.g. Create New Bot) also claims its path, so
  // Bot Manager must not light up while one of those pages is open.
  const claimedByDynamicRoute = DYNAMIC_NAV_PATHS.some(
    (path) => path !== itemPath && matches(path),
  )

  return matches(itemPath) && !claimedByAnotherNavItem && !claimedByDynamicRoute
}

// ============================================================================
// NavRow — one line of the sidebar ledger
// ============================================================================

/**
 * A single navigational line: mono ordinal, icon, label, and a 2px left rule
 * that turns primary while the row is the current page. Every static and
 * dynamic entry renders through this one component, so the three routes, the
 * open bot, and the create wizard cannot drift apart.
 *
 * Clicking the row for the page you are already on keeps its historical
 * behaviour: on desktop it collapses the rail, in the mobile drawer it closes.
 */
const NavRow = memo(function NavRow({
  to,
  label,
  ordinal,
  icon,
  isActive,
  collapsed,
  onNavClick,
  onToggleCollapsed,
  prefetch,
}: {
  to: string
  label: string
  ordinal: string
  icon: ReactNode
  isActive: boolean
  collapsed?: boolean
  onNavClick?: () => void
  onToggleCollapsed?: () => void
  prefetch?: (() => void) | undefined
}) {
  return (
    <Link
      to={to}
      onMouseEnter={prefetch}
      onFocus={prefetch}
      onClick={(e) => {
        if (isActive) {
          // Desktop: tapping the current page collapses the sidebar to an
          // icon rail. Mobile drawer: close instead.
          if (onToggleCollapsed) {
            e.preventDefault()
            onToggleCollapsed()
          } else {
            onNavClick?.()
          }
          return
        }
        // Desktop: tapping another icon switches pages and keeps the rail
        // collapsed (VSCode/YouTube behaviour). Mobile: closes the drawer.
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
})

// ============================================================================
// SidebarNav
// ============================================================================

const SidebarNav = memo(function SidebarNav({
  activePath,
  onNavClick,
  openBot,
  online,
  collapsed,
  onToggleCollapsed,
}: {
  activePath: string
  onNavClick?: () => void
  /** The bot currently open under /dashboard/bot — null/undefined when no
   *  bot is open. Drives the extra "own page" nav entry below. */
  openBot?: { id: string; nickname: string; platform: string } | null
  /** Live socket connection state; undefined = use browser online state. */
  online?: boolean | undefined
  /** Desktop only: when true the nav collapses to an icon-only rail. */
  collapsed?: boolean
  onToggleCollapsed?: () => void
}) {
  const isBotRoute =
    activePath === ROUTES.DASHBOARD.BOT || activePath.startsWith(`${ROUTES.DASHBOARD.BOT}/`)
  const isCreateNewBotRoute = activePath === ROUTES.DASHBOARD.CREATE_NEW_BOT

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
          to={ROUTES.DASHBOARD.ROOT}
          onClick={() => {
            onNavClick?.()
            if (collapsed) onToggleCollapsed?.()
          }}
          title={collapsed ? 'Cat-Bot' : undefined}
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
              <span className={cn(H_SHELL_SCOPE, 'ml-auto pr-1')}>/ DASH</span>
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
        aria-label="Dashboard navigation"
      >
        {!collapsed && <div className={H_SECTION_LABEL}>PAGES</div>}

        {NAV_ITEMS.map(({ path, label, icon: Icon }, index) => {
          // Bot Manager defers its own highlight to the dedicated "open
          // bot" entry below while a specific bot is open — otherwise
          // both would light up together for the same set of routes.
          const isActive =
            isNavItemActive(path, activePath) && !(path === ROUTES.DASHBOARD.ROOT && openBot)

          // The open bot's own page sits directly under Bot Manager — it
          // only exists in the sidebar for as long as that bot stays
          // open, and disappears the instant it's closed (navigated away
          // from). It keeps the same row geometry as every other entry,
          // with `↳` in the ordinal column so it reads as a sub-entry of
          // the ledger rather than a new section.
          const PlatformIcon = openBot
            ? getPlatformIconComponent(openBot.platform)
            : null

          return (
            <Fragment key={path}>
              <NavRow
                to={path}
                label={label}
                ordinal={String(index + 1).padStart(2, '0')}
                icon={<Icon className="h-4 w-4 shrink-0" />}
                isActive={isActive}
                collapsed={collapsed}
                onNavClick={onNavClick}
                onToggleCollapsed={onToggleCollapsed}
                prefetch={NAV_PREFETCH[path]}
              />

              {path === ROUTES.DASHBOARD.ROOT && openBot && PlatformIcon && (
                <NavRow
                  to={`${ROUTES.DASHBOARD.BOT}?id=${openBot.id}`}
                  label={openBot.nickname}
                  ordinal="↳"
                  icon={<PlatformIcon className="h-4 w-4 shrink-0" />}
                  isActive={isBotRoute}
                  collapsed={collapsed}
                  onNavClick={onNavClick}
                  onToggleCollapsed={onToggleCollapsed}
                />
              )}
            </Fragment>
          )
        })}

        {/* Create New Bot — a dynamic entry like the open bot's own page:
            it appears in the sidebar only while the wizard route is open,
            and vanishes the moment you navigate away. */}
        {isCreateNewBotRoute && (
          <NavRow
            to={ROUTES.DASHBOARD.CREATE_NEW_BOT}
            label="Create New Bot"
            ordinal="+"
            icon={<Plus className="h-4 w-4 shrink-0" />}
            isActive={isCreateNewBotRoute}
            collapsed={collapsed}
            onNavClick={onNavClick}
            onToggleCollapsed={onToggleCollapsed}
          />
        )}
      </nav>

      {/* Footer — live status + Dashboard scope, collapse toggle */}
      <SidebarFooter
        scopeLabel="Dashboard"
        online={online}
        collapsed={collapsed}
        onToggleCollapsed={onToggleCollapsed}
      />
    </div>
  )
})

// ============================================================================
// UserMenu — content-header avatar dropdown
// ============================================================================

const UserMenu = memo(function UserMenu() {
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { user, logout, isLoading } = useUserAuth()

  // Admin status comes from the server-verified better-auth session
  // (user.role) — never a client-supplied flag. While the session is
  // still resolving, admin-only items render nothing: no flash for
  // non-admins, no layout shift when the session lands.
  const isAdmin = !isLoading && user?.role === 'admin'

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

  const handleLogout = async () => {
    setOpen(false)
    try {
      await logout()
    } catch (err) {
      console.error('Logout failed:', err)
    }
    navigate(ROUTES.HOME)
  }

  const displayName = user?.name ?? 'User'
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
          aria-label="User menu"
          className={cn(
            'absolute right-0 top-full z-dropdown mt-1.5 min-w-[210px]',
            'overflow-hidden rounded-[var(--radius-input)] border border-outline-variant bg-surface-container-low',
            'py-1 shadow-none',
            '[animation:fade-in-down_150ms_var(--easing-standard-decelerate)_both]',
          )}
        >
          {/* Identity block — square stamp, name, mono address */}
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
              <p className="truncate font-mono text-[10px] uppercase tracking-[0.04em] text-on-surface-variant/85">
                {user?.email ?? ''}
              </p>
            </div>
          </div>

          {/* Admin shortcut — rendered ONLY for confirmed admins. Absent
              from the DOM entirely otherwise (not hidden, not disabled). */}
          {isAdmin && (
            <Link
              to={ROUTES.ADMIN.DASHBOARD}
              role="menuitem"
              onClick={() => setOpen(false)}
              className={cn(
                H_DROPDOWN_ITEM,
                'text-primary hover:bg-primary/[var(--state-hover-opacity)]',
              )}
            >
              <ShieldCheck className={H_DROPDOWN_ICON} />
              Admin Dashboard
            </Link>
          )}

          {/* Logout */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void handleLogout()
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
})

// ============================================================================
// DashboardLayout
// ============================================================================

export default function DashboardLayout() {
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  // Live connectivity — drives the sidebar status light and the connection
  // banner. A dropped socket or an unreachable API no longer raises a toast
  // or unmounts the page; the banner explains it and retries in place.
  const { browserOnline, serverReachable } = useConnectivity()
  // A lost realtime socket alone is not "offline": REST still works and the
  // socket reconnects on its own. The footer reflects the connection that
  // actually gates the page (browser + API); the banner owns outage detail.
  const connected = browserOnline && serverReachable !== false
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
  const [prevPath, setPrevPath] = useState(location.pathname)
  const activePath = location.pathname

  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname)
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

  useEffect(() => {
    // Lazy connect on entering the authenticated shell. Reconnection after
    // that is owned by socket.io + ConnectivityProvider; calling connect()
    // again while a handshake is in flight is a no-op.
    connectSocket()
  }, [])

  // The chat room manages its own internal scroll (message list) and needs
  // the content column pinned to the viewport instead of growing the page —
  // every other dashboard page keeps the normal padded, page-scrolling main.
  const isChatRoom = activePath.startsWith(ROUTES.DASHBOARD.CHAT_ROOM)

  // ── "Currently open bot" sidebar entry ───────────────────────────────────
  // Bot detail pages live at /dashboard/bot?id=<id> (and its /commands,
  // /events, /settings tabs) rather than a path param, so the id has to be
  // read from the query string. Resolving to null outside that route (or
  // once the id itself goes away) is what makes the sidebar entry disappear
  // the moment the bot is "closed" — there's nothing to opt back out of.
  const isBotRoute =
    activePath === ROUTES.DASHBOARD.BOT || activePath.startsWith(`${ROUTES.DASHBOARD.BOT}/`)
  const isCreateNewBotRoute = activePath === ROUTES.DASHBOARD.CREATE_NEW_BOT
  const openBotId = isBotRoute ? new URLSearchParams(location.search).get('id') : null

  const [openBot, setOpenBot] = useState<{
    id: string
    nickname: string
    platform: string
  } | null>(null)

  // Clear the sidebar entry the instant the route stops pointing at a bot —
  // adjusting state during render (rather than in the effect below) avoids an
  // extra render + effect round-trip. See https://react.dev/learn/you-might-not-need-an-effect
  const [prevOpenBotId, setPrevOpenBotId] = useState(openBotId)
  if (openBotId !== prevOpenBotId) {
    setPrevOpenBotId(openBotId)
    if (!openBotId) setOpenBot(null)
  }

  useEffect(() => {
    if (!openBotId) {
      return
    }

    let cancelled = false
    botService
      .getBot(openBotId)
      .then((bot) => {
        if (!cancelled) {
          setOpenBot({ id: openBotId, nickname: bot.nickname, platform: bot.platform })
        }
      })
      .catch(() => {
        if (!cancelled) setOpenBot(null)
      })

    return () => {
      cancelled = true
    }
  }, [openBotId])

  const currentLabel =
    openBot && isBotRoute
      ? openBot.nickname
      : isCreateNewBotRoute
        ? 'Create New Bot'
        : (NAV_ITEMS.find((i) => isNavItemActive(i.path, activePath))?.label ?? 'Dashboard')

  return (
    <DashboardSidebarProvider open={mobileOpen} onOpenChange={setMobileOpen}>
      <RouteProgressBar />
      <div className="flex min-h-screen bg-surface-container-high">
        {/* Desktop sidebar — permanent, collapses to an icon rail on desktop,
            hidden entirely below md (mobile uses the off-canvas drawer) */}
        <aside
          className={cn(
            'hidden shrink-0 flex-col border-r border-hairline bg-surface-container-low md:flex',
            'sticky top-0 h-screen overflow-y-hidden transition-[width] duration-normal',
            collapsed ? COLLAPSED_SIDEBAR_W : H_SIDEBAR_WIDTH,
          )}
        >
          <SidebarNav
            activePath={activePath}
            openBot={openBot}
            online={connected}
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

        {/* Mobile off-canvas drawer */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-modal flex flex-col border-r border-hairline bg-surface-container-low md:hidden',
            'transition-transform duration-normal',
            H_SIDEBAR_WIDTH,
            mobileOpen ? 'translate-x-0' : '-translate-x-full',
          )}
          aria-label="Mobile dashboard navigation"
          aria-modal={mobileOpen}
          inert={!mobileOpen}
        >
          <SidebarNav
            activePath={activePath}
            onNavClick={() => setMobileOpen(false)}
            openBot={openBot}
            online={connected}
          />
        </aside>

        {/* Main content column */}
        <div
          className={cn(
            'flex min-w-0 flex-1 flex-col',
            // h-dvh (dynamic viewport height) instead of h-screen (100vh) —
            // 100vh is measured against the *largest* possible mobile
            // browser viewport and doesn't shrink when the address bar is
            // visible, which either clips the composer off-screen or leaves
            // a dead gap as the bar shows/hides while scrolling. dvh tracks
            // the real, current viewport on every mobile browser that
            // supports it, keeping the header and input bar stable.
            isChatRoom && 'sticky top-0 h-dvh overflow-hidden',
          )}
        >
          {/* Content header — the Chat Room renders its own single header
              (with the mobile hamburger wired to the same drawer via
              DashboardSidebarContext), so it is intentionally NOT rendered
              here. Rendering both used to stack two header bars. */}
          {!isChatRoom && (
            <div
              className={cn(
                'sticky top-0 z-[100] flex items-center gap-2 border-b',
                H_SURFACE,
                H_SEPARATOR,
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
                className={cn('md:hidden', H_ICON_BTN_MOBILE)}
                onClick={() => setMobileOpen((p) => !p)}
              />

              {/* One left-aligned cluster: scope prefix + current page label */}
              <div className="flex min-w-0 items-center gap-2">
                <span className={cn(H_SHELL_SCOPE, 'hidden sm:inline')}>
                  DASHBOARD /
                </span>
                <span
                  className={cn(
                    H_BRAND_TEXT,
                    'min-w-0 truncate text-on-surface',
                  )}
                >
                  {currentLabel}
                </span>
              </div>

              {/* Avatar menu */}
              <div className="ml-auto pl-2">
                <UserMenu />
              </div>
            </div>
          )}

          {!isChatRoom && <ConnectionBanner />}

          <main
            className={cn(
              'flex-1',
              isChatRoom
                ? 'min-h-0 overflow-hidden'
                : 'mx-auto w-full max-w-[var(--layout-content-max)] px-[var(--layout-main-p)] py-6 md:py-8',
            )}
          >
            <ScrollToTop />
            <WidgetErrorBoundary label="Dashboard content" resetKey={activePath}>
              <Outlet />
            </WidgetErrorBoundary>
          </main>
        </div>
      </div>
    </DashboardSidebarProvider>
  )
}
