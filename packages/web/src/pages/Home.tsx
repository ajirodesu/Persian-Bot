import { Helmet } from '@dr.pogodin/react-helmet'
import { Link } from 'react-router-dom'
import { ArrowRight, Zap, Bot, LayoutDashboard, Globe, MessageSquare } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import { ROUTES } from '@/constants/routes.constants'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { DiscordIcon, TelegramIcon, FluxerIcon } from '@/components/icons/PlatformIcons'
import { getPlatformColors } from '@/components/icons/platform-icon.util'
import { Platforms } from '@/constants/platform.constants'

// ── Static data (real platform SVGs from source) ────────────────────────────

const PLATFORMS = [
  { name: 'Discord', Icon: DiscordIcon, bg: getPlatformColors(Platforms.Discord) },
  { name: 'Fluxer', Icon: FluxerIcon, bg: getPlatformColors(Platforms.Fluxer) },
  { name: 'Telegram', Icon: TelegramIcon, bg: getPlatformColors(Platforms.Telegram) },
  {
    name: 'Chat Room',
    Icon: MessageSquare,
    bg: 'bg-[#8B5CF6]/10 text-[#8B5CF6] border border-[#8B5CF6]/20',
  },
] as const

const FEATURES = [
  {
    Icon: Globe,
    title: 'Multi-Platform',
    description:
      'One codebase that runs natively on Discord, Telegram, and Fluxer — no per-platform rewrites.',
  },
  {
    Icon: Bot,
    title: 'Multi-Bot Management',
    description:
      'Run multiple independent bot sessions simultaneously, each with its own commands, prefix, and admin roster.',
  },
  {
    Icon: LayoutDashboard,
    title: 'Unified Dashboard',
    description:
      'Monitor live logs, enable or disable commands per session, and update credentials — all from one place.',
  },
  {
    Icon: Zap,
    title: 'Live Session Control',
    description:
      'Start, stop, and hot-restart any bot session without touching the server or redeploying code.',
  },
  {
    Icon: MessageSquare,
    title: 'Built-in Chat Room',
    description:
      'Chat with your bot directly from the dashboard — a real-time, Telegram-style test console with replies, attachments, and inline keyboards, no external platform required.',
  },
] as const

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-primary" />
      <span className="text-[11px] font-mono font-semibold tracking-wider uppercase text-primary">
        {children}
      </span>
    </div>
  )
}

// ── Page — cat_bot_home_bot_manager_style.html ──────────────────────────────

export default function HomePage() {
  const { isAuthenticated } = useUserAuth()

  return (
    <div className="flex flex-col bg-surface">
      <Helmet>
        <title>Cat-Bot</title>
      </Helmet>

      <main className="flex-1 w-full max-w-md mx-auto px-5 pt-6 pb-12 flex flex-col gap-10 lg:max-w-6xl lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* ── Hero ─────────────────────────────────────────────────── */}
          <section className="flex flex-col gap-5 pt-2">
            <Eyebrow>Multi-Platform • Multi-Bot • Open Source</Eyebrow>
            <h1 className="text-3xl font-bold tracking-tight text-on-surface leading-[1.18] lg:text-[42px]">
              Write once.
              <br />
              Deploy <span className="text-primary">everywhere.</span>
            </h1>
            <p className="text-[14px] text-on-surface-variant leading-relaxed tracking-normal max-w-lg">
              Cat-Bot is a unified chatbot framework that runs across Discord, Telegram, and
              Fluxer — all from a single codebase. Manage multiple independent bot sessions from
              one powerful dashboard.
            </p>

            {/* Platform chips — original source SVGs */}
            <div className="flex flex-wrap gap-2 pt-1">
              {PLATFORMS.map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-surface-container-high border border-hairline text-[12px] font-medium text-on-surface-variant"
                >
                  <p.Icon className="w-3.5 h-3.5" />
                  <span>{p.name}</span>
                </div>
              ))}
            </div>

            {/* Hero CTA — full-width h-12 emerald */}
            <div className="pt-2 flex flex-col gap-3">
              {isAuthenticated ? (
                <Button
                  as={Link}
                  to={ROUTES.DASHBOARD.ROOT}
                  variant="filled"
                  color="primary"
                  size="lg"
                  leftIcon={<LayoutDashboard className="h-4 w-4" />}
                  fullWidth
                  className="h-12 rounded-lg text-[14px]"
                >
                  Go to Dashboard
                </Button>
              ) : (
                <>
                  <Button
                    as={Link}
                    to={ROUTES.SIGNUP}
                    variant="filled"
                    color="primary"
                    size="lg"
                    rightIcon={<ArrowRight className="h-4 w-4" />}
                    fullWidth
                    className="h-12 rounded-lg text-[14px]"
                  >
                    Get Started Free
                  </Button>
                  <Button
                    as={Link}
                    to={ROUTES.LOGIN}
                    variant="outline"
                    color="primary"
                    size="lg"
                    fullWidth
                    className="h-12 rounded-lg text-[14px]"
                  >
                    Sign In
                  </Button>
                </>
              )}
            </div>
          </section>

          {/* ── Grouped session card (desktop companion, Bot Manager rows) ── */}
          <div className="hidden lg:block">
            <div className="rounded-xl overflow-hidden border border-hairline bg-surface-container-low">
              <div className="flex items-center gap-3 border-b border-outline-variant px-4 py-3">
                <span className="font-mono text-xs text-surface-variant select-none">
                  cat-bot — bot manager
                </span>
                <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-primary font-medium">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Online
                </span>
              </div>
              <div className="flex flex-col p-4">
                <p className="mb-2 px-1 text-[11px] font-semibold text-surface-variant uppercase tracking-wider">
                  Active Sessions
                </p>
                {PLATFORMS.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between py-2.5 px-1 border-b border-outline-variant last:border-b-0"
                  >
                    <div className="flex items-center gap-3">
                      <span
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${p.bg}`}
                      >
                        <p.Icon className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-on-surface">
                          {p.name === 'Chat Room' ? 'Chat Room' : `${p.name} Bot`}
                        </p>
                        <p className="text-xs text-surface-variant font-mono">
                          {p.name === 'Chat Room' ? 'built-in test console' : 'prefix: /'}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs text-primary font-medium">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                      Online
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── Capabilities ───────────────────────────────────────────── */}
        <section className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5 pb-1">
            <Eyebrow>Capabilities</Eyebrow>
            <h2 className="text-[22px] font-bold text-on-surface tracking-tight">
              Everything you need to run bots at scale
            </h2>
            <p className="text-[13px] text-on-surface-variant leading-normal max-w-xl">
              Built for developers and operators who want one framework for every major chat
              platform — without compromises.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {FEATURES.map((f) => (
              <article
                key={f.title}
                className="bg-surface-container-low border border-hairline rounded-xl p-4 flex gap-3.5 items-start active:bg-surface-container-highest active:opacity-[0.85] transition-colors duration-100"
              >
                <div className="w-10 h-10 rounded-lg bg-surface-container-high border border-hairline flex items-center justify-center shrink-0">
                  <f.Icon className="w-5 h-5 text-primary" strokeWidth={2} />
                </div>
                <div className="flex flex-col gap-1">
                  <h3 className="text-[15px] font-semibold text-on-surface tracking-tight">
                    {f.title}
                  </h3>
                  <p className="text-[13px] text-on-surface-variant leading-snug">{f.description}</p>
                </div>
              </article>
            ))}
          </div>
        </section>

        {/* ── CTA card ───────────────────────────────────────────────── */}
        <section className="bg-surface-container-low border border-hairline rounded-2xl p-5 flex flex-col gap-4 text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="text-[11px] font-mono font-semibold tracking-wider uppercase text-primary">
              Get Started
            </span>
          </div>
          <div className="space-y-1.5">
            <h2 className="text-xl font-bold text-on-surface tracking-tight">
              Ready to deploy your first bot?
            </h2>
            <p className="text-[13px] text-on-surface-variant leading-relaxed">
              Create your account and go from zero to a live multi-platform bot session in
              minutes.
            </p>
          </div>
          <div className="pt-1">
            {isAuthenticated ? (
              <Button
                as={Link}
                to={ROUTES.DASHBOARD.ROOT}
                variant="filled"
                color="primary"
                size="lg"
                leftIcon={<LayoutDashboard className="h-4 w-4" />}
                fullWidth
                className="h-12 rounded-lg text-[14px]"
              >
                Go to Dashboard
              </Button>
            ) : (
              <Button
                as={Link}
                to={ROUTES.SIGNUP}
                variant="filled"
                color="primary"
                size="lg"
                rightIcon={<ArrowRight className="h-4 w-4" />}
                fullWidth
                className="h-12 rounded-lg text-[14px]"
              >
                Create Free Account
              </Button>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
