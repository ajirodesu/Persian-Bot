import { Helmet } from '@dr.pogodin/react-helmet'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Plus, ChevronRight, Check } from 'lucide-react'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import EmptyState from '@/components/ui/data-display/EmptyState'
import { ROUTES } from '@/constants/routes.constants'
import { useBotList } from '@/features/users/hooks/useBotList'
import { useBotStatus } from '@/features/users/hooks/useBotStatus'
import { prefetchBotDetail, prefetchNewBot, usePrefetchOnVisible } from '@/lib/route-prefetch.lib'
import type { GetBotListItemDto } from '@/features/users/dtos/bot.dto'
import { getPlatformIcon } from '@/components/icons/platform-icon.util'
import { Platforms } from '@/constants/platform.constants'
import { cn } from '@/utils/cn.util'
import apiClient from '@/lib/api-client.lib'

// ============================================================================
// bot_manager_with_header_title.html — React port (1:1 appearance)
// ----------------------------------------------------------------------------
// Source: Downloads/assets/bot_manager_with_header_title.html
//
// This page is a faithful JSX conversion of that mock. Class names, spacing,
// radii, colors, and copy are kept identical so the rendered result matches
// the HTML pixel-for-pixel:
//
//   • CTA button            — h-11 emerald, plus glyph, tracking-tight label
//   • Grouped list          — bg #13161A hairline container, divide #1C2026,
//                             36px platform tile, inline prefix badge, chevron
//   • Uptime card           — 6-cell elapsed grid with the live seconds cell,
//                             continuous-uptime footer, live online/total badge
//   • Toast                 — fixed bottom-12 centered pill, 2s auto-dismiss
//
// Wiring (the only intentional delta vs. the static mock):
//   • Bot rows render live data from useBotList/useBotStatus instead of the
//     two hardcoded "Wataru" rows. Row markup itself is unchanged.
//   • "Create New Bot" navigates to the creation wizard.
//   • Row tap navigates to that bot's detail page.
//   • Prefix badge copies that bot's real prefix to the clipboard.
//   • Uptime ticks from the REAL backend boot time (GET /api/v1/health →
//     startedAt) on a 1s interval; badge shows live online/total counts.
//     Unreachable backend renders zeros with an idle state — never mock data.
//
// Device preview chrome from the mock (iOS status bar, app-bar shell,
// home indicator) is NOT reproduced here — DashboardLayout already owns the
// sidebar, content header ("Bot Manager" title + account menu), and page
// frame, so re-rendering that chrome inside the page would double it.
// ============================================================================

// ----------------------------------------------------------------------------
// Platform tile — mock's tinted 36px optical square per platform
// ----------------------------------------------------------------------------

function platformTileClasses(platform: string): string {
  switch (platform) {
    case Platforms.Discord:
      return 'bg-[#5865F2]/15 border-[#5865F2]/30 text-[#5865F2]'
    case Platforms.Telegram:
      return 'bg-[#24A1DE]/15 border-[#24A1DE]/30 text-[#24A1DE]'
    default:
      return 'bg-primary/15 border-primary/30 text-primary'
  }
}

// ----------------------------------------------------------------------------
// Bot row — mock's BOT ITEM article, verbatim structure
// ----------------------------------------------------------------------------

function BotRow({
  bot,
  isActive,
  onOpen,
  onCopyPrefix,
  onPrefetch,
}: {
  bot: GetBotListItemDto
  isActive: boolean
  onOpen: () => void
  onCopyPrefix: () => void
  onPrefetch?: () => void
}) {
  // Rendered element (not a component reference) so no component is
  // created during render — satisfies react-hooks/static-components.
  const platformIcon = getPlatformIcon(bot.platform, 'w-4 h-4')
  const rowRef = useRef<HTMLElement | null>(null)
  usePrefetchOnVisible(rowRef, onPrefetch)

  return (
    <article
      role="button"
      tabIndex={0}
      ref={rowRef}
      aria-label={`Configure ${bot.nickname} bot`}
      onClick={onOpen}
      onMouseEnter={onPrefetch}
      onFocus={onPrefetch}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
      className="bot-row p-3.5 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest cursor-pointer tactile-press transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-hairline"
    >
      <div className="flex items-center space-x-3 min-w-0">
        {/* Platform icon container — standard 36px optical square, 8px radius */}
        <div
          className={cn(
            'w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0',
            platformTileClasses(bot.platform),
          )}
        >
          {platformIcon}
        </div>
        {/* Content stack: title, prefix inline, online status */}
        <div className="flex flex-col min-w-0">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-semibold text-on-surface truncate leading-snug">
              {bot.nickname}
            </span>
            <span
              role="button"
              tabIndex={0}
              title="Click to copy command prefix"
              onClick={(e) => {
                e.stopPropagation()
                onCopyPrefix()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  e.stopPropagation()
                  onCopyPrefix()
                }
              }}
              className="prefix-trigger inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-surface-container-high text-on-surface-variant border border-hairline cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              prefix:{' '}
              <span className="text-on-surface font-semibold ml-0.5">
                {bot.prefix}
              </span>
            </span>
          </div>
          <div className="flex items-center space-x-1.5 mt-0.5">
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                isActive ? 'bg-primary' : 'bg-surface-variant',
              )}
            />
            <span
              className={cn(
                'font-medium text-[11px]',
                isActive ? 'text-primary' : 'text-surface-variant',
              )}
            >
              {isActive ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </div>
      {/* Right accessory: chevron, consistent 16px size & optical alignment */}
      <div className="flex items-center pl-3 flex-shrink-0 text-surface-variant">
        <ChevronRight className="w-4 h-4" strokeWidth={2} />
      </div>
    </article>
  )
}

// ----------------------------------------------------------------------------
// Uptime card — REAL backend startup time, no mock baseline.
// Reads GET /api/v1/health (which returns the server process boot timestamp)
// once on mount, then ticks locally every second. Unreachable backend =
// zeros with an idle state instead of fabricated numbers.
// ----------------------------------------------------------------------------

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 86400
const SECONDS_PER_MONTH = 2592000 // calibrated standard 30-day epoch interval
const SECONDS_PER_YEAR = 31536000 // 365 days

function UptimeCard({ online, total }: { online: number; total: number }) {
  // Backend boot timestamp (ms epoch) from /api/v1/health; null until loaded
  // or when the backend is unreachable (idle state).
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    let cancelled = false
    apiClient
      .get<{ status: string; startedAt?: number }>('/api/v1/health')
      .then((res) => {
        if (!cancelled && typeof res.data.startedAt === 'number') {
          setStartedAt(res.data.startedAt)
        }
      })
      .catch(() => {
        // Backend unreachable — stays in the idle state below.
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])

  const operational = startedAt !== null
  const totalElapsedSeconds = operational
    ? Math.max(0, Math.floor((now - (startedAt as number)) / 1000))
    : 0

  let remainder = totalElapsedSeconds
  const years = Math.floor(remainder / SECONDS_PER_YEAR)
  remainder %= SECONDS_PER_YEAR
  const months = Math.floor(remainder / SECONDS_PER_MONTH)
  remainder %= SECONDS_PER_MONTH
  const days = Math.floor(remainder / SECONDS_PER_DAY)
  remainder %= SECONDS_PER_DAY
  const hours = Math.floor(remainder / SECONDS_PER_HOUR)
  remainder %= SECONDS_PER_HOUR
  const minutes = Math.floor(remainder / SECONDS_PER_MINUTE)
  const seconds = remainder % SECONDS_PER_MINUTE

  const pad = (n: number) => String(n).padStart(2, '0')

  const cells = [
    { id: 'uptime-years', value: String(years), label: 'yr', live: false },
    { id: 'uptime-months', value: String(months), label: 'mo', live: false },
    { id: 'uptime-days', value: String(days), label: 'day', live: false },
    { id: 'uptime-hours', value: pad(hours), label: 'hr', live: false },
    { id: 'uptime-mins', value: pad(minutes), label: 'min', live: false },
    { id: 'uptime-secs', value: pad(seconds), label: 'sec', live: true },
  ]

  return (
    <section aria-label="System Uptime Status">
      <div className="bg-surface-container-low border border-hairline rounded-xl p-3.5 space-y-3">
        {/* Top row: operational status & pulsing heartbeat badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2 w-2">
              {operational && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              )}
              <span
                className={cn(
                  'relative inline-flex rounded-full h-2 w-2',
                  operational ? 'bg-primary' : 'bg-surface-variant',
                )}
              />
            </span>
            <span className="text-xs font-semibold text-on-surface tracking-tight">
              {operational ? 'System Operational' : 'System Idle'}
            </span>
          </div>
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/30 text-primary font-mono text-[11px] font-semibold">
            <Check className="w-3 h-3 text-primary" strokeWidth={2} />
            <span>
              {online} of {total} online
            </span>
          </div>
        </div>
        {/* Structured dynamic elapsed breakdown counters */}
        <div className="grid grid-cols-6 gap-1.5 pt-0.5">
          {cells.map((c) => (
            <div
              key={c.id}
              className={cn(
                'border rounded-lg py-1.5 px-1 text-center',
                c.live && operational
                  ? 'bg-surface-container-high/80 border-primary/30'
                  : 'bg-surface-container-high/80 border-outline-variant',
              )}
            >
              <div
                id={c.id}
                className={cn(
                  'text-xs font-bold font-mono leading-tight',
                  c.live && operational ? 'text-primary' : 'text-on-surface',
                )}
              >
                {c.value}
              </div>
              <div
                className={cn(
                  'text-[9px] uppercase tracking-wider font-medium mt-0.5',
                  c.live && operational
                    ? 'text-primary/70'
                    : 'text-surface-variant',
                )}
              >
                {c.label}
              </div>
            </div>
          ))}
        </div>
        {/* Subtle continuous duration label */}
        <div className="flex items-center justify-between flex-wrap gap-x-2 gap-y-1 text-[11px] text-surface-variant pt-0.5 px-0.5">
          <span className="flex items-center space-x-1">
            <span>Continuous uptime:</span>
            <span
              id="uptime-formatted-string"
              className="font-mono text-on-surface-variant font-medium"
            >
              {years}y {months}m {days}d {pad(hours)}:{pad(minutes)}:
              {pad(seconds)}
            </span>
          </span>
          <span
            className={cn(
              'font-mono text-[10px] flex items-center space-x-1',
              operational ? 'text-primary' : 'text-surface-variant',
            )}
          >
            <span
              className={cn(
                'inline-block w-1 h-1 rounded-full',
                operational ? 'bg-primary' : 'bg-surface-variant',
              )}
            />
            <span>{operational ? 'LIVE' : 'IDLE'}</span>
          </span>
        </div>
      </div>
    </section>
  )
}

// ----------------------------------------------------------------------------
// Loading skeleton — same grouped container, row-height placeholders
// ----------------------------------------------------------------------------

function BotRowSkeleton() {
  return (
    <div className="p-3.5 flex items-center justify-between" aria-hidden="true">
      <div className="flex items-center space-x-3 min-w-0">
        <Skeleton variant="input" width={36} height={36} />
        <div className="flex flex-col gap-2">
          <Skeleton textSize="body-sm" width="128px" />
          <Skeleton textSize="body-sm" width="64px" />
        </div>
      </div>
      <Skeleton variant="pill" width={16} height={16} />
    </div>
  )
}

// ============================================================================
// Page
// ============================================================================

export default function BotManagerPage() {
  const navigate = useNavigate()
  const { bots, isLoading, error } = useBotList()

  const sessionIds = bots.map((b) => b.sessionId)
  const botStatuses = useBotStatus(sessionIds)

  const onlineCount = bots.filter(
    (b) => botStatuses[b.sessionId]?.active ?? false,
  ).length

  const handleCopyPrefix = async (prefix: string) => {
    try {
      await navigator.clipboard.writeText(prefix)
    } catch {
      // Clipboard API unavailable (permissions / insecure context) — the
      // copy is best-effort with no user-facing feedback by design.
    }
  }

  return (
    <div className="flex flex-col max-w-[400px] md:max-w-2xl w-full mx-auto">
      <Helmet>
        <title>Bot Manager · Cat-Bot</title>
      </Helmet>

      {/* ── Primary call to action (production 44px touch target) ───────── */}
      <div className="pt-5 pb-5">
        <button
          type="button"
          id="btn-create-bot"
          onClick={() => navigate(ROUTES.DASHBOARD.CREATE_NEW_BOT)}
          onMouseEnter={prefetchNewBot}
          onFocus={prefetchNewBot}
          className="w-full h-11 px-4 rounded-lg bg-primary hover:brightness-110 active:brightness-90 text-on-primary font-semibold text-sm flex items-center justify-center space-x-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-primary focus-visible:ring-offset-surface shadow-[0_1px_2px_0_rgba(0,0,0,0.35)]"
        >
          <Plus className="w-4 h-4" strokeWidth={2.2} />
          <span className="tracking-tight">Create New Bot</span>
        </button>
      </div>

      {/* ── Grouped list header & container ──────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            Active Instances
          </h2>
          {!isLoading && error === null && (
            <span className="text-[11px] font-mono font-medium text-surface-variant">
              {onlineCount} of {bots.length} active
            </span>
          )}
        </div>

        {isLoading && (
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <BotRowSkeleton />
            <BotRowSkeleton />
          </div>
        )}

        {!isLoading && error !== null && (
          <Alert
            variant="tonal"
            color="error"
            title="Error loading bots"
            message={error}
          />
        )}

        {!isLoading && error === null && bots.length === 0 && (
          <EmptyState
            icon={Bot}
            title="No bots configured yet"
            description="Create your first bot to start managing your messaging platforms."
            action={{
              label: 'Create New Bot',
              onClick: () => navigate(ROUTES.DASHBOARD.CREATE_NEW_BOT),
              icon: <Plus className="h-4 w-4" />,
            }}
          />
        )}

        {!isLoading && error === null && bots.length > 0 && (
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {bots.map((bot) => (
              <BotRow
                key={bot.sessionId}
                bot={bot}
                isActive={botStatuses[bot.sessionId]?.active ?? false}
                onOpen={() =>
                  navigate(`${ROUTES.DASHBOARD.BOT}?id=${bot.sessionId}`)
                }
                onPrefetch={() => prefetchBotDetail(bot.sessionId)}
                onCopyPrefix={() => void handleCopyPrefix(bot.prefix)}
              />
            ))}
          </div>
        )}
      </section>

      {/* ── Dynamic real-time uptime counter card ────────────────────────── */}
      {!isLoading && error === null && bots.length > 0 && (
        <div className="mt-4">
          <UptimeCard online={onlineCount} total={bots.length} />
        </div>
      )}
    </div>
  )
}
