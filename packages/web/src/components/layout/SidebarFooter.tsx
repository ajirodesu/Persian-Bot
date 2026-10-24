import { useState, useEffect } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import IconButton from '@/components/ui/buttons/IconButton'
import { cn } from '@/utils/cn.util'
import { H_HEIGHT, H_SEPARATOR, H_SHELL_SCOPE } from '@/constants/header.constants'

// ============================================================================
// Online status
// ============================================================================

/** Live browser-network status: real `navigator.onLine` plus online/offline
 *  events, so the footer's status light tracks actual connectivity even in
 *  surfaces that never open a socket (e.g. the admin panel). */
function useBrowserOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  )

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return online
}

// ============================================================================
// SidebarFooter
// ============================================================================

/** Status light tone: 'ok' = success green, 'down' = error red. */
export type SidebarFooterTone = 'ok' | 'down'

export interface SidebarFooterProps {
  /** Micro-caps scope label on the left, e.g. 'Dashboard' / 'Admin Panel'. */
  scopeLabel: string
  /** Optional connectivity override supplied by the shell — dashboard wires
   *  its live socket state here. `undefined` falls back to real browser
   *  online/offline state. `false` forces the Offline (red) state. */
  online?: boolean
  /** Desktop-only icon-rail mode: no label/status word, stacked controls. */
  collapsed?: boolean
  /** Omitted on the mobile drawer, which has no rail to collapse. */
  onToggleCollapsed?: () => void
}

/**
 * Shared sidebar footer — the single implementation behind every sidebar
 * shell (Bot Manager dashboard + admin panel), so both rails stay identical
 * by construction.
 *
 * Expanded row (h-14, mirroring the sidebar's h-14 identity row) — a printed
 * status line with the state sitting at the far right of a filling rule:
 *
 *   [ ■ Dashboard ────────────────────────── ONLINE  (toggle) ]
 *
 * Collapsed icon rail:
 *
 *   [ ■ ]
 *   [ (toggle) ]
 *
 * The status light is not decorative: it is success-green only while the
 * shell reports connectivity — red the moment either the socket drops
 * (dashboard) or the browser goes offline (everywhere). The marker is a flat
 * 6px square with no animation; when the rail is collapsed the title
 * attribute still surfaces the state on hover and the square's colour
 * carries the tone.
 */
export default function SidebarFooter({
  scopeLabel,
  online,
  collapsed,
  onToggleCollapsed,
}: SidebarFooterProps) {
  const browserOnline = useBrowserOnline()
  const isDown = online === false || !browserOnline
  const statusLabel = isDown ? 'Offline' : 'Online'

  return (
    <div className={cn('shrink-0 border-t', H_SEPARATOR)}>
      <div
        className={cn(
          H_HEIGHT,
          'flex w-full items-center',
          collapsed ? 'flex-col justify-center gap-1.5' : 'justify-between gap-3 px-6',
        )}
      >
        {/* Status marker + scope label — grouped left, never spread apart.
            In the collapsed rail only the square remains, tooltip still works. */}
        <span
          className={cn('flex min-w-0 items-center gap-2', collapsed && 'justify-center')}
          title={statusLabel}
          role="img"
          aria-label={`${statusLabel} — ${scopeLabel}`}
        >
          <span
            aria-hidden="true"
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-[1px]',
              isDown ? 'bg-error' : 'bg-success',
            )}
          />
          {!collapsed && (
            <span className={cn(H_SHELL_SCOPE, 'truncate')}>{scopeLabel}</span>
          )}
        </span>

        {/* Right cluster — hairline rule, status word, collapse toggle. The
            rule fills the gap so the row reads as one continuous line rather
            than two floating fragments. */}
        {(!collapsed || onToggleCollapsed) && (
          <span
            className={cn(
              'flex items-center gap-2',
              collapsed ? 'shrink-0' : 'flex-1',
            )}
          >
            {!collapsed && (
              <>
                <span aria-hidden="true" className="h-px flex-1 bg-hairline" />
                <span
                  className={cn(
                    'font-mono text-[10px] uppercase tracking-[0.2em] select-none',
                    isDown ? 'text-error' : 'text-success',
                  )}
                >
                  {statusLabel}
                </span>
              </>
            )}
            {onToggleCollapsed && (
              <IconButton
                variant="text"
                size="sm"
                icon={
                  collapsed ? (
                    <PanelLeftOpen className="h-4 w-4" />
                  ) : (
                    <PanelLeftClose className="h-4 w-4" />
                  )
                }
                aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                onClick={onToggleCollapsed}
              />
            )}
          </span>
        )}
      </div>
    </div>
  )
}
