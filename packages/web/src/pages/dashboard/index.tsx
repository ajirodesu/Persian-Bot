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
import { Platforms } from '@/constants/platform.constants'

// ============================================================================
// Platform Brand Icons
// ============================================================================

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
    </svg>
  )
}

function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  )
}

function getPlatformIcon(platform: string) {
  const iconClass = 'h-5 w-5'
  switch (platform) {
    case Platforms.Discord:
      return <DiscordIcon className={iconClass} />
    case Platforms.Telegram:
      return <TelegramIcon className={iconClass} />
    default:
      return <Bot className={iconClass} />
  }
}

function getPlatformColors(platform: string) {
  switch (platform) {
    case Platforms.Discord:
      return 'bg-[#5865F2]/10 text-[#5865F2] border border-[#5865F2]/20'
    case Platforms.Telegram:
      return 'bg-[#26A5E4]/10 text-[#26A5E4] border border-[#26A5E4]/20'
    default:
      return 'bg-primary-container text-on-primary-container border border-primary/20'
  }
}

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
      className="group hover:shadow-elevation-2 hover:border-outline-variant transition-all duration-normal border border-outline-variant/60"
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
