import React, {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Globe, Search } from 'lucide-react'
import { cn } from '@/utils/cn.util'
import { listTimezoneOptions, type TimezoneOption } from '@/utils/datetime.util'
import { useOptionalFieldContext } from '@/components/ui/forms/Field'

export interface TimezoneSelectProps {
  /** Selected IANA timezone identifier, e.g. "Asia/Manila" */
  value: string
  /** Called with the newly selected IANA timezone identifier */
  onChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
}

// Fixed row height in px — required for the virtualized list's math below.
// Matches the visual footprint of the old py-2 + text-body-sm row.
const ROW_HEIGHT = 36
// Visible viewport height of the results list (matches the old max-h-72).
const LIST_MAX_HEIGHT = 288
// Extra rows rendered above/below the visible window so fast scrolling/arrow
// keys never reveal an unrendered gap for a frame.
const OVERSCAN = 8
// Matches Tailwind's `sm` breakpoint (min-width: 640px). Below this we render
// the menu as a fixed, viewport-anchored sheet instead of a button-anchored
// popover — see `isMobile` below.
const MOBILE_MEDIA_QUERY = '(max-width: 639px)'

/**
 * Searchable timezone picker.
 *
 * Modelled after the plain `Select` component (portal-rendered menu, same
 * positioning/keyboard-escape/click-outside behaviour) but adds a live search
 * field at the top of the menu — needed because Intl.supportedValuesOf('timeZone')
 * returns 400+ entries, far too many to scan visually. Filtering matches the
 * IANA id, city name, and region against the query.
 *
 * Performance: the options list is 400+ rows, which is enough to jank a plain
 * unwindowed render (400 DOM nodes mounting + laying out synchronously the
 * moment the menu opens). Two things keep it smooth:
 *   1. The result list is windowed (see visibleItems below) — only the rows
 *      that are actually on/near screen are ever mounted, regardless of how
 *      many results match.
 *   2. The filter itself runs against a deferred copy of the query
 *      (useDeferredValue), so each keystroke updates the input instantly and
 *      React fits the (already cheap, but now doubly safe) re-filter/re-render
 *      in around it instead of blocking on it.
 */
const TimezoneSelect: React.FC<TimezoneSelectProps> = ({
  value,
  onChange,
  disabled: disabledProp = false,
  placeholder = 'Select a timezone',
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [scrollTop, setScrollTop] = useState(0)
  const [menuRect, setMenuRect] = useState<{
    top: number
    left: number
    width: number
    openAbove: boolean
  } | null>(null)
  // Mobile (<640px) switches to a fixed, viewport-anchored sheet instead of a
  // button-anchored popover. Why: on phones the on-screen keyboard resizes the
  // viewport and the browser auto-scrolls to keep the focused input visible, so
  // the absolute popover jumps/re-anchors on every keystroke. A fixed sheet
  // ignores both, so it stays put while typing. The VisualViewport is tracked
  // so the sheet also lifts above the keyboard instead of hiding under it.
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined'
      ? window.matchMedia(MOBILE_MEDIA_QUERY).matches
      : false,
  )
  const [visualViewport, setVisualViewport] = useState<{
    height: number
    offsetTop: number
  } | null>(() => {
    if (typeof window === 'undefined') return null
    if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) return null
    const vv = window.visualViewport
    return vv ? { height: vv.height, offsetTop: vv.offsetTop } : null
  })

  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listScrollRef = useRef<HTMLDivElement>(null)
  const scrollRafRef = useRef<number | null>(null)

  const fieldContext = useOptionalFieldContext()
  const disabled = fieldContext?.disabled ?? disabledProp
  const hasError = fieldContext?.invalid ?? false
  const descriptionId = fieldContext?.descriptionId

  // listTimezoneOptions() memoizes its own result at module scope, so this
  // only ever does real work once per page load, not once per open.
  const options = useMemo(() => listTimezoneOptions(), [])
  const selected = options.find((opt) => opt.value === value)

  const filtered = useMemo<TimezoneOption[]>(() => {
    const q = deferredQuery.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (opt) =>
        opt.value.toLowerCase().includes(q) ||
        opt.city.toLowerCase().includes(q) ||
        opt.region.toLowerCase().includes(q),
    )
  }, [options, deferredQuery])

  // Reset scroll position whenever the result set changes out from under it
  // (new search) or the menu re-opens — otherwise the virtualized window can
  // sit at an offset past the end of a shorter result set and render nothing.
  // Done directly in the event handlers below (open/close/search) rather than
  // in a useEffect, since driving setState from an effect here would just
  // trigger an extra cascading render for state we already know the new
  // value of at the point the user interacts.

  const totalHeight = filtered.length * ROW_HEIGHT
  // On mobile the list is bounded by the sheet's usable height instead of the
  // fixed desktop cap, so it stays fully reachable (and never hides under the
  // keyboard). The `- 120` reserves room for the search bar, sheet margins,
  // and some breathing space.
  const listHeight = isMobile
    ? Math.max(ROW_HEIGHT * 4, Math.min(LIST_MAX_HEIGHT, (visualViewport?.height ?? 0) - 120))
    : Math.min(LIST_MAX_HEIGHT, totalHeight) || ROW_HEIGHT
  const visibleRowCount = Math.ceil(LIST_MAX_HEIGHT / ROW_HEIGHT) + OVERSCAN * 2
  const startIndex = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - OVERSCAN)
  const endIndex = Math.min(filtered.length, startIndex + visibleRowCount)
  const visibleItems = filtered.slice(startIndex, endIndex)

  const handleListScroll = () => {
    // rAF-throttled so a fast scroll gesture doesn't queue more re-renders
    // than the browser can actually paint.
    if (scrollRafRef.current !== null) return
    scrollRafRef.current = requestAnimationFrame(() => {
      if (listScrollRef.current) setScrollTop(listScrollRef.current.scrollTop)
      scrollRafRef.current = null
    })
  }

  useEffect(() => {
    return () => {
      if (scrollRafRef.current !== null) cancelAnimationFrame(scrollRafRef.current)
    }
  }, [])

  // Track the viewport so the menu can switch between the anchored popover
  // (desktop) and the fixed sheet (mobile) at runtime — e.g. when the device is
  // rotated or a desktop window is resized mid-interaction. State is only
  // updated from event callbacks (media-query / VisualViewport changes), never
  // synchronously in the effect body. `window.innerHeight` does NOT shrink when
  // the on-screen keyboard opens (and `100vh` doesn't either), which is why the
  // VisualViewport is needed to size the sheet to the area actually visible.
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MEDIA_QUERY)
    const vv = window.visualViewport

    const sync = () => {
      setIsMobile(mq.matches)
      setVisualViewport(
        vv ? { height: vv.height, offsetTop: vv.offsetTop } : null,
      )
    }

    mq.addEventListener('change', sync)
    if (vv) {
      vv.addEventListener('resize', sync)
      vv.addEventListener('scroll', sync)
    }
    return () => {
      mq.removeEventListener('change', sync)
      vv?.removeEventListener('resize', sync)
      vv?.removeEventListener('scroll', sync)
    }
  }, [])

  // Position the menu relative to the trigger button, flipping above it when
  // there isn't room below — identical approach to Select.tsx. Skipped on
  // mobile, where the menu is a fixed viewport-anchored sheet instead: running
  // this against the button's document coordinates would make the sheet jump
  // every time the keyboard resizes the viewport or the page auto-scrolls.
  useEffect(() => {
    if (!isOpen || isMobile || !buttonRef.current) return

    const updatePosition = () => {
      if (!buttonRef.current) return
      const rect = buttonRef.current.getBoundingClientRect()
      const scrollY = window.scrollY || window.pageYOffset
      const scrollX = window.scrollX || window.pageXOffset
      const MENU_HEIGHT_ESTIMATE = 336 // search bar + list viewport + gap
      const spaceBelow = window.innerHeight - rect.bottom
      const spaceAbove = rect.top
      const openAbove = spaceBelow < MENU_HEIGHT_ESTIMATE && spaceAbove > spaceBelow

      setMenuRect({
        top: openAbove ? rect.top + scrollY : rect.bottom + scrollY + 8,
        left: rect.left + scrollX,
        width: rect.width,
        openAbove,
      })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    return () => window.removeEventListener('resize', updatePosition)
  }, [isOpen, isMobile])

  // Focus the search field the moment the menu opens.
  useEffect(() => {
    if (!isOpen) return
    const id = window.setTimeout(() => searchRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [isOpen])

  const openMenu = () => {
    setScrollTop(0)
    setIsOpen(true)
  }

  const closeMenu = () => {
    setIsOpen(false)
    setQuery('')
  }

  // Close on outside click / scroll, same as Select.tsx. On mobile, scrolling
  // the page doesn't close the fixed sheet (the browser itself scrolls when the
  // keyboard opens/auto-focuses, which would otherwise yank the menu shut mid-
  // search); the touch-outside handler below covers dismissal there instead.
  useEffect(() => {
    if (!isOpen || isMobile) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        closeMenu()
      }
    }
    const handleScroll = (event: Event) => {
      const target = event.target as Node | null
      if (target && menuRef.current?.contains(target)) return
      if (target && containerRef.current?.contains(target)) return
      closeMenu()
    }

    document.addEventListener('mousedown', handleClickOutside)
    window.addEventListener('scroll', handleScroll, true)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      window.removeEventListener('scroll', handleScroll, true)
    }
  }, [isOpen, isMobile])

  // On mobile, `mousedown` alone is unreliable for dismissing the sheet (iOS
  // synthesises it lazily / after the tap), so also listen for touch start on
  // any element outside the menu and trigger button.
  useEffect(() => {
    if (!isOpen || !isMobile) return

    const handleTouchOutside = (event: TouchEvent) => {
      const target = event.target as Node
      if (
        containerRef.current &&
        !containerRef.current.contains(target) &&
        menuRef.current &&
        !menuRef.current.contains(target)
      ) {
        closeMenu()
      }
    }

    document.addEventListener('touchstart', handleTouchOutside, {
      passive: true,
    })
    return () =>
      document.removeEventListener('touchstart', handleTouchOutside)
  }, [isOpen, isMobile])

  const handleSelect = (tz: string) => {
    onChange(tz)
    closeMenu()
    buttonRef.current?.focus()
  }

  const generatedId = React.useId()
  const menuId = `timezone-select-menu-${generatedId}`

  // Mobile renders a fixed, viewport-anchored sheet that fills the space the
  // keyboard leaves free. Because it's positioned against the VisualViewport
  // (not the trigger's document coordinates) and never re-computed on resize,
  // it stays perfectly still while the user types. Desktop keeps the existing
  // button-anchored popover.
  const menuStyle: React.CSSProperties | null = isMobile
    ? {
        position: 'fixed',
        left: 12,
        right: 12,
        top: visualViewport ? visualViewport.offsetTop + 12 : undefined,
        bottom: visualViewport ? undefined : 12,
        maxHeight: visualViewport
          ? visualViewport.height - 24
          : 'min(60dvh, calc(100dvh - 1.5rem))',
        zIndex: 'var(--z-dropdown)',
      }
    : menuRect
      ? {
          position: 'absolute',
          top: `${menuRect.top}px`,
          left: `${menuRect.left}px`,
          minWidth: `${menuRect.width}px`,
          transform: menuRect.openAbove
            ? 'translateY(calc(-100% - 8px))'
            : undefined,
          zIndex: 'var(--z-dropdown)',
        }
      : null

  const menu = isOpen && menuStyle && (
    <div
      ref={menuRef}
      id={menuId}
      style={menuStyle}
      className="flex flex-col overflow-hidden rounded-[var(--radius-input)] border border-outline-variant bg-surface/95 [backdrop-filter:var(--surface-blur-sm)] shadow-elevation-2"
    >
      <div className="flex items-center gap-2 border-b border-outline-variant px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-on-surface-variant" />
        <input
          ref={searchRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setScrollTop(0)
            if (listScrollRef.current) listScrollRef.current.scrollTop = 0
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              closeMenu()
              buttonRef.current?.focus()
            }
          }}
          placeholder="Search city, region, or UTC offset…"
          className="w-full bg-transparent text-body-sm text-on-surface placeholder:text-on-surface-variant focus:outline-none"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="px-3 py-6 text-center text-body-sm text-on-surface-variant">
          No timezones match “{query}”.
        </div>
      ) : (
        // Virtualized results: the scroll container is a fixed/limited-height
        // viewport; a full-height spacer inside it establishes real scrollbar
        // proportions, and only the rows currently in (or near) view are
        // mounted, absolutely positioned to their true offset within it.
        <div
          ref={listScrollRef}
          role="listbox"
          aria-labelledby={menuId}
          onScroll={handleListScroll}
          style={{ height: listHeight, overflowY: 'auto' }}
          className="overscroll-contain py-1 text-body-sm"
        >
          <div style={{ position: 'relative', height: totalHeight }}>
            {visibleItems.map((opt, i) => {
              const isSelected = opt.value === value
              return (
                <div
                  key={opt.value}
                  role="option"
                  aria-selected={isSelected}
                  style={{
                    position: 'absolute',
                    top: `${(startIndex + i) * ROW_HEIGHT}px`,
                    left: 0,
                    right: 0,
                    height: `${ROW_HEIGHT}px`,
                  }}
                  className={cn(
                    'flex cursor-pointer items-center gap-2 px-3 transition-colors duration-fast hover:bg-on-surface/[var(--state-hover-opacity)] active:bg-on-surface/[var(--state-pressed-opacity)]',
                    isSelected && 'text-primary font-medium',
                  )}
                  onClick={() => handleSelect(opt.value)}
                >
                  <span className="flex w-4 shrink-0 items-center">
                    {isSelected && <Check className="h-4 w-4" />}
                  </span>
                  <span className="flex-1 truncate">{opt.city}</span>
                  <span className="shrink-0 text-label-sm text-on-surface-variant">
                    {opt.offsetLabel}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        onClick={() => !disabled && (isOpen ? closeMenu() : openMenu())}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-describedby={descriptionId}
        aria-invalid={hasError || undefined}
        className={cn(
          'inline-flex w-full items-center justify-between gap-2 rounded-[var(--radius-input,0.5rem)] border-2 px-4 py-2.5 text-body-md font-medium transition-all duration-fast',
          'bg-[var(--color-input-bg,transparent)] text-on-surface border-[var(--color-input-border,rgb(var(--color-outline-variant)))]',
          'hover:bg-on-surface/[var(--state-hover-opacity)] active:bg-on-surface/[var(--state-pressed-opacity)] focus:outline-none focus:border-primary',
          disabled && 'opacity-state-disabled cursor-not-allowed',
          hasError && 'border-error focus:border-error',
        )}
      >
        <span className="flex flex-1 items-center gap-2 truncate">
          <Globe className="h-4 w-4 shrink-0 text-on-surface-variant" />
          {selected ? (
            <span className="truncate">
              {selected.city}
              <span className="ml-1.5 text-on-surface-variant">
                ({selected.offsetLabel})
              </span>
            </span>
          ) : (
            <span className="text-on-surface-variant">{placeholder}</span>
          )}
        </span>
        <ChevronDown
          className={cn(
            'h-5 w-5 shrink-0 transition-transform duration-fast',
            isOpen && 'rotate-180',
          )}
        />
      </button>

      {isOpen && createPortal(menu, document.body)}
    </div>
  )
}

TimezoneSelect.displayName = 'TimezoneSelect'

export default TimezoneSelect