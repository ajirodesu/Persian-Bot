import { Snowflake, Sun } from 'lucide-react'
import { cn } from '@/utils/cn.util'
import { useTheme, type AppTheme } from '@/contexts/ThemeContext'

const OPTIONS: Array<{
  value: AppTheme
  label: string
  description: string
  icon: React.ReactNode
}> = [
  {
    value: 'aurora',
    label: 'Winter',
    description: 'Crisp — cyan accent, glass surfaces',
    icon: <Snowflake className="h-4 w-4" />,
  },
  {
    value: 'classic',
    label: 'Summer',
    description: 'Warm — vibrant orange, high-contrast',
    icon: <Sun className="h-4 w-4" />,
  },
]

export interface ThemeToggleProps {
  className?: string
}

/**
 * ThemeToggle — a two-option segmented pill switch for choosing between
 * the "aurora" (new, default) and "classic" (original) UI themes.
 *
 * Persists the choice via ThemeContext (localStorage-backed) and updates
 * `<html data-theme>` immediately.
 */
export default function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, setTheme } = useTheme()
  const activeIndex = OPTIONS.findIndex((o) => o.value === theme)

  return (
    <div
      role="radiogroup"
      aria-label="Interface theme"
      className={cn(
        'relative inline-flex items-center rounded-full p-1 gap-1',
        'bg-surface-container-high border border-[var(--color-hairline-border,transparent)]',
        className,
      )}
    >
      {/* Sliding indicator */}
      <span
        aria-hidden="true"
        className="absolute inset-y-1 rounded-full bg-primary transition-transform duration-medium-2 ease-standard"
        style={{
          width: `calc(${100 / OPTIONS.length}% - 0.25rem)`,
          transform: `translateX(calc(${activeIndex * 100}% + ${activeIndex * 0.25}rem))`,
        }}
      />

      {OPTIONS.map((option) => {
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
              'relative z-10 flex items-center justify-center gap-1.5 rounded-full px-3.5 py-1.5',
              'text-label-md font-medium transition-colors duration-medium-2 ease-standard',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              isActive ? 'text-on-primary' : 'text-on-surface-variant hover:text-on-surface',
            )}
          >
            {option.icon}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
