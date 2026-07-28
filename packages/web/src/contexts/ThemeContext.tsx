import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { applyFaviconTheme } from '../utils/favicon.util'

/**
 * Available UI themes.
 * - 'aqua'   — the default theme (formerly labeled "Winter"): dark
 *              near-black + cyan/mint accent, iOS-style shape/glass/
 *              glow tokens.
 * - 'burnt'  — the warm amber-orange theme (formerly labeled
 *              "Summer"), kept for anyone who prefers a warmer look.
 * - 'indigo' — the midnight-purple theme (formerly labeled "Night"),
 *              a nocturnal amethyst/magenta register.
 *
 * Every theme shares identical shape, spacing, and typography tokens
 * (see tokens.css) — only color, glow, and blur values differ, so
 * switching themes never changes the size or layout of cards,
 * buttons, or text.
 */
export type AppTheme = 'aqua' | 'burnt' | 'indigo'

const STORAGE_KEY = 'cat-bot-ui-theme'
const DEFAULT_THEME: AppTheme = 'aqua'
const THEME_ORDER: readonly AppTheme[] = ['aqua', 'burnt', 'indigo']

function isAppTheme(value: string | null): value is AppTheme {
  return value === 'aqua' || value === 'burnt' || value === 'indigo'
}

/**
 * Reads the persisted theme synchronously so the very first render already
 * matches what index.html's pre-paint script applied to <html data-theme>,
 * avoiding a flash of the wrong theme.
 */
function getInitialTheme(): AppTheme {
  if (typeof window === 'undefined') return DEFAULT_THEME
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isAppTheme(stored) ? stored : DEFAULT_THEME
}

interface ThemeContextValue {
  /** The currently active theme. */
  theme: AppTheme
  /** Replace the active theme outright. */
  setTheme: (theme: AppTheme) => void
  /** Convenience cycle through all available themes, in order. */
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(getInitialTheme)

  // Keep <html data-theme="..."> and localStorage in sync with state.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem(STORAGE_KEY, theme)
    // The favicon is a separate document (no access to the app's CSS vars),
    // so it's recolored to the theme's primary color imperatively here.
    void applyFaviconTheme(theme)
  }, [theme])

  // Scrollbars stay invisible at rest and fade in only while the user is
  // actively scrolling — identical across every theme, all of which set
  // --scrollbar-idle-opacity: 0. Scroll events don't bubble reliably, so
  // this listens in the capture phase on window to catch scrolling inside
  // any nested overflow container.
  const scrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    const handleScroll = () => {
      document.documentElement.setAttribute('data-scrolling', 'true')
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
      scrollTimeoutRef.current = setTimeout(() => {
        document.documentElement.removeAttribute('data-scrolling')
      }, 600)
    }

    window.addEventListener('scroll', handleScroll, true)
    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current)
    }
  }, [])

  const setTheme = useCallback((next: AppTheme) => {
    setThemeState(next)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const nextIndex = (THEME_ORDER.indexOf(prev) + 1) % THEME_ORDER.length
      return THEME_ORDER[nextIndex]
    })
  }, [])

  const value = useMemo(
    () => ({ theme, setTheme, toggleTheme }),
    [theme, setTheme, toggleTheme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

/**
 * Access the current theme and setters. Must be used within <ThemeProvider>.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return ctx
}
