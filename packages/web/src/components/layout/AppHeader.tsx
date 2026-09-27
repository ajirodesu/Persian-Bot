import type { ReactNode } from 'react'
import { cn } from '@/utils/cn.util'
import { H_SEPARATOR } from '@/constants/header.constants'

interface AppHeaderProps {
  leading?: ReactNode
  title: ReactNode
  subtitle?: ReactNode
  trailing?: ReactNode
  className?: string
}

/**
 * Unified Bot Manager application header.
 *
 * Geometry (Bot Manager authority):
 * - 56px content height (h-14, sidebar-header thickness), px-5 horizontal inset
 * - 36px icon-button targets, ~20px icons
 * - 16px / 600 title, subtle 1px separator (H_SEPARATOR, sidebar-header weight)
 * - Surface #0A0C0E, no blur / glass / glow
 */
export default function AppHeader({
  leading,
  title,
  subtitle,
  trailing,
  className,
}: AppHeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-[100] bg-surface border-b',
        H_SEPARATOR,
        className,
      )}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center justify-between h-14 px-5 gap-2">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {leading}
          <div className="flex flex-col items-start justify-center min-w-0 px-1">
            <h1 className="text-base font-semibold text-on-surface tracking-tight leading-tight truncate">
              {title}
            </h1>
            {subtitle ? (
              <div className="flex items-center gap-1.5">{subtitle}</div>
            ) : null}
          </div>
        </div>
        {trailing ? (
          <div className="flex items-center gap-1 shrink-0">{trailing}</div>
        ) : null}
      </div>
    </header>
  )
}

/** 36px header icon button — single geometry for every screen. */
export function AppHeaderIconButton({
  children,
  label,
  onClick,
  className,
}: {
  children: ReactNode
  label: string
  onClick?: () => void
  className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
        'text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high active:bg-surface-container-highest',
        'transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
        '[&>svg]:w-5 [&>svg]:h-5',
        className,
      )}
    >
      {children}
    </button>
  )
}
