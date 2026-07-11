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

/**
 * Available UI themes.
 * - 'aurora'  — the new default theme (dark navy + cyan accent, iOS-style
 *               shape/glass/glow tokens).
 * - 'classic' — the original Replit-orange theme, kept for anyone who
 *               prefers the previous look.
 */
export type AppTheme = 'aurora' | 'classic'

const STORAGE_KEY = 'cat-bot-ui-theme'
const DEFAULT_THEME: AppTheme = 'aurora'

function isAppTheme(value: string | null): value is AppTheme {
  return value === 'aurora' || value === 'classic'
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
  /** Convenience toggle between the two themes. */
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(getInitialTheme)

  // Keep <html data-theme="..."> and localStorage in sync with state.
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    window.localStorage.setItem(STORAGE_KEY, theme)
  }, [theme])

  // Scrollbars stay invisible at rest and fade in only while the user is
  // actively scrolling (Aurora only — Classic keeps them always visible via
  // --scrollbar-idle-opacity: 1). Scroll events don't bubble reliably, so
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
    setThemeState((prev) => (prev === 'aurora' ? 'classic' : 'aurora'))
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
