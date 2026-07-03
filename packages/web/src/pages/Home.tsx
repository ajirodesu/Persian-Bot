import { Helmet } from '@dr.pogodin/react-helmet'
import { Link } from 'react-router-dom'
import { ArrowRight, Zap, Bot, LayoutDashboard, Globe, ChevronRight, MessageSquare } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import { ROUTES } from '@/constants/routes.constants'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { DiscordIcon, TelegramIcon, getPlatformColors } from '@/components/icons/PlatformIcons'
import { Platforms } from '@/constants/platform.constants'

// ── Static data ─────────────────────────────────────────────────────────────

const PLATFORMS = [
  {
    name: 'Discord',
    Icon: DiscordIcon,
    bg: getPlatformColors(Platforms.Discord),
  },
  {
    name: 'Telegram',
    Icon: TelegramIcon,
    bg: getPlatformColors(Platforms.Telegram),
  },
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
      'One codebase that runs natively on Discord and Telegram — no per-platform rewrites.',
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

// ── Page ─────────────────────────────────────────────────────────────────────

export default function HomePage() {
  const { isAuthenticated } = useUserAuth()

  return (
    <div className="flex flex-col">
      <Helmet>
        <title>Cat-Bot</title>
      </Helmet>

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden min-h-[calc(100vh-64px)] flex items-center">
        {/* Fine dot-grid atmosphere */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgb(var(--color-outline-variant) / 0.45) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
        />
        {/* Ambient glow — primary top-left, tertiary bottom-right */}
        <div className="pointer-events-none absolute -top-60 -left-60 h-[700px] w-[700px] rounded-full bg-primary/[0.06] blur-[120px]" />
        <div className="pointer-events-none absolute -bottom-40 -right-40 h-[500px] w-[500px] rounded-full bg-tertiary/[0.05] blur-[100px]" />

        <div className="relative z-10 w-full max-w-6xl mx-auto px-6 pb-16 pt-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            {/* ── Left: copy column ─────────────────────────────────────── */}
            <div className="flex flex-col gap-8">
              {/* Status badge */}
              <div
                className="inline-flex items-center gap-2 w-fit rounded-full border border-outline-variant/80 bg-surface-container-low px-3.5 py-1.5"
                style={{
                  animation:
                    'fade-in-down 400ms var(--easing-emphasized-decelerate) both',
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                <span className="text-label-sm font-medium text-on-surface-variant">
                  Multi-platform · Multi-bot · Open source
                </span>
              </div>

              {/* Headline */}
              <div className="flex flex-col gap-4">
                <h1
                  className="font-brand text-display-sm font-bold text-on-surface leading-[1.08] tracking-tight"
                  style={{
                    animation:
                      'fade-in-down 500ms 100ms var(--easing-emphasized-decelerate) both',
                  }}
                >
                  Write once.
                  <br />
                  <span className="text-primary">Deploy everywhere.</span>
                </h1>
                <p
                  className="text-body-lg text-on-surface-variant max-w-lg leading-relaxed"
                  style={{
                    animation:
                      'fade-in-down 500ms 200ms var(--easing-emphasized-decelerate) both',
                  }}
                >
                  Cat-Bot is a unified chatbot framework that runs across
                  Discord and Telegram — all from a single codebase. Manage
                  multiple independent bot sessions from one powerful dashboard.
                </p>
              </div>

              {/* Platform badge row */}
              <div
                className="flex flex-wrap gap-2"
                style={{
                  animation:
                    'fade-in-down 500ms 300ms var(--easing-emphasized-decelerate) both',
                }}
              >
                {PLATFORMS.map((p) => (
                  <span
                    key={p.name}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-label-sm font-semibold ${p.bg}`}
                  >
                    <p.Icon className="h-3.5 w-3.5" />
                    {p.name}
                  </span>
                ))}
              </div>

              {/* Primary CTA pair */}
              <div
                className="flex flex-wrap items-center gap-3"
                style={{
                  animation:
                    'fade-in-down 500ms 400ms var(--easing-emphasized-decelerate) both',
                }}
              >
                {isAuthenticated ? (
                  <Button
                    as={Link}
                    to={ROUTES.DASHBOARD.ROOT}
                    variant="filled"
                    color="primary"
                    size="lg"
                    leftIcon={<LayoutDashboard className="h-4 w-4" />}
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
                    >
                      Get Started Free
                    </Button>
                    <Button
                      as={Link}
                      to={ROUTES.LOGIN}
                      variant="outline"
                      color="primary"
                      size="lg"
                    >
                      Sign In
                    </Button>
                  </>
                )}
              </div>
            </div>

            {/* ── Right: fake dashboard widget ──────────────────────────── */}
            <div
              className="hidden lg:block"
              style={{
                animation:
                  'fade-in-down 600ms 200ms var(--easing-emphasized-decelerate) both',
              }}
            >
              {/* Terminal-chrome wrapper */}
              <div className="rounded-2xl overflow-hidden border border-outline-variant/60 bg-surface shadow-elevation-3">
                {/* Chrome bar */}
                <div className="flex items-center gap-3 border-b border-outline-variant/60 bg-surface-container-low px-4 py-3">
                  <div className="flex gap-1.5">
                    <span className="h-3 w-3 rounded-full bg-[#FF5F56]" />
                    <span className="h-3 w-3 rounded-full bg-[#FFBD2E]" />
                    <span className="h-3 w-3 rounded-full bg-[#27C93F]" />
                  </div>
                  <span className="ml-1 font-mono text-label-sm text-on-surface-variant/70 select-none">
                    cat-bot — bot manager
                  </span>
                </div>

                {/* Bot session list */}
                <div className="flex flex-col gap-0 p-4">
                  <p className="mb-3 text-label-xs font-semibold text-on-surface-variant/60 uppercase tracking-widest">
                    Active Sessions
                  </p>
                  {PLATFORMS.map((p) => (
                    <div
                      key={p.name}
                      className="flex items-center justify-between py-2.5 px-1 border-b border-outline-variant/20 last:border-b-0"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${p.bg}`}
                        >
                          <p.Icon className="h-4 w-4" />
                        </span>
                        <div>
                          <p className="text-label-md font-semibold text-on-surface">
                            {p.name === 'Chat Room' ? 'Chat Room' : `${p.name} Bot`}
                          </p>
                          <p className="text-label-sm text-on-surface-variant font-mono opacity-70">
                            {p.name === 'Chat Room' ? 'built-in test console' : 'prefix: /'}
                          </p>
                        </div>
                      </div>
                      <span className="inline-flex items-center gap-1.5 text-label-sm text-success font-medium">
                        <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                        Online
                      </span>
                    </div>
                  ))}

                  {/* Fake log line for texture */}
                  <div className="mt-3 px-1 py-1.5 font-mono text-label-xs text-on-surface-variant/50">
                    <span className="text-success/70">✓</span> All sessions running normally
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section className="py-24 px-6 border-y border-outline-variant/60 relative overflow-hidden">
        {/* Subtle section background */}
        <div className="absolute inset-0 bg-surface-container-low/40 pointer-events-none" />

        <div className="relative max-w-6xl mx-auto flex flex-col gap-14">
          <div className="flex flex-col gap-3 text-center">
            <p className="text-label-sm font-semibold text-primary uppercase tracking-widest">
              Capabilities
            </p>
            <h2 className="font-brand text-headline-md font-bold text-on-surface tracking-tight">
              Everything you need to run bots at scale
            </h2>
            <p className="text-body-lg text-on-surface-variant max-w-xl mx-auto leading-relaxed">
              Built for developers and operators who want one framework for
              every major chat platform — without compromises.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="group flex flex-col gap-4 rounded-2xl border border-outline-variant/60 bg-surface p-6 shadow-elevation-1 transition-all duration-normal hover:shadow-elevation-2 hover:border-outline-variant cursor-default"
              >
                <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-container text-on-primary-container group-hover:scale-110 transition-transform duration-fast">
                  <f.Icon className="h-5 w-5" />
                </span>
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-title-md font-semibold text-on-surface tracking-tight">
                    {f.title}
                  </h3>
                  <p className="text-body-sm text-on-surface-variant leading-relaxed">
                    {f.description}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Bottom CTA ────────────────────────────────────────────────────── */}
      <section className="py-24 px-6 relative overflow-hidden">
        {/* Ambient glow */}
        <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[400px] w-[600px] rounded-full bg-primary/[0.05] blur-[80px]" />

        <div className="relative max-w-2xl mx-auto flex flex-col items-center gap-6 text-center">
          <p className="text-label-sm font-semibold text-primary uppercase tracking-widest">
            Get Started
          </p>
          <h2 className="font-brand text-headline-md font-bold text-on-surface tracking-tight">
            Ready to deploy your first bot?
          </h2>
          <p className="text-body-lg text-on-surface-variant max-w-md leading-relaxed">
            Create your account and go from zero to a live multi-platform bot
            session in minutes.
          </p>
          {isAuthenticated ? (
            <Button
              as={Link}
              to={ROUTES.DASHBOARD.ROOT}
              variant="filled"
              color="primary"
              size="lg"
              leftIcon={<LayoutDashboard className="h-4 w-4" />}
            >
              Go to Dashboard
            </Button>
          ) : (
            <div className="flex flex-col sm:flex-row items-center gap-3">
              <Button
                as={Link}
                to={ROUTES.SIGNUP}
                variant="filled"
                color="primary"
                size="lg"
                rightIcon={<ArrowRight className="h-4 w-4" />}
              >
                Create Free Account
              </Button>
              <Button
                as={Link}
                to={ROUTES.LOGIN}
                variant="text"
                color="primary"
                size="lg"
                rightIcon={<ChevronRight className="h-4 w-4" />}
              >
                Sign in instead
              </Button>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
