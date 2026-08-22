import { Helmet } from '@dr.pogodin/react-helmet'
import {
  useSearchParams,
  useNavigate,
  useLocation,
  Outlet,
  useOutletContext,
} from 'react-router-dom'
import { Bot, ArrowLeft, Terminal, List, Zap, Database, Settings } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import Skeleton from '@/components/ui/feedback/Skeleton'
import { cn } from '@/utils/cn.util'
import { ROUTES } from '@/constants/routes.constants'

import { useBotDetail } from '@/features/users/hooks/useBotDetail'
import { useBotStatus } from '@/features/users/hooks/useBotStatus'
import type { GetBotDetailResponseDto } from '@/features/users/dtos/bot.dto'

/** The bot section's page switcher — one entry per nested route. */
const BOT_TABS = [
  { value: 'console', label: 'Console', Icon: Terminal },
  { value: 'commands', label: 'Commands', Icon: List },
  { value: 'events', label: 'Events', Icon: Zap },
  { value: 'database', label: 'Database', Icon: Database },
  { value: 'settings', label: 'Settings', Icon: Settings },
] as const

export interface BotContextType {
  bot: GetBotDetailResponseDto
  setBot: (bot: GetBotDetailResponseDto) => void
  isActive: boolean
  startedAt: number | null
  id: string
}

/**
 * Custom hook to consume the bot context provided by the BotLayout.
 * Sub-pages (Console, Commands, Events, Settings) use this to avoid re-fetching data.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useBotContext() {
  return useOutletContext<BotContextType>()
}

/**
 * Bot detail layout wrapper — reached via /dashboard/bot?id=<id>
 *
 * Provides the core bot fetching state and the global Tabs navigation header.
 * Uses <Outlet> to render the active tab as a nested React Router page.
 */
export default function BotLayout() {
  const [searchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const id = searchParams.get('id') ?? ''

  const botStatuses = useBotStatus(id ? [id] : [])
  const { bot, setBot, isLoading, error } = useBotDetail(id)

  const botStatus = botStatuses[id] ?? { active: false, startedAt: null }
  const isActive = botStatus.active
  const startedAt = botStatus.startedAt

  // Determine active tab from URL path
  const pathParts = location.pathname.split('/')
  const lastSegment = pathParts[pathParts.length - 1]
  const currentTab = lastSegment === 'bot' ? 'console' : lastSegment

  const handleTabChange = (value: string) => {
    // Preserve the ?id query param across tab navigation
    if (value === 'console') {
      navigate(`${ROUTES.DASHBOARD.BOT}?id=${id}`)
    } else {
      navigate(`${ROUTES.DASHBOARD.BOT}/${value}?id=${id}`)
    }
  }

  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        {/* Segmented switcher placeholder — mirrors the pill container below */}
        <div className="flex w-fit max-w-full items-center gap-1 rounded-[var(--radius-input)] border border-hairline bg-surface-container-low/80 p-1">
          {BOT_TABS.map((tab) => (
            <Skeleton
              key={tab.value}
              variant="pill"
              width={96}
              height={32}
              animation="pulse"
            />
          ))}
        </div>
        {/* Content placeholder — header + stat/sidebar blocks */}
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <Skeleton variant="text" textSize="headline-sm" width="180px" />
            <div className="flex items-center gap-2">
              <Skeleton variant="rounded" width="88px" height="36px" />
              <Skeleton variant="rounded" width="96px" height="36px" />
              <Skeleton variant="rounded" width="72px" height="36px" />
            </div>
          </div>
          <div className="flex flex-col lg:flex-row gap-4 items-start">
            <Skeleton
              variant="rounded"
              height={416}
              className="w-full lg:flex-1"
            />
            <div className="w-full lg:w-60 shrink-0 flex flex-col gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton
                  key={i}
                  variant="rounded"
                  height={72}
                  className="w-full"
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Missing or unknown bot ID — surface a clear recovery path instead of a blank page
  if (error || !bot) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-on-surface">
        <Bot className="h-12 w-12 text-on-surface-variant/40" />
        <p className="text-headline-sm font-medium">
          {error || 'Bot not found'}
        </p>
        <p className="text-body-md text-on-surface-variant">
          No bot exists with ID <code>{id || '(empty)'}</code>.
        </p>
        <Button
          variant="tonal"
          color="primary"
          size="lg"
          leftIcon={<ArrowLeft className="h-4 w-4" />}
          onClick={() => navigate(ROUTES.DASHBOARD.ROOT)}
        >
          Back to Bot Manager
        </Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Dynamic title shows which bot is open */}
      <Helmet>
        <title>{bot.nickname} · Cat-Bot</title>
      </Helmet>

      {/* Page switcher — a premium segmented control (Linear/Vercel style):
          a pill container where the active page rises to an elevated surface
          thumb with a soft shadow, and inactive items are quiet until hovered.
          Horizontally scrollable on phones so all five sections stay one swipe
          away; icons + labels aid recognition at a glance. */}
      <div
        role="tablist"
        aria-label="Bot sections"
        className="flex max-w-full gap-1 overflow-x-auto rounded-[var(--radius-input)] border border-hairline bg-surface-container-low/80 p-1"
      >
        {BOT_TABS.map(({ value, label, Icon }) => {
          const active = currentTab === value
          return (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => handleTabChange(value)}
              className={cn(
                'flex shrink-0 cursor-pointer items-center gap-2 whitespace-nowrap rounded-[calc(var(--radius-input)-0.25rem)] px-3.5 py-2 text-label-md font-medium outline-none transition-all duration-fast',
                'focus-visible:ring-2 focus-visible:ring-primary/40',
                active
                  ? 'bg-surface text-on-surface shadow-elevation-1'
                  : 'text-on-surface-variant hover:bg-on-surface/[var(--state-hover-opacity)] hover:text-on-surface',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          )
        })}
      </div>

      {/* Outlet renders the specific page chunk, wrapped in animation classes matching Tabs.Panel */}
      <div className="focus-visible:outline-none animate-in fade-in slide-in-from-left-2 duration-normal ease-[var(--easing-emphasized-decelerate)]">
        <Outlet
          context={
            { bot, setBot, isActive, startedAt, id } satisfies BotContextType
          }
        />
      </div>
    </div>
  )
}
