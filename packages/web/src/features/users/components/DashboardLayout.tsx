import { useState, useEffect, useRef, memo } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import {
  ChevronDown,
  LogOut,
  WifiOff,
  Wifi,
  Menu,
  X,
  Bot,
  MessageSquare,
  Settings as SettingsIcon,
} from 'lucide-react'
import Logo from '@/components/ui/Logo'
import ScrollToTop from '@/components/ScrollToTop'
import { getPlatformIconComponent } from '@/components/icons/PlatformIcons'
import { botService } from '@/features/users/services/bot.service'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { DashboardSidebarProvider } from '@/contexts/DashboardSidebarContext'
import { cn } from '@/utils/cn.util'
import IconButton from '@/components/ui/buttons/IconButton'
import { ROUTES } from '@/constants/routes.constants'
import { getSocket } from '@/lib/socket.lib'
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
  H_ICON_BTN_MOBILE,
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

  return matches(itemPath) && !claimedByAnotherNavItem
}

// ============================================================================
// SidebarNav
// ============================================================================

const SidebarNav = memo(function SidebarNav({
  activePath,
  onNavClick,
  openBot,
}: {
  activePath: string
  onNavClick?: () => void
  /** The bot currently open under /dashboard/bot — null/undefined when no
   *  bot is open. Drives the extra "own page" nav entry below. */
  openBot?: { id: string; nickname: string; platform: string } | null
}) {
  const isBotRoute =
    activePath === ROUTES.DASHBOARD.BOT || activePath.startsWith(`${ROUTES.DASHBOARD.BOT}/`)

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
          to={ROUTES.DASHBOARD.ROOT}
          onClick={onNavClick}
          className={cn(
            'flex items-center gap-2 text-primary hover:opacity-75 transition-opacity duration-fast outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-md font-semibold tracking-tight',
            H_BRAND_TEXT,
          )}
        >
          <Logo className={H_LOGO_ICON} />
          Cat-Bot
        </Link>
      </div>

      {/* Primary nav */}
      <nav
        className="flex-1 px-2.5 py-3 flex flex-col gap-0.5 overflow-y-auto"
        aria-label="Dashboard navigation"
      >
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          // Bot Manager defers its own highlight to the dedicated "open
          // bot" entry below while a specific bot is open — otherwise
          // both would light up together for the same set of routes.
          const isActive =
            isNavItemActive(path, activePath) && !(path === ROUTES.DASHBOARD.ROOT && openBot)
          const navLink = (
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

          // The open bot's own page sits directly under Bot Manager — it
          // only exists in the sidebar for as long as that bot stays
          // open, and disappears the instant it's closed (navigated away
          // from). Styled identically to every other nav item, no nested/
          // indented treatment, so it reads as just another page, not a
          // sub-item.
          if (path !== ROUTES.DASHBOARD.ROOT || !openBot) return navLink

          const PlatformIcon = getPlatformIconComponent(openBot.platform)
          return (
            <div key={path} className="flex flex-col gap-0.5">
              {navLink}
              <Link
                to={`${ROUTES.DASHBOARD.BOT}?id=${openBot.id}`}
                onClick={onNavClick}
                aria-current={isBotRoute ? 'page' : undefined}
                className={cn(
                  H_SIDEBAR_NAV,
                  'rounded-xl font-medium transition-colors duration-fast',
                  isBotRoute
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface-variant hover:bg-on-surface/[var(--state-hover-opacity)] hover:text-on-surface',
                )}
              >
                <PlatformIcon className="h-3.5 w-3.5 3xl:h-4 3xl:w-4 shrink-0" />
                <span className="truncate">{openBot.nickname}</span>
              </Link>
            </div>
          )
        })}
      </nav>
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
  const { user, logout } = useUserAuth()

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
          aria-label="User menu"
          className={cn(
            'absolute right-0 top-full mt-1.5 z-dropdown min-w-[210px]',
            'rounded-xl border border-outline-variant/80 bg-surface-container-low',
            'shadow-elevation-3 py-1 overflow-hidden',
            '[animation:fade-in-down_150ms_var(--easing-standard-decelerate)_both]',
          )}
        >
          {/* User info header */}
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
              <p className="text-label-xs text-on-surface-variant/70 truncate">
                {user?.email ?? ''}
              </p>
            </div>
          </div>

          {/* Logout */}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              void handleLogout()
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
})

// ============================================================================
// DashboardLayout
// ============================================================================

export default function DashboardLayout() {
  const { snackbar, setPosition } = useSnackbar()
  const location = useLocation()
  const isDisconnectedRef = useRef(false)
  const [mobileOpen, setMobileOpen] = useState(false)
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
    const socket = getSocket()
    if (!socket.connected) socket.connect()

    const handleDisconnect = () => {
      if (isDisconnectedRef.current) return
      isDisconnectedRef.current = true
      setPosition('bottom-right')
      snackbar({
        message: 'You are currently offline.',
        duration: 0,
        icon: <WifiOff className="w-4 h-4" />,
      })
    }

    const handleConnect = () => {
      if (!isDisconnectedRef.current) return
      isDisconnectedRef.current = false
      setPosition('bottom-right')
      snackbar({
        message: 'Your internet connection was restored.',
        duration: 4000,
        icon: <Wifi className="w-4 h-4" />,
      })
    }

    socket.on('disconnect', handleDisconnect)
    socket.on('connect_error', handleDisconnect)
    socket.on('connect', handleConnect)

    return () => {
      socket.off('disconnect', handleDisconnect)
      socket.off('connect_error', handleDisconnect)
      socket.off('connect', handleConnect)
    }
  }, [snackbar, setPosition])

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
  const openBotId = isBotRoute ? new URLSearchParams(location.search).get('id') : null

  const [openBot, setOpenBot] = useState<{
    id: string
    nickname: string
    platform: string
  } | null>(null)

  useEffect(() => {
    if (!openBotId) {
      setOpenBot(null)
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
      : (NAV_ITEMS.find((i) => isNavItemActive(i.path, activePath))?.label ?? 'Dashboard')

  return (
    <DashboardSidebarProvider open={mobileOpen} onOpenChange={setMobileOpen}>
      <div className="min-h-screen flex bg-surface-container-high">
        {/* Desktop sidebar — permanent, collapses to icon-free hidden state below md */}
        <aside
          className={cn(
            'hidden md:flex shrink-0 flex-col bg-surface border-r border-outline-variant/70 sticky top-0 h-screen overflow-y-hidden',
            H_SIDEBAR_WIDTH,
          )}
        >
          <SidebarNav activePath={activePath} openBot={openBot} />
        </aside>

        {/* Mobile scrim */}
        {mobileOpen && (
          <div
            className="fixed inset-0 z-drawer bg-scrim/50 md:hidden backdrop-blur-sm"
            onClick={() => setMobileOpen(false)}
            aria-hidden="true"
          />
        )}

        {/* Mobile off-canvas drawer */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-modal flex flex-col bg-surface border-r border-outline-variant/70 md:hidden transition-transform duration-normal',
            H_SIDEBAR_WIDTH,
            mobileOpen ? 'translate-x-0 shadow-elevation-4' : '-translate-x-full',
          )}
          aria-label="Mobile dashboard navigation"
          aria-modal={mobileOpen}
        >
          <SidebarNav
            activePath={activePath}
            onNavClick={() => setMobileOpen(false)}
            openBot={openBot}
          />
        </aside>

        {/* Main content column */}
        <div
          className={cn(
            'flex-1 flex flex-col min-w-0',
            // h-dvh (dynamic viewport height) instead of h-screen (100vh) —
            // 100vh is measured against the *largest* possible mobile
            // browser viewport and doesn't shrink when the address bar is
            // visible, which either clips the composer off-screen or leaves
            // a dead gap as the bar shows/hides while scrolling. dvh tracks
            // the real, current viewport on every mobile browser that
            // supports it, keeping the header and input bar stable.
            isChatRoom && 'h-dvh sticky top-0 overflow-hidden',
          )}
        >
          {/* Content header — the Chat Room renders its own single header
              (with the mobile hamburger wired to the same drawer via
              DashboardSidebarContext), so it is intentionally NOT rendered
              here. Rendering both used to stack two header bars. */}
          {!isChatRoom && (
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
                className={cn('md:hidden', H_ICON_BTN_MOBILE)}
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
                <UserMenu />
              </div>
            </div>
          )}

          <main
            className={cn(
              'flex-1',
              isChatRoom ? 'min-h-0 overflow-hidden' : 'p-4 md:p-6 max-w-7xl w-full mx-auto',
            )}
          >
            <ScrollToTop />
            <Outlet />
          </main>
        </div>
      </div>
    </DashboardSidebarProvider>
  )
}
