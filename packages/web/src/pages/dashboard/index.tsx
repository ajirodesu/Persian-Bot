import { Helmet } from '@dr.pogodin/react-helmet'
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bot, Plus, ChevronRight } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import Card from '@/components/ui/data-display/Card'
import Alert from '@/components/ui/feedback/Alert'
import Badge from '@/components/ui/data-display/Badge'
import Skeleton from '@/components/ui/feedback/Skeleton'
import EmptyState from '@/components/ui/data-display/EmptyState'
import Status from '@/components/ui/data-display/Status'
import { ROUTES } from '@/constants/routes.constants'
import { useBotList } from '@/features/users/hooks/useBotList'
import { useBotStatus } from '@/features/users/hooks/useBotStatus'
import type { GetBotListItemDto } from '@/features/users/dtos/bot.dto'
import { getPlatformLabel } from '@/utils/bot.util'
import { getPlatformIcon, getPlatformColors } from '@/components/icons/PlatformIcons'

// ============================================================================
// BotCard
// ============================================================================

function BotCard({
  bot,
  onClick,
  isActive,
}: {
  bot: GetBotListItemDto
  onClick: () => void
  isActive: boolean
}) {
  const statusColor = isActive ? ('success' as const) : ('error' as const)
  const statusLabel = isActive ? 'Online' : 'Offline'
  const platformColors = getPlatformColors(bot.platform)

  return (
    <Card.Root
      variant="elevated"
      shadowElevation={1}
      padding="md"
      interactive
      onClick={onClick}
      className="group hover:shadow-elevation-2 hover:border-outline-variant/80 transition-all duration-normal border border-outline-variant/60"
    >
      {/* Identity + live status */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <span
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${platformColors}`}
          >
            {getPlatformIcon(bot.platform)}
          </span>
          <div className="min-w-0">
            <p className="text-title-md font-semibold text-on-surface truncate tracking-tight">
              {bot.nickname}
            </p>
            <p className="mt-0.5 text-body-sm text-on-surface-variant">
              {getPlatformLabel(bot.platform)}
            </p>
          </div>
        </div>

        <Status.Root colorPalette={statusColor} size="sm">
          <Status.Indicator
            colorPalette={statusColor}
            size="sm"
            pulse={isActive}
          />
          {statusLabel}
        </Status.Root>
      </div>

      {/* Prefix badge + chevron */}
      <div className="mt-4 flex items-center justify-between">
        <Badge
          variant="tonal"
          color="default"
          className="font-mono text-label-sm"
        >
          <span className="text-on-surface-variant/50 mr-1">prefix</span>
          {bot.prefix}
        </Badge>
        <ChevronRight className="h-4 w-4 text-on-surface-variant/30 group-hover:text-on-surface-variant/60 transition-colors duration-fast" />
      </div>
    </Card.Root>
  )
}

// ============================================================================
// BotCardSkeleton
// ============================================================================

function BotCardSkeleton() {
  return (
    <Card.Root
      variant="elevated"
      padding="md"
      shadowElevation={1}
      className="border border-outline-variant/60"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Skeleton variant="rounded" width={40} height={40} />
          <div className="flex flex-col gap-2 pt-0.5">
            <Skeleton textSize="title-md" width="128px" />
            <Skeleton textSize="body-sm" width="80px" />
          </div>
        </div>
        <Skeleton variant="rounded" width="64px" height="22px" />
      </div>
      <div className="mt-4 flex items-center justify-between">
        <Skeleton variant="rounded" width="90px" height="26px" />
        <Skeleton variant="circular" width={16} height={16} />
      </div>
    </Card.Root>
  )
}

// ============================================================================
// Page
// ============================================================================

export default function BotManagerPage() {
  const navigate = useNavigate()
  const { bots, isLoading, error } = useBotList()

  const sessionIds = useMemo(() => bots.map((b) => b.sessionId), [bots])
  const botStatuses = useBotStatus(sessionIds)

  const onlineBots = bots.filter(
    (b) => botStatuses[b.sessionId]?.active ?? false,
  ).length

  return (
    <div className="flex flex-col gap-6">
      <Helmet>
        <title>Bot Manager · Cat-Bot</title>
      </Helmet>

      {/* ── Page header ─────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
            Bot Manager
          </h1>
          <p className="mt-1 text-body-sm text-on-surface-variant">
            Configure and monitor your deployed bots.
            {!isLoading && bots.length > 0 && (
              <span className="ml-1.5 text-success font-medium">
                {onlineBots} of {bots.length} online
              </span>
            )}
          </p>
        </div>

        <Button
          variant="filled"
          color="primary"
          size="md"
          leftIcon={<Plus className="h-4 w-4" />}
          onClick={() => navigate(ROUTES.DASHBOARD.CREATE_NEW_BOT)}
        >
          Create New Bot
        </Button>
      </div>

      {/* ── Loading ────────────────────────────────────────────────────── */}
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <BotCardSkeleton />
          <BotCardSkeleton />
          <BotCardSkeleton />
        </div>
      )}

      {/* ── Error ──────────────────────────────────────────────────────── */}
      {!isLoading && error !== null && (
        <Alert
          variant="tonal"
          color="error"
          title="Error loading bots"
          message={error}
        />
      )}

      {/* ── Empty ──────────────────────────────────────────────────────── */}
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

      {/* ── Bot grid ───────────────────────────────────────────────────── */}
      {!isLoading && bots.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {bots.map((bot) => (
            <BotCard
              key={bot.sessionId}
              bot={bot}
              onClick={() =>
                navigate(`${ROUTES.DASHBOARD.BOT}?id=${bot.sessionId}`)
              }
              isActive={botStatuses[bot.sessionId]?.active ?? false}
            />
          ))}
        </div>
      )}
    </div>
  )
}
