/**
 * Shared Error Page Shell
 *
 * One consistent premium layout for every error page (404, 500, …):
 * a Cat-Bot console card — traffic-dot header bar with a mono status
 * label, icon tile, headline, copy, and actions — floating over the
 * app-standard dotted grid + ambient glow.
 *
 * Fault-tolerance contract (same as the pages that use it): no contexts,
 * no API calls, no React Router dependency. Provider-free shared
 * primitives (Button, lucide icons) only, so this renders even when the
 * router, auth, or API is entirely down.
 */
import type { ReactNode } from 'react'
import Button from '@/components/ui/buttons/Button'
import { cn } from '@/utils/cn.util'

interface ErrorAction {
  label: string
  icon: ReactNode
  href?: string
  onClick?: () => void
  primary?: boolean
}

export default function ErrorShell({
  code,
  title,
  message,
  icon,
  tint = 'neutral',
  actions,
}: {
  /** HTTP status code — drives the giant numeral, pill, and footnote. */
  code: string
  title: string
  message: string
  /** Icon rendered in the tile centred over the numeral. */
  icon: ReactNode
  /** Neutral (primary glow) or error (red glow + red tile) atmosphere. */
  tint?: 'neutral' | 'error'
  /** Primary action first, secondary second. */
  actions: [ErrorAction, ErrorAction?]
}) {
  const isError = tint === 'error'
  const [primaryAction, secondaryAction] = actions

  return (
    <div
      role="main"
      className="min-h-screen flex flex-col items-center justify-center bg-surface text-on-surface px-6 py-16 relative overflow-hidden"
    >
      {/* Background atmosphere — app-standard dotted grid + tinted glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgb(var(--color-outline-variant) / 0.3) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />
      <div
        className={cn(
          'pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[600px] w-[600px] rounded-full blur-[100px]',
          isError ? 'bg-error/[0.05]' : 'bg-primary/[0.05]',
        )}
      />

      <div
        className="relative z-10 flex flex-col items-center gap-6 text-center w-full max-w-md"
        style={{ animation: 'fade-in-up 500ms var(--easing-emphasized-decelerate) both' }}
      >
        {/* Console card */}
        <div className="w-full rounded-[var(--radius-card)] border border-hairline bg-surface-container-low shadow-elevation-3 overflow-hidden">
          {/* Header bar — traffic dots + mono status label */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-hairline bg-surface-container">
            <span className="flex items-center gap-1.5 shrink-0" aria-hidden="true">
              <span className="h-2.5 w-2.5 rounded-full bg-error/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-warning/70" />
              <span className="h-2.5 w-2.5 rounded-full bg-success/70" />
            </span>
            <span className="text-label-xs font-mono tracking-widest text-on-surface-variant/70 truncate">
              CAT-BOT · ERROR {code}
            </span>
            <span
              className={cn(
                'ml-auto shrink-0 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-widest border',
                isError
                  ? 'bg-error/10 border-error/30 text-error'
                  : 'bg-primary/10 border-primary/30 text-primary',
              )}
            >
              {code}
            </span>
          </div>

          {/* Body */}
          <div className="flex flex-col items-center gap-5 px-6 py-8">
            {/* Display numeral with centred icon tile */}
            <div className="relative select-none">
              <span
                className="block font-bold tracking-tight text-on-surface/[0.05]"
                style={{ fontSize: 'clamp(96px, 16vw, 144px)', lineHeight: 1 }}
                aria-hidden="true"
              >
                {code}
              </span>
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className={cn(
                    'flex h-16 w-16 items-center justify-center rounded-2xl border shadow-elevation-2',
                    isError
                      ? 'border-error/30 bg-error-container/40'
                      : 'border-outline-variant/80 bg-surface-container-high',
                  )}
                >
                  {icon}
                </div>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
                {title}
              </h1>
              <p className="text-body-md text-on-surface-variant leading-relaxed max-w-sm mx-auto">
                {message}
              </p>
            </div>

            <div className="w-16 h-px bg-outline-variant/60" />

            <div className="flex flex-col sm:flex-row items-center justify-center gap-3 w-full">
              {[primaryAction, secondaryAction].map((action, i) => {
                if (!action) return null
                const buttonProps = {
                  variant: (action.primary === false ? 'outline' : 'filled') as 'outline' | 'filled',
                  color: (action.primary === false ? 'neutral' : 'primary') as 'neutral' | 'primary',
                  size: 'lg' as const,
                  leftIcon: action.icon,
                  className: 'w-full sm:w-auto',
                }
                return action.href ? (
                  <Button key={i} as="a" href={action.href} {...buttonProps}>
                    {action.label}
                  </Button>
                ) : (
                  <Button key={i} onClick={action.onClick} {...buttonProps}>
                    {action.label}
                  </Button>
                )
              })}
            </div>
          </div>
        </div>

        {/* Footnote */}
        <p className="text-label-xs text-on-surface-variant/40 font-mono tracking-widest">
          ERROR {code} · {code === '404' ? 'NOT FOUND' : 'INTERNAL SERVER ERROR'}
        </p>
      </div>
    </div>
  )
}
