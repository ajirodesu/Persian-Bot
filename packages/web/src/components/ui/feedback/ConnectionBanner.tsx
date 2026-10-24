/**
 * Author: AjiroDesu
 *
 * Non-blocking connection banner.
 *
 * Replaces the old full-screen error page / "You are currently offline" toast.
 * It sits between the shell header and the page, states exactly what is wrong,
 * when the visible data was last saved, and offers one recovery action. It
 * disappears by itself on recovery and flashes a short confirmation.
 */
import { RefreshCw } from 'lucide-react'
import { useConnectivity } from '@/contexts/ConnectivityContext'
import { cn } from '@/utils/cn.util'
import { useCountdownSeconds } from '@/hooks/useCountdown'

function clock(timestamp: number): string {
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp))
  } catch {
    return '—'
  }
}

const TONE_CLASS = {
  error: 'border-error/30 bg-error-container/50 text-on-error-container',
  warning: 'border-warning/30 bg-warning-container/50 text-on-warning-container',
  success:
    'border-success/30 bg-success-container/50 text-on-success-container',
} as const

export default function ConnectionBanner() {
  const {
    phase,
    lastSyncAt,
    recoveredAt,
    isRetrying,
    nextRetryAt,
    retryNow,
  } = useConnectivity()
  const seconds = useCountdownSeconds(nextRetryAt)

  // The provider owns the recovery flash window (4s); while it is set, show
  // the confirmation, then disappear.
  if (phase === 'online' && recoveredAt === null) return null

  let tone: keyof typeof TONE_CLASS = 'warning'
  let headline = ''
  let detail = ''

  if (phase === 'offline') {
    tone = 'error'
    headline = 'OFFLINE'
    detail = lastSyncAt
      ? `SHOWING DATA SAVED AT ${clock(lastSyncAt)}`
      : 'WAITING FOR A NETWORK CONNECTION'
  } else if (phase === 'recovering') {
    tone = 'warning'
    headline = 'RECONNECTING'
    detail = 'CONTACTING THE SERVER'
  } else if (phase === 'unavailable') {
    tone = 'warning'
    headline = 'SERVER UNAVAILABLE'
    detail = lastSyncAt
      ? `SHOWING LAST SAVED DATA FROM ${clock(lastSyncAt)}`
      : 'THE FIRST LOAD WILL FILL THIS IN'
  } else if (recoveredAt !== null) {
    tone = 'success'
    headline = 'CONNECTION RESTORED'
    detail = 'DASHBOARD SYNCED'
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={cn('border-b', TONE_CLASS[tone])}
    >
      <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 md:px-6">
        <span
          aria-hidden="true"
          className={cn(
            'h-1.5 w-1.5 shrink-0',
            tone === 'success' ? 'bg-success' : 'bg-current',
            phase === 'recovering' && 'animate-pulse',
          )}
        />
        <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em]">
          {headline}
        </span>
        <span
          aria-hidden="true"
          className="hidden h-px min-w-6 flex-1 bg-current/25 sm:block"
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] opacity-80">
          {detail}
        </span>
        {nextRetryAt !== null && seconds > 0 && phase !== 'online' && (
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] opacity-80">
            · RETRY IN {seconds}S
          </span>
        )}
        {phase !== 'online' && (
          <button
            type="button"
            onClick={() => void retryNow()}
            disabled={isRetrying}
            className={cn(
              'ml-auto inline-flex min-h-8 items-center gap-1.5 border border-current/30 px-2.5',
              'font-mono text-[10px] uppercase tracking-[0.12em]',
              'hover:bg-current/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
              'disabled:cursor-not-allowed disabled:opacity-50',
            )}
          >
            <RefreshCw
              aria-hidden="true"
              className={cn('h-3 w-3', isRetrying && 'animate-spin')}
            />
            {isRetrying ? 'Trying' : 'Retry now'}
          </button>
        )}
      </div>
    </div>
  )
}
