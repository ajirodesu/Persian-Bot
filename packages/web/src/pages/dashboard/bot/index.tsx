import React, { useState, useEffect, useRef } from 'react'
import { Terminal, Clock, Layers, Hash, Users, Activity, Play, RotateCcw, Square } from 'lucide-react'
import _AnsiLib from 'ansi-to-react'
import Card from '@/components/ui/data-display/Card'
import ScrollArea from '@/components/ui/data-display/ScrollArea'
import Status from '@/components/ui/data-display/Status'
import Stat from '@/components/ui/data-display/Stat'
import { cn } from '@/utils/cn.util'
import Button from '@/components/ui/buttons/Button'
import { getPlatformLabel } from '@/utils/bot.util'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'
import { useBotLogs } from '@/features/users/hooks/useBotLogs'
import { botService } from '@/features/users/services/bot.service'

const Ansi =
  (
    _AnsiLib as unknown as {
      default: React.FC<{ children: string; className?: string }>
    }
  ).default ??
  (_AnsiLib as unknown as React.FC<{ children: string; className?: string }>)

// ── Uptime ticker ─────────────────────────────────────────────────────────────
function UptimeDisplay({ startedAt }: { startedAt: number }) {
  const [uptime, setUptime] = useState('')

  useEffect(() => {
    const tick = () => {
      const diff = Math.floor((Date.now() - startedAt) / 1000)
      const h = Math.floor(diff / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = diff % 60
      setUptime(`${h}h ${m}m ${s}s`)
    }
    tick()
    const interval = setInterval(tick, 1000)
    return () => clearInterval(interval)
  }, [startedAt])

  return <>{uptime}</>
}

// ── Traffic-light cluster ──────────────────────────────────────────────────────
/**
 * macOS-style window control dots rendered in the terminal chrome bar.
 * Purely decorative — no click handlers, matching the existing fake dashboard
 * widget on the Home page for visual consistency.
 */
function TrafficLights() {
  return (
    <div className="flex items-center gap-2 shrink-0" aria-hidden="true">
      <span className="h-2.5 w-2.5 rounded-full bg-[#FF5F57] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#FEBC2E] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]" />
      <span className="h-2.5 w-2.5 rounded-full bg-[#28C840] shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)]" />
    </div>
  )
}

// ── Sidebar metric card ────────────────────────────────────────────────────────
function InfoCard({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <Card.Root padding="sm" shadowElevation={1}>
      <div className="flex items-center gap-4">
        <div className="text-on-surface-variant p-2 shrink-0 [&>svg]:h-[18px] [&>svg]:w-[18px]">
          {icon}
        </div>
        <Stat.Root size="sm" className="flex-1 min-w-0 overflow-hidden">
          <Stat.Label>{label}</Stat.Label>
          {children}
        </Stat.Root>
      </div>
    </Card.Root>
  )
}

/**
 * Console Page — /dashboard/bot?id=xxx
 * Handles real-time logs and bot lifecycle commands.
 */
export default function BotConsolePage() {
  const { bot, isActive, startedAt, id } = useBotContext()
  const sessionKey = bot
    ? `${bot.userId}:${bot.platformId}:${bot.sessionId}`
    : undefined
  const { logs, clearLogs } = useBotLogs(sessionKey)

  // Scroll anchor ref
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    el.parentElement?.scrollTo({
      top: el.parentElement.scrollHeight,
      behavior: 'smooth',
    })
  }, [logs])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <h2 className="text-headline-sm font-semibold text-on-surface leading-none">
            {bot.nickname}
          </h2>
        </div>

        <div className="grid grid-cols-3 sm:flex items-center gap-2 w-full sm:w-auto">
          <Button
            variant="filled"
            color="success"
            onClick={() => void botService.startBot(id)}
            disabled={isActive}
            leftIcon={<Play className="h-4 w-4 shrink-0 fill-current" />}
            className="w-full justify-center"
          >
            Start
          </Button>
          <Button
            color="primary"
            onClick={() => {
              clearLogs()
              void botService.restartBot(id)
            }}
            disabled={!isActive}
            leftIcon={<RotateCcw className="h-4 w-4 shrink-0" />}
            className="w-full justify-center"
          >
            Restart
          </Button>
          <Button
            variant="filled"
            color="error"
            onClick={() => {
              clearLogs()
              void botService.stopBot(id)
            }}
            disabled={!isActive}
            leftIcon={<Square className="h-4 w-4 shrink-0 fill-current" />}
            className="w-full justify-center"
          >
            Stop
          </Button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-4 items-start">
        <div className="w-full lg:flex-1 min-w-0">
          {/* Terminal — identical surface, radius, hairline and elevation to
             every Card.Root in the dashboard (see InfoCard below), so it
             reads as a themed panel rather than a separate "black box"
             widget. `bg-surface` matches Card.Root's default surfaceLevel
             exactly (Card.Root defaults to `bg-surface`, not
             `bg-surface-container` — using the container shade here made
             the terminal a visibly different tone from every InfoCard next
             to it). Radius fallback matches Card.Root's own hardcoded
             fallback (0.75rem) so the two never drift if the CSS var is
             ever unset. */}
          <div
            className={cn(
              'flex flex-col overflow-hidden bg-surface text-on-surface',
              'rounded-[var(--radius-card,0.75rem)]',
              'outline outline-1 outline-offset-[-1px] outline-[var(--color-hairline-border,transparent)]',
              'shadow-elevation-1',
            )}
          >
            {/* Chrome bar — traffic lights on the left, title centred. Same
               surface as the feed below it, only a hairline divides them. */}
            <div className="flex items-center gap-3 border-b border-[color:var(--color-hairline-border,transparent)] px-4 py-3">
              <TrafficLights />
              <div className="flex items-center gap-2 min-w-0">
                <Terminal className="h-3.5 w-3.5 text-on-surface-variant/70 shrink-0" />
                <span className="text-label-sm text-on-surface-variant/70 font-mono truncate">
                  {bot.nickname} — live feed
                </span>
              </div>
            </div>

            <ScrollArea.Root style={{ height: '26rem' }}>
              {/*
               * `[&_span]:!bg-transparent` strips the background-color that
               * ansi-to-react inlines onto each span for ANSI background
               * (bg*) codes — e.g. a library printing a colored highlight
               * block behind a warning/error line. That inline
               * background-color is what shows up as a "highlight mark" on
               * individual log lines, clashing with the themed panel
               * surface behind it. The Tailwind `!` important beats the
               * library's inline style, while foreground `color` (set via
               * a separate `style` property) is left untouched so log
               * colors are unaffected.
               */}
              <ScrollArea.Viewport
                className={cn(
                  'p-4 flex flex-col gap-1',
                  // Kill the ANSI-inlined background on each colored span…
                  '[&_span]:!bg-transparent',
                  // …and the global `code { background / border / padding /
                  // border-radius }` rule from base.css (meant for inline
                  // markdown code snippets), which otherwise draws a boxed
                  // highlight — background fill *and* a 1px outline — around
                  // every single log line, since ansi-to-react renders each
                  // line as a bare <code> element.
                  '[&_code]:!bg-transparent [&_code]:!border-0 [&_code]:!p-0 [&_code]:!rounded-none',
                )}
              >
                {logs.length === 0 ? (
                  <p className="text-body-sm text-on-surface-variant/50 italic">
                    Waiting for log entries…
                  </p>
                ) : (
                  logs.map((line, i) => (
                    <Ansi
                      key={i}
                      className="font-mono text-xs sm:text-sm leading-relaxed break-all whitespace-pre-wrap"
                    >
                      {line}
                    </Ansi>
                  ))
                )}
                <div ref={bottomRef} />
              </ScrollArea.Viewport>
            </ScrollArea.Root>
          </div>
        </div>

        <div className="w-full lg:w-60 shrink-0 grid grid-cols-1 sm:grid-cols-2 lg:flex lg:flex-col gap-4">
          <InfoCard icon={<Activity />} label="Status">
            <Status.Root
              as="div"
              colorPalette={isActive ? 'success' : 'error'}
              size="sm"
            >
              <Status.Indicator
                colorPalette={isActive ? 'success' : 'error'}
                size="sm"
                pulse={isActive}
              />
              {isActive ? 'Online' : 'Offline'}
            </Status.Root>
          </InfoCard>

          <InfoCard icon={<Clock />} label="Uptime">
            <Stat.ValueText
              as="div"
              className={cn('truncate', !isActive && 'text-on-surface-variant')}
            >
              {isActive && startedAt ? (
                <UptimeDisplay startedAt={startedAt} />
              ) : (
                'Offline'
              )}
            </Stat.ValueText>
          </InfoCard>

          <InfoCard icon={<Layers />} label="Platform">
            <Stat.ValueText as="div" className="truncate">
              {getPlatformLabel(bot.platform)}
            </Stat.ValueText>
          </InfoCard>

          <InfoCard icon={<Hash />} label="Prefix">
            <Stat.ValueText as="div" className="truncate font-mono">
              {bot.prefix}
            </Stat.ValueText>
          </InfoCard>

          <InfoCard icon={<Users />} label="Bot Admins">
            <Stat.ValueText as="div" className="truncate">
              {bot.admins.length === 0 ? '—' : String(bot.admins.length)}
            </Stat.ValueText>
          </InfoCard>
        </div>
      </div>
    </div>
  )
}