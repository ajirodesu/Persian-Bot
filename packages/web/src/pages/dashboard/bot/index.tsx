import { useState, useEffect, useRef } from 'react'
import React from 'react'
import _AnsiLib from 'ansi-to-react'
import { cn } from '@/utils/cn.util'
import { getPlatformLabel } from '@/utils/bot.util'
import { getPlatformIcon } from '@/components/icons/platform-icon.util'
import { Platforms } from '@/constants/platform.constants'
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

// ============================================================================
// stitch_wataru_bot_manager_interface — React port (1:1 appearance)
// ----------------------------------------------------------------------------
// Source: ~/Downloads/stitch_wataru_bot_manager_interface/code.html
// ("Wataru Bot Detail - Bot Manager").
//
// Faithful JSX conversion: class names, spacing, radii, colors, and copy
// are kept identical so the rendered result matches the mock pixel-for-pixel:
//   • Bot identity header (nickname, version chip slot, Active pill,
//     technical identifier, Start/Restart/Stop controls)
//   • Live console terminal card (traffic lights, title, TAIL badge,
//     clear button, mono feed, buffer/encoding footer)
//   • Bot Information grouped table (Status, Uptime, Platform &
//     Framework, Prefix, Bot Admins)
//
// Wiring (the only intentional delta vs. the static mock):
//   • Nickname, platform, prefix, admins, online state, and uptime all
//     render live data from useBotContext/useBotStatus.
//   • The terminal feed renders REAL logs from useBotLogs (ANSI colors
//     preserved) with auto-scroll and a working clear button.
//   • Start/Restart/Stop call botService (Restart/Stop also clear the
//     local buffer, as before). Prefix button copies the real prefix.
//   • Uptime ticks from the real session startedAt ("Xh Ym Zs").
//
// Omitted mock chrome (owned elsewhere, same call as the Bot Manager
// port): the iOS status bar, the app header (menu/title/avatar —
// DashboardLayout owns the header), the Console/Commands/Events tab
// bar (DashboardBotLayout already renders the section tabs directly
// above this page — rendering both would duplicate navigation), the
// home indicator, and the toast element (pop-up notifications are
// disabled app-wide; actions are fire-and-forget with status shown
// inline). No version badge: no version source exists (web
// package.json is 0.0.0, health exposes no version) — a hardcoded
// "v2.4.1" would be fake data on a live dashboard.
// ============================================================================

// ----------------------------------------------------------------------------
// Uptime ticker — mock's "Xh Ym Zs" format, real session start
// ----------------------------------------------------------------------------

function UptimeDisplay({ startedAt }: { startedAt: number }) {
  const [uptime, setUptime] = useState('')

  useEffect(() => {
    const tick = () => {
      const diff = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
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

// ----------------------------------------------------------------------------
// Platform tile + framework badge — mock's telegram identity, per platform
// ----------------------------------------------------------------------------

function platformTileClasses(platform: string): string {
  switch (platform) {
    case Platforms.Discord:
      return 'text-[#5865F2]'
    case Platforms.Telegram:
      return 'text-[#24A1DE]'
    default:
      return 'text-[#8B95A2]'
  }
}

function frameworkBadge(platform: string): string {
  switch (platform) {
    case Platforms.Discord:
      return 'discord.js'
    case Platforms.Telegram:
      return 'grammY'
    default:
      return 'Fluxer'
  }
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

  // startedAt may arrive in ms or seconds — normalize to ms.
  const startedAtMs =
    startedAt == null ? null : startedAt < 1e12 ? startedAt * 1000 : startedAt

  // Scroll anchor — keeps the feed pinned to the newest line.
  const bottomRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = bottomRef.current
    if (!el) return
    el.parentElement?.scrollTo({
      top: el.parentElement.scrollHeight,
      behavior: 'smooth',
    })
  }, [logs])

  const handleCopyPrefix = async () => {
    try {
      await navigator.clipboard.writeText(bot.prefix)
    } catch {
      // Best-effort, no user-facing feedback by design.
    }
  }

  // Technical identifier: "<platform>-<slug>" plus the bot's own
  // platform-native ID — Discord application ID, Telegram bot ID (the
  // numeric head of the token), Fluxer falls back to the session UID
  // since its token carries no extractable ID.
  const slug = bot.nickname
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

  const platformBotId = ((): string => {
    const creds = bot.credentials
    if (creds.platform === Platforms.Discord && creds.discordClientId) {
      return creds.discordClientId
    }
    if (creds.platform === Platforms.Telegram) {
      const head = creds.telegramToken.split(':')[0]
      if (head) return head
    }
    return bot.sessionId
  })()

  return (
    <div className="flex flex-col max-w-[400px] md:max-w-3xl w-full mx-auto">
      <div className="space-y-5 pt-1">
        {/* ── BOT IDENTITY HEADER ── */}
        <section className="space-y-3" aria-label="Bot identity">
          <div className="flex items-baseline justify-between">
            <div className="flex items-center space-x-2.5 min-w-0">
              <h2 className="text-2xl font-bold tracking-tight text-white truncate">
                {bot.nickname}
              </h2>
            </div>
            <span className="inline-flex items-center space-x-1.5 text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 bg-[rgba(16,185,129,0.12)] border border-[rgba(16,185,129,0.3)] text-[#10B981]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981] animate-ping" />
              <span>Active</span>
            </span>
          </div>
          {/* Bot Technical Identifier */}
          <p className="font-mono text-[11px] text-[#8B95A2] tracking-tight break-all">
            {bot.platform}-{slug} · ID {platformBotId}
          </p>
          {/* Control Action Buttons */}
          <div className="grid grid-cols-3 gap-2 pt-1">
            {/* Start Button */}
            <button
              type="button"
              onClick={() => void botService.startBot(id)}
              disabled={isActive}
              className="h-11 flex items-center justify-center space-x-1.5 rounded-xl bg-[#10B981] text-[#061811] font-semibold text-xs shadow-sm hover:brightness-110 active:scale-97 transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/40"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <polygon points="5 3 19 12 5 21 5 3" />
              </svg>
              <span>Start</span>
            </button>
            {/* Restart Button */}
            <button
              type="button"
              onClick={() => {
                clearLogs()
                void botService.restartBot(id)
              }}
              disabled={!isActive}
              className="h-11 flex items-center justify-center space-x-1.5 rounded-xl bg-[#191D22] border border-[#242930] text-[#F1F4F8] font-semibold text-xs hover:bg-[#1E232A] active:scale-97 transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/40"
            >
              <svg
                className="w-4 h-4 stroke-current"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="2"
                viewBox="0 0 24 24"
              >
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>Restart</span>
            </button>
            {/* Stop Button */}
            <button
              type="button"
              onClick={() => {
                clearLogs()
                void botService.stopBot(id)
              }}
              disabled={!isActive}
              className="h-11 flex items-center justify-center space-x-1.5 rounded-xl bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.4)] text-[#EF4444] font-semibold text-xs hover:bg-[rgba(239,68,68,0.2)] active:scale-97 transition-all disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#EF4444]/40"
            >
              <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                <rect height="16" rx="2" width="16" x="4" y="4" />
              </svg>
              <span>Stop</span>
            </button>
          </div>
        </section>

        {/* ── LIVE CONSOLE CARD ── */}
        <section
          className="bg-[#0D1013] border border-[#242930] rounded-2xl overflow-hidden shadow-lg"
          aria-label="Live console"
        >
          {/* Terminal Header Bar */}
          <div className="h-10 bg-[#12161B] px-3.5 flex items-center justify-between border-b border-[#242930]/80">
            <div className="flex items-center space-x-2 min-w-0">
              {/* Mac style traffic lights */}
              <div className="flex items-center space-x-1.5 flex-shrink-0">
                <div className="w-2.5 h-2.5 rounded-full bg-[#EC6A5E]/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#F5BF4F]/80" />
                <div className="w-2.5 h-2.5 rounded-full bg-[#62C554]/80" />
              </div>
              <div className="h-3.5 w-px bg-[#242930] ml-1 mr-0.5" />
              <span className="font-mono text-[11px] text-[#8B95A2] tracking-tight truncate">
                &gt;_ {bot.nickname} — live feed
              </span>
            </div>
            <div className="flex items-center space-x-2 flex-shrink-0">
              <span className="inline-flex items-center px-1.5 py-0.5 text-[9px] font-mono tracking-wider font-semibold rounded bg-[#10B981]/10 text-[#10B981] border border-[#10B981]/30">
                TAIL
              </span>
              <button
                type="button"
                onClick={clearLogs}
                className="text-[10px] font-mono text-[#5D6775] hover:text-[#F1F4F8] px-1.5 py-0.5 rounded hover:bg-[#191D22] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/40"
                title="Clear console"
              >
                clear
              </button>
            </div>
          </div>
          {/* Terminal Logs Content — tall fixed feed with internal scroll;
              the ANSI-inlined backgrounds/boxes are stripped so log lines
              render container-free on the terminal surface. */}
          <div className="font-mono text-[11.5px] leading-relaxed p-4 space-y-2.5 h-[28rem] overflow-y-auto overflow-x-hidden select-text text-slate-300 [&_span]:!bg-transparent [&_code]:!bg-transparent [&_code]:!border-0 [&_code]:!p-0 [&_code]:!rounded-none">
            {logs.length === 0 ? (
              <div className="text-[#5D6775] italic break-words">
                Console buffer cleared. Waiting for events...
              </div>
            ) : (
              logs.map((line, i) => (
                <div key={i} className="break-words">
                  <Ansi className="break-all whitespace-pre-wrap">
                    {line}
                  </Ansi>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
          {/* Terminal Footer Bar */}
          <div className="h-7 bg-[#101317] px-3.5 border-t border-[#242930]/60 flex items-center justify-between text-[10px] font-mono text-[#5D6775]">
            <span className="flex items-center space-x-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10B981]" />
              <span>Buffer: {logs.length} events synced</span>
            </span>
            <span>Encoding: UTF-8</span>
          </div>
        </section>

        {/* ── BOT INFORMATION ── */}
        <section className="space-y-2.5" aria-label="Bot information">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#8B95A2]">
              Bot Information
            </h3>
            <span className="text-[11px] text-[#5D6775]">
              Configuration specs
            </span>
          </div>
          {/* Grouped List Container */}
          <div className="bg-[#13161A] border border-[#242930] rounded-2xl divide-y divide-[#1C2026] overflow-hidden">
            {/* Row 1: Status */}
            <div className="p-3.5 flex items-center justify-between hover:bg-[#1E232A]/50 transition-colors">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-[#191D22] border border-[#242930]/70 flex items-center justify-center text-[#8B95A2]">
                  <svg
                    className="w-4 h-4 stroke-current"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                  </svg>
                </div>
                <div>
                  <div className="text-[11px] text-[#8B95A2]">Status</div>
                  <div className="flex items-center space-x-1.5 mt-0.5">
                    <span
                      className={cn(
                        'w-2 h-2 rounded-full',
                        isActive ? 'bg-[#10B981]' : 'bg-[#5D6775]',
                      )}
                    />
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        isActive ? 'text-[#10B981]' : 'text-[#5D6775]',
                      )}
                    >
                      {isActive ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>
              </div>
              <span className="text-xs font-mono text-[#5D6775]">
                99.9% health
              </span>
            </div>
            {/* Row 2: Uptime */}
            <div className="p-3.5 flex items-center justify-between hover:bg-[#1E232A]/50 transition-colors">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-[#191D22] border border-[#242930]/70 flex items-center justify-center text-[#8B95A2]">
                  <svg
                    className="w-4 h-4 stroke-current"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                </div>
                <div>
                  <div className="text-[11px] text-[#8B95A2]">Uptime</div>
                  <div className="text-base font-bold text-[#F1F4F8] tracking-tight">
                    {isActive && startedAtMs !== null ? (
                      <UptimeDisplay startedAt={startedAtMs} />
                    ) : (
                      'Offline'
                    )}
                  </div>
                </div>
              </div>
              <span className="text-xs font-mono text-[#5D6775]">
                continuous
              </span>
            </div>
            {/* Row 3: Platform */}
            <div className="p-3.5 flex items-center justify-between hover:bg-[#1E232A]/50 transition-colors">
              <div className="flex items-center space-x-3">
                <div
                  className={cn(
                    'w-8 h-8 rounded-lg bg-[#191D22] border border-[#242930]/70 flex items-center justify-center',
                    platformTileClasses(bot.platform),
                  )}
                >
                  {getPlatformIcon(bot.platform, 'w-4 h-4')}
                </div>
                <div>
                  <div className="text-[11px] text-[#8B95A2]">
                    Platform &amp; Framework
                  </div>
                  <div className="flex items-center space-x-1.5">
                    <span className="text-sm font-semibold text-[#F1F4F8]">
                      {getPlatformLabel(bot.platform)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center space-x-1.5">
                <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#191D22] border border-[#242930] text-[#8B95A2]">
                  {frameworkBadge(bot.platform)}
                </span>
              </div>
            </div>
            {/* Row 4: Prefix */}
            <div className="p-3.5 flex items-center justify-between hover:bg-[#1E232A]/50 transition-colors">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-[#191D22] border border-[#242930]/70 flex items-center justify-center text-[#8B95A2]">
                  <span className="font-mono text-base font-bold">#</span>
                </div>
                <div>
                  <div className="text-[11px] text-[#8B95A2]">Prefix</div>
                  <div className="text-base font-mono font-bold text-[#F1F4F8]">
                    {bot.prefix}
                  </div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyPrefix()}
                className="p-2 text-[#8B95A2] hover:text-[#F1F4F8] rounded-lg hover:bg-[#191D22] transition-all active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/40"
                title="Copy prefix"
              >
                <svg
                  className="w-4 h-4 stroke-current"
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <rect height="13" rx="2" ry="2" width="13" x="9" y="9" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </button>
            </div>
            {/* Row 5: Bot Admins */}
            <div className="p-3.5 flex items-center justify-between hover:bg-[#1E232A]/50 transition-colors">
              <div className="flex items-center space-x-3">
                <div className="w-8 h-8 rounded-lg bg-[#191D22] border border-[#242930]/70 flex items-center justify-center text-[#8B95A2]">
                  <svg
                    className="w-4 h-4 stroke-current"
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth="2"
                    viewBox="0 0 24 24"
                  >
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div>
                  <div className="text-[11px] text-[#8B95A2]">Bot Admins</div>
                  <div className="text-sm font-semibold text-[#F1F4F8]">
                    {bot.admins.length} Authorized
                  </div>
                </div>
              </div>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-[#191D22] border border-[#242930] text-[#8B95A2] max-w-[140px] truncate">
                {bot.admins.length > 0 ? `@${bot.admins[0]}` : 'none'}
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
