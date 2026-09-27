import type { ReactNode } from 'react'
import { cn } from '@/utils/cn.util'

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
 * - 48px content height (h-12), px-5 horizontal inset
 * - 36px icon-button targets, ~20px icons
 * - 16px / 600 title, subtle 1px separator (#242930)
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
        'sticky top-0 z-[100] bg-[#0A0C0E] border-b border-[#242930]',
        className,
      )}
      style={{ paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="flex items-center justify-between h-12 px-5 gap-2">
        <div className="flex items-center gap-1 min-w-0 flex-1">
          {leading}
          <div className="flex flex-col items-start justify-center min-w-0 px-1">
            <h1 className="text-base font-semibold text-[#F1F4F8] tracking-tight leading-tight truncate">
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
        'text-[#8B95A2] hover:text-[#F1F4F8] hover:bg-[#191D22] active:bg-[#1E232A]',
        'transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/40',
        '[&>svg]:w-5 [&>svg]:h-5',
        className,
      )}
    >
      {children}
    </button>
  )
}
