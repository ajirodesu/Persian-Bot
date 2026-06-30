import { Helmet } from '@dr.pogodin/react-helmet'
import { Link } from 'react-router-dom'
import { ArrowRight, Zap, Bot, LayoutDashboard, Globe, ChevronRight } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import { ROUTES } from '@/constants/routes.constants'
import { useUserAuth } from '@/contexts/UserAuthContext'

// ── Platform brand icons ────────────────────────────────────────────────────

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

// ── Static data ─────────────────────────────────────────────────────────────

const PLATFORMS = [
  {
    name: 'Discord',
    Icon: DiscordIcon,
    bg: 'bg-[#5865F2]/10 text-[#5865F2] border border-[#5865F2]/20',
  },
  {
    name: 'Telegram',
    Icon: TelegramIcon,
    bg: 'bg-[#26A5E4]/10 text-[#26A5E4] border border-[#26A5E4]/20',
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
                            {p.name} Bot
                          </p>
                          <p className="text-label-sm text-on-surface-variant font-mono opacity-70">
                            prefix: /
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
