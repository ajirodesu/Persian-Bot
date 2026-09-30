import { useState, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Logo from '@/components/ui/Logo'
import Button from '@/components/ui/buttons/Button'
import IconButton from '@/components/ui/buttons/IconButton'
import UILink from '@/components/ui/typography/Link'
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
  H_SEPARATOR,
} from '@/constants/header.constants'

/**
 * Public shell — marketing and auth routes (/, /login, /signup, etc.)
 *
 * Bot Manager AppHeader: 48px height, 20px inset, 36px controls,
 * 1px #242930 separator. Centred brand on mobile, left logo on desktop.
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
    <div className="min-h-screen flex flex-col bg-surface text-on-surface">
      <RouteProgressBar />
      {/* ── Bot Manager AppHeader: h-14, px-5, sidebar-weight separator ── */}
      <header className={cn('sticky top-0 z-[100] bg-surface border-b', H_SEPARATOR)}>
        <nav
          className={cn(
            'relative max-w-6xl mx-auto flex items-center',
            H_HEIGHT,
            H_PX,
          )}
          aria-label="Main navigation"
        >
          {/* Left: logo */}
          <UILink
            as={Link}
            to="/"
            variant="unstyled"
            aria-label="Cat-Bot home"
            className="flex items-center gap-2 text-on-surface hover:opacity-75 transition-opacity duration-100 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg"
          >
            <Logo className="h-8 w-8 text-primary" />
          </UILink>

          {/* Desktop: brand text */}
          <Link
            to="/"
            className={cn(
              'hidden md:inline-flex ml-2 text-on-surface hover:opacity-75 transition-opacity duration-100 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg tracking-tight',
              H_BRAND_TEXT,
            )}
          >
            Cat-Bot
          </Link>

          {/* Mobile: brand — absolutely centred */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none md:hidden">
            <Link
              to="/"
              className={cn(
                'pointer-events-auto text-on-surface hover:opacity-75 transition-opacity duration-100 outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-lg tracking-tight',
                H_BRAND_TEXT,
              )}
            >
              Cat-Bot
            </Link>
          </div>

          {/* Right: desktop */}
          <div className="hidden md:flex items-center gap-2.5 ml-auto">
            {isAuthenticated ? (
              <Button
                as={Link}
                to={ROUTES.DASHBOARD.ROOT}
                variant="filled"
                color="primary"
                size="md"
              >
                Go to Dashboard
              </Button>
            ) : (
              <>
                <Button
                  as={Link}
                  to="/login"
                  variant={isLogin ? 'tonal' : 'text'}
                  color="primary"
                  size="sm"
                  className="font-medium"
                >
                  Log in
                </Button>
                <Button
                  as={Link}
                  to="/signup"
                  variant={isSignup ? 'tonal' : 'filled'}
                  color="primary"
                  size="sm"
                  className="font-medium"
                >
                  Sign up
                </Button>
              </>
            )}
          </div>

          {/* Right: mobile hamburger */}
          <div className="flex md:hidden items-center ml-auto">
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

        {/* Mobile drawer */}
        {mobileOpen && (
          <div
            role="navigation"
            aria-label="Mobile navigation"
            className={cn(
              'md:hidden border-t border-outline-variant bg-surface-container-low',
              '[animation:fade-in-down_150ms_var(--easing-standard-decelerate)_both]',
            )}
          >
            <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-2">
              {isAuthenticated ? (
                <Button
                  as={Link}
                  to={ROUTES.DASHBOARD.ROOT}
                  variant="filled"
                  color="primary"
                  size="md"
                  className="w-full justify-center"
                >
                  Go to Dashboard
                </Button>
              ) : (
                <>
                  <Button
                    as={Link}
                    to="/login"
                    variant={isLogin ? 'tonal' : 'outline'}
                    color="primary"
                    size="md"
                    className="w-full justify-center"
                  >
                    Log in
                  </Button>
                  <Button
                    as={Link}
                    to="/signup"
                    variant={isSignup ? 'tonal' : 'filled'}
                    color="primary"
                    size="md"
                    className="w-full justify-center"
                  >
                    Sign up
                  </Button>
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

      {/* ── Footer ── */}
      <footer className="border-t border-hairline bg-surface">
        <div className="max-w-6xl mx-auto px-5 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Logo className="h-4 w-4 text-on-surface-variant" />
            <span className="text-label-sm text-on-surface-variant font-medium tracking-tight">
              Cat-Bot
            </span>
          </div>
          <p className="text-label-sm text-surface-variant">
            Multi-platform bot management — open source
          </p>
        </div>
      </footer>
    </div>
  )
}
