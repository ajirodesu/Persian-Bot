import { useState, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { ChevronRight, Menu, X } from 'lucide-react'
import Logo from '@/components/ui/Logo'
import Button from '@/components/ui/buttons/Button'
import IconButton from '@/components/ui/buttons/IconButton'
import { cn } from '@/utils/cn.util'
import RouteProgressBar from '@/components/ui/feedback/RouteProgressBar'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { ROUTES } from '@/constants/routes.constants'
import ScrollToTop from '@/components/ScrollToTop'
import {
  H_HEIGHT,
  H_PX,
  H_BRAND_TEXT,
  H_ICON_BTN_MOBILE,
  H_SHELL_SCOPE,
  H_SIDEBAR_INDEX,
} from '@/constants/header.constants'

/** One line of the mobile ledger: mono ordinal, label, trailing chevron. */
function DrawerRow({
  index,
  to,
  label,
  active = false,
}: {
  index: string
  to: string
  label: string
  active?: boolean
}) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex h-12 items-center gap-3 border-b border-hairline px-4',
        'transition-colors duration-fast hover:bg-surface-container-high',
        'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary',
        // Current page: a 2px rule on the container edge, never a fill. The
        // left colour is set on its own so the row's bottom hairline survives.
        active && '-ml-px border-l-2 border-l-primary',
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          H_SIDEBAR_INDEX,
          active ? 'text-primary' : 'text-on-surface-variant',
        )}
      >
        {index}
      </span>
      <span className="font-brand text-[15px] uppercase tracking-[0.14em] text-on-surface">
        {label}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="ml-auto h-3.5 w-3.5 text-on-surface-variant"
      />
    </Link>
  )
}

/**
 * Public shell — marketing and auth routes (/, /login, /signup, etc.)
 *
 * Reads as the masthead of a technical document: flat ink fill, one hairline
 * rule under the bar, brand left-aligned at every width, mono scope tags, and
 * square primary actions. Nothing floats and nothing blurs.
 */
export default function Layout() {
  const location = useLocation()
  const { isAuthenticated } = useUserAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [prevPath, setPrevPath] = useState(location.pathname)

  const isLogin = location.pathname === '/login'
  const isSignup = location.pathname === '/signup'

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

  return (
    <div className="flex min-h-screen flex-col bg-surface text-on-surface">
      <RouteProgressBar />
      {/* ── Document masthead — solid ink, one hairline rule, brand always
          left-aligned. No centred mobile block, no translucency. ── */}
      <header className="sticky top-0 z-[100] border-b border-hairline bg-surface">
        <nav
          className={cn(
            'mx-auto flex max-w-[var(--layout-nav-max)] items-center gap-2.5',
            H_HEIGHT,
            H_PX,
          )}
          aria-label="Main navigation"
        >
          {/* Left: mark + wordmark + scope */}
          <Link
            to="/"
            aria-label="Cat-Bot home"
            className="flex shrink-0 items-center text-primary transition-opacity duration-fast hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Logo className="h-5 w-5 text-primary" />
          </Link>

          <Link
            to="/"
            className={cn(
              H_BRAND_TEXT,
              'text-on-surface transition-colors duration-fast hover:text-on-surface-variant',
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary',
            )}
          >
            CAT-BOT
          </Link>

          <span
            aria-hidden="true"
            className="hidden h-3 w-px shrink-0 bg-hairline sm:block"
          />
          <span className={cn(H_SHELL_SCOPE, 'hidden sm:inline')}>
            OPERATIONS CONSOLE
          </span>

          {/* Right: desktop — mono index prefix, then the one action set */}
          <div className="ml-auto hidden items-center gap-3 md:flex">
            <span className={H_SHELL_SCOPE}>ACCESS</span>
            {isAuthenticated ? (
              <Button
                as={Link}
                to={ROUTES.DASHBOARD.ROOT}
                variant="filled"
                color="primary"
                size="sm"
                className="rounded-[var(--radius-button)] font-mono text-[11px] uppercase tracking-[0.08em]"
              >
                Go to dashboard
              </Button>
            ) : (
              <>
                <Button
                  as={Link}
                  to="/login"
                  variant="text"
                  size="sm"
                  className="rounded-[var(--radius-button)] font-mono text-[11px] uppercase tracking-[0.08em]"
                >
                  Log in
                </Button>
                <Button
                  as={Link}
                  to="/signup"
                  variant="filled"
                  color="primary"
                  size="sm"
                  className="rounded-[var(--radius-button)] font-mono text-[11px] uppercase tracking-[0.08em]"
                >
                  Sign up
                </Button>
              </>
            )}
          </div>

          {/* Right: mobile — disclosure trigger only */}
          <div className="ml-auto flex items-center md:hidden">
            <IconButton
              icon={mobileOpen ? <X /> : <Menu />}
              aria-label={
                mobileOpen ? 'Close navigation menu' : 'Open navigation menu'
              }
              variant="text"
              size="md"
              className={H_ICON_BTN_MOBILE}
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-expanded={mobileOpen}
            />
          </div>
        </nav>

        {/* Mobile drawer — numbered ledger, not a stack of pills */}
        {mobileOpen && (
          <div
            role="dialog"
            aria-label="Mobile navigation"
            inert={!mobileOpen}
            className={cn(
              'border-t border-hairline bg-surface-container-low md:hidden',
              '[animation:fade-in-down_120ms_var(--easing-standard)_both]',
            )}
          >
            <div className="mx-auto max-w-[var(--layout-nav-max)]">
              {isAuthenticated ? (
                <DrawerRow
                  index="01"
                  to={ROUTES.DASHBOARD.ROOT}
                  label="Dashboard"
                />
              ) : (
                <>
                  <DrawerRow
                    index="01"
                    to="/login"
                    label="Log in"
                    active={isLogin}
                  />
                  <DrawerRow
                    index="02"
                    to="/signup"
                    label="Create account"
                    active={isSignup}
                  />
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">
        <ScrollToTop />
        <Outlet />
      </main>

      {/* ── Colophon ── */}
      <footer className="border-t border-hairline bg-surface">
        <div className="mx-auto max-w-[var(--layout-nav-max)] px-4 py-10 md:px-6">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr]">
            {/* Col 1 — imprint */}
            <div>
              <div className="flex items-center gap-2">
                <Logo className="h-4 w-4 text-on-surface-variant" />
                <span className={cn(H_BRAND_TEXT, 'text-on-surface')}>
                  CAT-BOT
                </span>
              </div>
              <p className="mt-3 max-w-xs text-body-sm text-on-surface-variant">
                Open-source control surface for Discord and Telegram
                bot sessions.
              </p>
            </div>

            {/* Col 2 — supported platforms */}
            <div>
              <h2 className="rule-label">PLATFORMS</h2>
              <ul className="mt-3 space-y-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-on-surface-variant">
                <li>Discord</li>
                <li>Telegram</li>
              </ul>
            </div>

            {/* Col 3 — build stack */}
            <div>
              <h2 className="rule-label">STACK</h2>
              <ul className="mt-3 space-y-1.5 font-mono text-[11px] uppercase tracking-[0.06em] text-on-surface-variant">
                <li>React 19</li>
                <li>Vite</li>
                <li>Node.js</li>
                <li>TypeScript</li>
              </ul>
            </div>
          </div>

          <div className="mt-10 flex items-center justify-between gap-3 border-t border-hairline pt-4">
            <span className={H_SHELL_SCOPE}>CAT-BOT</span>
            <span className={H_SHELL_SCOPE}>MULTI-PLATFORM / OPEN SOURCE</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
