import { Helmet } from '@dr.pogodin/react-helmet'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Plus, ChevronRight, Check } from 'lucide-react'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import EmptyState from '@/components/ui/data-display/EmptyState'
import { ROUTES } from '@/constants/routes.constants'
import { useBotList } from '@/features/users/hooks/useBotList'
import { useBotStatus } from '@/features/users/hooks/useBotStatus'
import type { GetBotListItemDto } from '@/features/users/dtos/bot.dto'
import { getPlatformLabel } from '@/utils/bot.util'
import { getPlatformIcon, getPlatformColors } from '@/components/icons/platform-icon.util'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Bot row — bot_manager_with_header_title.html grouped-row pattern
// ============================================================================

function BotRow({
  bot,
  onClick,
  isActive,
  onCopyPrefix,
}: {
  bot: GetBotListItemDto
  onClick: () => void
  isActive: boolean
  onCopyPrefix: () => void
}) {
  const platformColors = getPlatformColors(bot.platform)

  return (
    <article
      role="button"
      tabIndex={0}
      aria-label={`Configure ${bot.nickname} bot`}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className="p-3.5 flex items-center justify-between hover:bg-[#1E232A]/60 active:bg-[#1E232A] active:opacity-[0.82] cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/40 focus-visible:ring-inset"
    >
      <div className="flex items-center space-x-3 min-w-0">
        {/* Platform icon — standard 36px optical square, original source SVG */}
        <div
          className={cn(
            'w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0',
            platformColors,
          )}
        >
          {getPlatformIcon(bot.platform, 'h-4 w-4')}
        </div>
        {/* Title + prefix + status */}
        <div className="flex flex-col min-w-0">
          <div className="flex items-center space-x-2">
            <span className="text-sm font-semibold text-[#F1F4F8] truncate leading-snug">
              {bot.nickname}
            </span>
            <button
              type="button"
              title="Click to copy command prefix"
              onClick={(e) => {
                e.stopPropagation()
                onCopyPrefix()
              }}
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[#191D22] text-[#8B95A2] border border-[#242930]/70 hover:border-[#10B981]/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/40"
            >
              prefix:{' '}
              <span className="text-[#F1F4F8] font-semibold ml-0.5">{bot.prefix}</span>
            </button>
          </div>
          <div className="flex items-center space-x-1.5 mt-0.5">
            <span
              className={cn(
                'w-1.5 h-1.5 rounded-full',
                isActive ? 'bg-[#10B981]' : 'bg-[#5D6775]',
              )}
            />
            <span
              className={cn(
                'font-medium text-[11px]',
                isActive ? 'text-[#10B981]' : 'text-[#5D6775]',
              )}
            >
              {isActive ? 'Online' : 'Offline'}
            </span>
          </div>
        </div>
      </div>
      {/* Chevron — consistent 16px optical alignment */}
      <div className="flex items-center pl-3 flex-shrink-0 text-[#5D6775]">
        <ChevronRight className="w-4 h-4" strokeWidth={2} />
      </div>
    </article>
  )
}

// ============================================================================
// Uptime card — live counter from the earliest active session start
// ============================================================================

const SECONDS_PER_MINUTE = 60
const SECONDS_PER_HOUR = 3600
const SECONDS_PER_DAY = 86400
const SECONDS_PER_MONTH = 2592000
const SECONDS_PER_YEAR = 31536000

function useNowTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [active])
  return now
}

function UptimeCard({ earliestStart, online, total }: { earliestStart: number | null; online: number; total: number }) {
  const now = useNowTick(earliestStart !== null)
  const operational = earliestStart !== null

  let years = 0
  let months = 0
  let days = 0
  let hours = 0
  let minutes = 0
  let seconds = 0
  if (earliestStart !== null) {
    let remainder = Math.max(0, Math.floor((now - earliestStart) / 1000))
    years = Math.floor(remainder / SECONDS_PER_YEAR)
    remainder %= SECONDS_PER_YEAR
    months = Math.floor(remainder / SECONDS_PER_MONTH)
    remainder %= SECONDS_PER_MONTH
    days = Math.floor(remainder / SECONDS_PER_DAY)
    remainder %= SECONDS_PER_DAY
    hours = Math.floor(remainder / SECONDS_PER_HOUR)
    remainder %= SECONDS_PER_HOUR
    minutes = Math.floor(remainder / SECONDS_PER_MINUTE)
    seconds = remainder % SECONDS_PER_MINUTE
  }
  const pad = (n: number) => String(n).padStart(2, '0')

  const cells = [
    { value: String(years), label: 'yr', live: false },
    { value: String(months), label: 'mo', live: false },
    { value: String(days), label: 'day', live: false },
    { value: pad(hours), label: 'hr', live: false },
    { value: pad(minutes), label: 'min', live: false },
    { value: pad(seconds), label: 'sec', live: true },
  ]

  return (
    <section aria-label="System Uptime Status">
      <div className="bg-[#13161A] border border-[#242930] rounded-xl p-3.5 space-y-3">
        {/* Status row + live badge */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <span className="relative flex h-2 w-2">
              {operational && (
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#10B981] opacity-75" />
              )}
              <span
                className={cn(
                  'relative inline-flex rounded-full h-2 w-2',
                  operational ? 'bg-[#10B981]' : 'bg-[#5D6775]',
                )}
              />
            </span>
            <span className="text-xs font-semibold text-[#F1F4F8] tracking-tight">
              {operational ? 'System Operational' : 'System Idle'}
            </span>
          </div>
          <div className="flex items-center space-x-1.5 px-2 py-0.5 rounded-full bg-[rgba(16,185,129,0.12)] border border-[rgba(16,185,129,0.3)] text-[#10B981] font-mono text-[11px] font-semibold">
            <Check className="w-3 h-3 text-[#10B981]" strokeWidth={2} />
            <span>
              {online} of {total} online
            </span>
          </div>
        </div>
        {/* Elapsed breakdown */}
        <div className="grid grid-cols-6 gap-1.5 pt-0.5">
          {cells.map((c) => (
            <div
              key={c.label}
              className={cn(
                'bg-[#191D22]/80 border rounded-lg py-1.5 px-1 text-center',
                c.live && operational
                  ? 'border-[rgba(16,185,129,0.3)]'
                  : 'border-[#1C2026]',
              )}
            >
              <div
                className={cn(
                  'text-xs font-bold font-mono leading-tight',
                  c.live && operational ? 'text-[#10B981]' : 'text-[#F1F4F8]',
                )}
              >
                {c.value}
              </div>
              <div
                className={cn(
                  'text-[9px] uppercase tracking-wider font-medium mt-0.5',
                  c.live && operational ? 'text-[#10B981]/70' : 'text-[#5D6775]',
                )}
              >
                {c.label}
              </div>
            </div>
          ))}
        </div>
        {/* Duration label */}
        <div className="flex items-center justify-between text-[11px] text-[#5D6775] pt-0.5 px-0.5">
          <span className="flex items-center space-x-1">
            <span>Continuous uptime:</span>
            <span className="font-mono text-[#8B95A2] font-medium">
              {years}y {months}m {days}d {pad(hours)}:{pad(minutes)}:{pad(seconds)}
            </span>
          </span>
          <span
            className={cn(
              'font-mono text-[10px] flex items-center space-x-1',
              operational ? 'text-[#10B981]' : 'text-[#5D6775]',
            )}
          >
            <span
              className={cn(
                'inline-block w-1 h-1 rounded-full',
                operational ? 'bg-[#10B981]' : 'bg-[#5D6775]',
              )}
            />
            <span>{operational ? 'LIVE' : 'IDLE'}</span>
          </span>
        </div>
      </div>
    </section>
  )
}

// ============================================================================
// Loading skeletons mirroring the grouped rows
// ============================================================================

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
  const { success } = useSnackbar()
  const { bots, isLoading, error } = useBotList()

  const sessionIds = useMemo(() => bots.map((b) => b.sessionId), [bots])
  const botStatuses = useBotStatus(sessionIds)

  const onlineBots = bots.filter((b) => botStatuses[b.sessionId]?.active ?? false)

  // Earliest live session start drives the uptime card (real data only).
  // startedAt may arrive in ms or seconds — normalize to ms.
  const earliestStart = useMemo(() => {
    const starts = onlineBots
      .map((b) => botStatuses[b.sessionId]?.startedAt ?? null)
      .filter((s): s is number => typeof s === 'number')
      .map((s) => (s < 1e12 ? s * 1000 : s))
    return starts.length > 0 ? Math.min(...starts) : null
  }, [onlineBots, botStatuses])

  const handleCopyPrefix = async (prefix: string) => {
    try {
      await navigator.clipboard.writeText(prefix)
      success(`Copied command prefix: "${prefix}"`)
    } catch {
      success(`Command prefix: "${prefix}"`)
    }
  }

  return (
    <div className="flex flex-col gap-0 max-w-[400px] w-full mx-auto md:max-w-2xl">
      <Helmet>
        <title>Bot Manager · Cat-Bot</title>
      </Helmet>

      {/* ── Primary CTA (h-11 emerald) ─────────────────────────────────── */}
      <div className="pt-5 pb-5">
        <button
          type="button"
          onClick={() => navigate(ROUTES.DASHBOARD.CREATE_NEW_BOT)}
          className="w-full h-11 px-4 rounded-lg bg-[#10B981] hover:bg-emerald-400 active:bg-emerald-600 active:opacity-[0.82] text-[#070B0E] font-semibold text-sm flex items-center justify-center space-x-2 transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-[#0A0C0E]"
        >
          <Plus className="w-4 h-4" strokeWidth={2.2} />
          <span className="tracking-tight">Create New Bot</span>
        </button>
      </div>

      {/* ── Grouped list ───────────────────────────────────────────────── */}
      <section className="space-y-2">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold text-[#8B95A2] uppercase tracking-wider">
            Active Instances
          </h2>
        </div>

        {isLoading && (
          <div className="bg-[#13161A] border border-[#242930] rounded-xl divide-y divide-[#1C2026] overflow-hidden">
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

        {!isLoading && bots.length > 0 && (
          <div className="bg-[#13161A] border border-[#242930] rounded-xl divide-y divide-[#1C2026] overflow-hidden">
            {bots.map((bot) => (
              <BotRow
                key={bot.sessionId}
                bot={bot}
                onClick={() => navigate(`${ROUTES.DASHBOARD.BOT}?id=${bot.sessionId}`)}
                isActive={botStatuses[bot.sessionId]?.active ?? false}
                onCopyPrefix={() => void handleCopyPrefix(bot.prefix)}
              />
            ))}
          </div>
        )}

        {/* Platform hint under the list */}
        {!isLoading && error === null && bots.length > 0 && (
          <p className="px-1 pt-1 text-[11px] text-[#5D6775]">
            {bots
              .map((b) => getPlatformLabel(b.platform))
              .filter((v, i, a) => a.indexOf(v) === i)
              .join(' · ')}
          </p>
        )}
      </section>

      {/* ── Uptime card ────────────────────────────────────────────────── */}
      {!isLoading && error === null && bots.length > 0 && (
        <div className="mt-4">
          <UptimeCard
            earliestStart={earliestStart}
            online={onlineBots.length}
            total={bots.length}
          />
        </div>
      )}
    </div>
  )
}
