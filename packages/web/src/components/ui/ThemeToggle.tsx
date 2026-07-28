import { useLayoutEffect, useRef, useState } from 'react'
import { Droplets, Flame, Moon } from 'lucide-react'
import { cn } from '@/utils/cn.util'
import { useTheme, type AppTheme } from '@/contexts/ThemeContext'

const OPTIONS: Array<{
  value: AppTheme
  label: string
  description: string
  icon: React.ReactNode
  /** Theme's own primary accent, as an "R G B" triple — used to tint the
   *  option's icon chip so each choice previews its actual hue, regardless
   *  of which theme is currently active. Kept as literal values (rather
   *  than referencing e.g. `--aqua-color-primary`) because those tokens
   *  only exist while that theme's `data-theme` attribute is applied. */
  accent: string
}> = [
  {
    value: 'aqua',
    label: 'Aqua',
    description: 'Cool — cyan/mint accent, glass surfaces',
    icon: <Droplets className="h-4 w-4" strokeWidth={2.25} />,
    accent: '52 224 190',
  },
  {
    value: 'burnt',
    label: 'Burnt',
    description: 'Claude-inspired — warm charcoal, terracotta accent',
    icon: <Flame className="h-4 w-4" strokeWidth={2.25} />,
    accent: '218 119 86',
  },
  {
    value: 'indigo',
    label: 'Indigo',
    description: 'Midnight — amethyst purple, nocturnal',
    icon: <Moon className="h-4 w-4" strokeWidth={2.25} />,
    accent: '156 135 245',
  },
]

export interface ThemeToggleProps {
  className?: string
}

// Diameter of the sliding indicator circle. Deliberately larger than the
// icon chip itself (24px / h-6 w-6) so the active state reads as a glowing
// halo *around* the icon rather than a hard-edged clone of its box — but
// the halo's center is what's pinned to the icon's center, not its edges,
// so the extra size never throws off the alignment.
const INDICATOR_SIZE = 36

/**
 * ThemeToggle — a three-option segmented pill switch for choosing between
 * the "aqua" (default), "burnt", and "indigo" UI themes.
 *
 * The sliding indicator is a fixed-diameter circle whose position is
 * derived directly from the *icon chip's* own measured center (via a ref
 * on the chip, not the button) — never from the button's outer box. That
 * makes centering on the icon a structural guarantee rather than an
 * incidental side effect of padding math: it holds true whether the label
 * is hidden (mobile), visible (sm+), long, short, or absent — because the
 * label is never part of what's being measured.
 *
 * Persists the choice via ThemeContext (localStorage-backed) and updates
 * `<html data-theme>` immediately. Colors are theme-agnostic (surface/
 * outline/primary tokens only) so the control itself never has a "home"
 * theme — it always matches whichever theme is currently active.
 */
export default function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme()
  const activeIndex = OPTIONS.findIndex((o) => o.value === theme)

  const containerRef = useRef<HTMLDivElement>(null)
  const iconRefs = useRef<Array<HTMLSpanElement | null>>([])
  const [indicator, setIndicator] = useState<{ left: number; top: number }>({
    left: 0,
    top: 0,
  })

  // Measure the active option's icon chip (post-layout) and position the
  // indicator so its own center lands exactly on the chip's center —
  // computed from the chip's real rendered box, so it's correct even if
  // font metrics, icon size, or container padding ever change.
  useLayoutEffect(() => {
    const iconEl = iconRefs.current[activeIndex]
    const container = containerRef.current
    if (!iconEl || !container) return

    const update = () => {
      const containerRect = container.getBoundingClientRect()
      const iconRect = iconEl.getBoundingClientRect()
      const iconCenterX = iconRect.left + iconRect.width / 2 - containerRect.left
      const iconCenterY = iconRect.top + iconRect.height / 2 - containerRect.top
      const next = {
        left: iconCenterX - INDICATOR_SIZE / 2,
        top: iconCenterY - INDICATOR_SIZE / 2,
      }
      setIndicator((prev) =>
        prev.left === next.left && prev.top === next.top ? prev : next,
      )
    }

    update()

    const ro = new ResizeObserver(update)
    ro.observe(container)
    return () => ro.disconnect()
  }, [activeIndex])

  return (
    <div
      ref={containerRef}
      role="radiogroup"
      aria-label="Interface theme"
      className={cn(
        'relative inline-flex items-center rounded-full p-2 gap-1 max-w-full overflow-hidden',
        'bg-surface-container-high border border-[var(--color-hairline-border,transparent)]',
        // Inset groove for depth + a soft outer shadow so the whole shell
        // reads as a raised, considered object rather than a flat strip.
        'shadow-[inset_0_1px_2px_rgb(0_0_0/0.18),0_1px_2px_rgb(0_0_0/0.08),0_4px_12px_rgb(0_0_0/0.10)]',
        className,
      )}
    >
      {/* Sliding indicator — a fixed-diameter circle, translated so its own
          center always coincides with the active icon's measured center.
          Base position is top-left 0,0; `translate(x, y)` does all the
          placement work, so there's a single source of truth (the icon's
          rect) rather than separately-reasoned-about left/width/height
          values that could drift out of sync with each other. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute top-0 left-0 rounded-full',
          'transition-transform duration-medium-2 ease-standard',
          'will-change-transform',
        )}
        style={{
          width: INDICATOR_SIZE,
          height: INDICATOR_SIZE,
          transform: `translate(${indicator.left}px, ${indicator.top}px)`,
          background: 'var(--color-gradient-primary)',
          boxShadow: `var(--shadow-cta-glow), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 1px rgba(0,0,0,0.12)`,
        }}
      />

      {OPTIONS.map((option, index) => {
        const isActive = option.value === theme
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={option.description}
            onClick={() => setTheme(option.value)}
            className={cn(
              'relative z-10 flex items-center justify-center gap-2 rounded-full',
              'pl-2 pr-2 sm:pr-4 py-2',
              'text-label-md font-semibold transition-colors duration-medium-2 ease-standard',
              'tactile-press select-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-high',
            )}
          >
            {/* Icon chip — a fixed 24×24 (h-6 w-6) circle. This exact
                element is what the sliding indicator's center is measured
                against, so its own centering has to be exact too:
                `flex items-center justify-center` centers the icon's box
                on both axes, and `[&>svg]:block` strips the few pixels of
                inline-baseline descender space every <svg> carries by
                default — without it the icon (and therefore the whole
                measured "center") reads a couple of pixels high. */}
            <span
              ref={(el) => {
                iconRefs.current[index] = el
              }}
              className={cn(
                'relative flex items-center justify-center h-6 w-6 rounded-full shrink-0 overflow-hidden',
                'transition-[background,box-shadow,color] duration-medium-2 ease-standard',
                '[&>svg]:block',
              )}
              style={{
                background: isActive
                  ? 'rgba(255,255,255,0.2)'
                  : `rgba(${option.accent}, 0.14)`,
                boxShadow: isActive
                  ? 'inset 0 1px 1px rgba(255,255,255,0.35), inset 0 -1px 2px rgba(0,0,0,0.16)'
                  : 'inset 0 1px 1px rgba(255,255,255,0.05)',
                color: isActive ? '#fff' : `rgb(${option.accent})`,
              }}
            >
              {option.icon}
            </span>
            <span
              className={cn(
                'hidden sm:inline whitespace-nowrap transition-colors duration-medium-2 ease-standard',
                isActive ? 'text-on-surface' : 'text-on-surface-variant',
              )}
            >
              {option.label}
            </span>
          </button>
        )
      })}
    </div>
  )
}