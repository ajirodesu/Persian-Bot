import { useLayoutEffect, useRef, useState } from 'react'
import { Droplets, Flame, Moon } from 'lucide-react'
import { cn } from '@/utils/cn.util'
import { useTheme, type AppTheme } from '@/contexts/ThemeContext'

const OPTIONS: Array<{
  value: AppTheme
  label: string
  description: string
  icon: React.ReactNode
}> = [
  {
    value: 'aqua',
    label: 'Aqua',
    description: 'Cool — cyan/mint accent, glass surfaces',
    icon: <Droplets className="h-4 w-4" strokeWidth={2.25} />,
  },
  {
    value: 'burnt',
    label: 'Burnt',
    description: 'Claude-inspired — warm charcoal, terracotta accent',
    icon: <Flame className="h-4 w-4" strokeWidth={2.25} />,
  },
  {
    value: 'indigo',
    label: 'Indigo',
    description: 'Midnight — amethyst purple, nocturnal',
    icon: <Moon className="h-4 w-4" strokeWidth={2.25} />,
  },
]

export interface ThemeToggleProps {
  className?: string
}

/**
 * ThemeToggle — a three-option segmented pill switch for choosing between
 * the "aqua" (default), "burnt", and "indigo" UI themes.
 *
 * The sliding indicator is measured directly off each segment's rendered
 * width via refs (rather than assuming equal thirds), so the control stays
 * pixel-accurate regardless of label length or font metrics — the kind of
 * detail that separates a "real" switch from a CSS approximation.
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
  const segmentRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [indicator, setIndicator] = useState<{ left: number; width: number }>({
    left: 0,
    width: 0,
  })

  // Measure the active segment's actual box (post-layout) so the indicator
  // slides to a pixel-perfect position/width instead of a guessed fraction.
  useLayoutEffect(() => {
    const el = segmentRefs.current[activeIndex]
    const container = containerRef.current
    if (!el || !container) return

    const update = () => {
      const containerRect = container.getBoundingClientRect()
      const elRect = el.getBoundingClientRect()
      setIndicator({
        left: elRect.left - containerRect.left,
        width: elRect.width,
      })
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
        'relative inline-flex items-center rounded-full p-1 gap-0.5',
        'bg-surface-container-high border border-[var(--color-hairline-border,transparent)]',
        'shadow-[inset_0_1px_2px_rgb(0_0_0/0.18)]',
        className,
      )}
    >
      {/* Sliding indicator — pixel-measured, theme-colored gradient fill with
          a soft signature glow so the active state reads as premium, not flat. */}
      <span
        aria-hidden="true"
        className={cn(
          'absolute inset-y-1 rounded-full',
          'transition-[transform,width] duration-medium-2 ease-standard',
          'will-change-transform',
        )}
        style={{
          width: indicator.width,
          transform: `translateX(${indicator.left}px)`,
          background: 'var(--color-gradient-primary)',
          boxShadow: 'var(--shadow-cta-glow)',
        }}
      />

      {OPTIONS.map((option, index) => {
        const isActive = option.value === theme
        return (
          <button
            key={option.value}
            ref={(el) => {
              segmentRefs.current[index] = el
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            title={option.description}
            onClick={() => setTheme(option.value)}
            className={cn(
              'relative z-10 flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5',
              'text-label-md font-semibold transition-colors duration-medium-2 ease-standard',
              'tactile-press select-none',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-container-high',
              isActive
                ? 'text-on-primary'
                : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            <span
              className={cn(
                'transition-transform duration-medium-2 ease-standard',
                isActive && 'scale-105',
              )}
            >
              {option.icon}
            </span>
            <span>{option.label}</span>
          </button>
        )
      })}
    </div>
  )
}
