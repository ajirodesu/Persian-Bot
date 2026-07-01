import { useState, useEffect } from 'react'
import { Outlet, Link, useLocation } from 'react-router-dom'
import { Menu, X } from 'lucide-react'
import Logo from '@/components/ui/Logo'
import Button from '@/components/ui/buttons/Button'
import IconButton from '@/components/ui/buttons/IconButton'
import UILink from '@/components/ui/typography/Link'
import { cn } from '@/utils/cn.util'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { ROUTES } from '@/constants/routes.constants'
import {
  H_HEIGHT,
  H_PX,
  H_LOGO_ICON,
  H_BRAND_TEXT,
} from '@/constants/header.constants'

/**
 * Public shell — marketing and auth routes (/, /login, /signup, etc.)
 *
 * Header: 48px unified height, glass-morphism backdrop blur,
 * hairline border on scroll. Centred brand text on mobile, left-aligned
 * logo + brand on desktop. Auth CTAs on the right.
 */
export default function Layout() {
  const location = useLocation()
  const { isAuthenticated } = useUserAuth()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [prevPath, setPrevPath] = useState(location.pathname)
  const [scrolled, setScrolled] = useState(false)

  const isLogin = location.pathname === '/login'
  const isSignup = location.pathname === '/signup'

  if (location.pathname !== prevPath) {
    setPrevPath(location.pathname)
    setMobileOpen(false)
  }

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

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
      {/* ── Header ── */}
      <header
        className={cn(
          'sticky top-0 z-fixed transition-all duration-normal',
          scrolled
            ? 'bg-surface/85 backdrop-blur-xl border-b border-outline-variant/70 shadow-elevation-1'
            : 'bg-surface/60 backdrop-blur-md border-b border-outline-variant/40',
        )}
      >
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
            aria-label="Persian home"
            className="flex items-center gap-2 text-title-lg font-semibold text-primary hover:opacity-75 transition-opacity duration-fast outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-md"
          >
            <Logo className={H_LOGO_ICON} />
          </UILink>

          {/* Desktop: brand text */}
          <Link
            to="/"
            className={cn(
              'hidden md:inline-flex ml-2 text-primary hover:opacity-75 transition-opacity duration-fast outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-md font-semibold tracking-tight',
              H_BRAND_TEXT,
            )}
          >
            Persian
          </Link>

          {/* Mobile: brand — absolutely centred */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none select-none md:hidden">
            <Link
              to="/"
              className={cn(
                'pointer-events-auto text-primary hover:opacity-75 transition-opacity duration-fast outline-none focus-visible:ring-2 focus-visible:ring-primary/30 rounded-md font-semibold tracking-tight',
                H_BRAND_TEXT,
              )}
            >
              Persian
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
              'md:hidden border-t border-outline-variant/60 bg-surface-container-low/95 backdrop-blur-xl',
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
        <Outlet />
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-outline-variant/50 bg-surface-container-low/40">
        <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Logo className="h-4 w-4 text-primary/70" />
            <span className="text-label-sm text-on-surface-variant/60 font-medium tracking-tight">
              Persian
            </span>
          </div>
          <p className="text-label-sm text-on-surface-variant/50">
            Multi-platform bot management — open source
          </p>
        </div>
      </footer>
    </div>
  )
}
