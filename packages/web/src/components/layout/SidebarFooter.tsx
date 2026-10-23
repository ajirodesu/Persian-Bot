import { useState, useEffect } from 'react'
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import IconButton from '@/components/ui/buttons/IconButton'
import { cn } from '@/utils/cn.util'
import { H_HEIGHT, H_SEPARATOR } from '@/constants/header.constants'

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
 * shell (Bot Manager dashboard + admin panel), so both rails stay visually
 * identical by construction.
 *
 * Expanded row (h-14, mirroring the sidebar's h-14 identity row):
 *
 *   [ ● Dashboard ················ ONLINE  (toggle) ]
 *
 * Collapsed icon rail:
 *
 *   [ ● ]
 *   [ (toggle) ]
 *
 * The status light is not decorative: it is success-green "ONLINE" only
 * while the shell reports connectivity — red "OFFLINE" the moment either
 * the socket drops (dashboard) or the browser goes offline (everywhere).
 * Reduced-motion users get a static dot (global reduced-motion rules kill
 * the ping animation); when the rail is collapsed the title attribute
 * still surfaces the state on hover and the dot colour carries the tone.
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
        {/* Status light + scope label — grouped left, never spread apart.
            In the collapsed rail only the dot remains, tooltip still works. */}
        <span
          className={cn('flex min-w-0 items-center', collapsed && 'justify-center')}
          title={statusLabel}
          role="img"
          aria-label={`${statusLabel} — ${scopeLabel}`}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span
              aria-hidden="true"
              className={cn(
                'absolute inset-0 rounded-full animate-ping',
                isDown ? 'bg-error/60' : 'bg-success/60',
              )}
            />
            <span
              className={cn(
                'relative inline-flex h-2 w-2 rounded-full',
                isDown ? 'bg-error' : 'bg-success',
              )}
            />
          </span>
          {!collapsed && (
            <span className="ml-2.5 truncate text-[11px] leading-none font-medium font-mono uppercase tracking-[0.2em] text-on-surface-variant/70 select-none">
              {scopeLabel}
            </span>
          )}
        </span>

        {/* Right cluster — status word (expanded rail only) + collapse
            toggle. Wrapped so justify-between has exactly two children and
            the status word hugs the right edge instead of floating mid-row. */}
        {(!collapsed || onToggleCollapsed) && (
          <span className="flex shrink-0 items-center gap-1.5">
            {!collapsed && (
              <span
                className={cn(
                  'text-[11px] leading-none font-medium font-mono uppercase tracking-[0.2em] select-none',
                  isDown ? 'text-error/90' : 'text-success/90',
                )}
              >
                {statusLabel}
              </span>
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
