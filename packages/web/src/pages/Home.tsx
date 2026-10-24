import { Helmet } from '@dr.pogodin/react-helmet'
import { Link } from 'react-router-dom'
import {
  ArrowRight,
  ArrowUpRight,
  Bot,
  Globe,
  Lock,
  MessageSquare,
  Power,
  Terminal,
} from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import { H_SHELL_SCOPE } from '@/constants/header.constants'
import { ROUTES } from '@/constants/routes.constants'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { cn } from '@/utils/cn.util'

// ── Static sheet data ───────────────────────────────────────────────────────
// Every product claim below is traceable in this repo: dashboard surfaces
// (DashboardLayout nav), platform adapters (platform.constants), and the
// Create New Bot wizard (pages/dashboard/create-new-bot.tsx).

const FACTS = [
  { label: 'RUNTIME', value: 'Node.js' },
  { label: 'ADAPTERS', value: '02' },
  { label: 'SOURCE', value: 'Open source' },
] as const

const SURFACES = [
  { name: 'Bot Manager', detail: 'session list and lifecycle' },
  { name: 'Chat Room', detail: 'in-dashboard test console' },
  { name: 'Commands', detail: 'per-session command registry' },
  { name: 'Events', detail: 'event registry and toggles' },
  { name: 'Database', detail: 'table browser' },
] as const

const CAPABILITIES = [
  {
    Icon: Globe,
    title: 'Multi-platform',
    description:
      'One codebase, two adapters: Discord and Telegram. No per-platform rewrite.',
  },
  {
    Icon: Bot,
    title: 'Multi-bot',
    description:
      'Independent sessions, each with its own token, prefix, and admin roster.',
  },
  {
    Icon: Power,
    title: 'Live control',
    description:
      'Start, stop, and hot-restart a session without redeploying the server.',
  },
  {
    Icon: Terminal,
    title: 'Command registry',
    description:
      'Enable or disable commands per session from the dashboard, without editing bot code.',
  },
  {
    Icon: MessageSquare,
    title: 'Chat Room',
    description:
      'A real-time test console with replies, attachments, and inline keyboards — no external platform required.',
  },
] as const

const STEPS = [
  {
    title: 'Create an account',
    body: 'Sign up, then confirm your email address when prompted.',
  },
  {
    title: 'Add a platform token',
    body: 'Use the Create New Bot wizard to set a nickname, prefix, platform token, and admin IDs.',
  },
  {
    title: 'Start the session',
    body: 'Launch it from the Bot Manager and watch the live feed in its console.',
  },
] as const

// ── Primary action — shared by the hero and the closing section ─────────────

function PrimaryAction({ authenticated }: { authenticated: boolean }) {
  return (
    <Button
      as={Link}
      to={authenticated ? ROUTES.DASHBOARD.ROOT : ROUTES.SIGNUP}
      variant="filled"
      color="primary"
      size="lg"
      rightIcon={
        <ArrowRight
          aria-hidden="true"
          strokeWidth={1.75}
          className="h-3.5 w-3.5"
        />
      }
      className="rounded-[var(--radius-button)] font-mono text-label-md uppercase tracking-[0.1em]"
    >
      {authenticated ? 'Open dashboard' : 'Create an account'}
    </Button>
  )
}

// ── Page — telemetry printout ───────────────────────────────────────────────

export default function HomePage() {
  const { isAuthenticated } = useUserAuth()

  return (
    <>
      <Helmet>
        <title>Cat-Bot — multi-platform bot operations</title>
        <meta
          name="description"
          content="Run Discord and Telegram bot sessions from one dashboard. Open source."
        />
        <meta
          property="og:title"
          content="Cat-Bot — multi-platform bot operations"
        />
        <meta
          property="og:description"
          content="Run Discord and Telegram bot sessions from one dashboard. Open source."
        />
        <meta name="theme-color" content="#0F1112" />
      </Helmet>

      <div className="bg-surface">
        {/* ── Document masthead ──────────────────────────────────────────── */}
        <div className="border-b border-hairline">
          <div className="mx-auto flex w-full max-w-[var(--layout-nav-max)] items-center justify-between gap-4 px-[var(--layout-section-px)] py-2.5 md:grid md:grid-cols-3">
            <span className={H_SHELL_SCOPE}>CAT-BOT / OPERATIONS MANUAL</span>
            <span
              className={cn(
                H_SHELL_SCOPE,
                'hidden md:inline md:justify-self-center',
              )}
            >
              DISCORD · TELEGRAM
            </span>
            <span className={cn(H_SHELL_SCOPE, 'md:justify-self-end')}>
              REV 01
            </span>
          </div>
        </div>

        {/* ── 01 / Control surface ───────────────────────────────────────── */}
        <section
          aria-labelledby="hero-title"
          className="border-b border-hairline"
        >
          <div className="mx-auto w-full max-w-[var(--layout-nav-max)] px-[var(--layout-section-px)] py-12 md:py-20">
            <div className="grid gap-10 lg:grid-cols-12 lg:gap-12">
              <div className="lg:col-span-7">
                <div className="rule-label max-w-[16rem]">
                  01 / CONTROL SURFACE
                </div>

                <div className="[animation:fade-in-up_420ms_var(--easing-emphasized-decelerate)_both]">
                  <h1
                    id="hero-title"
                    className="mt-6 max-w-[18ch] break-words font-brand text-display-lg uppercase text-on-surface"
                  >
                    Every bot session.
                    <br />
                    One sheet.
                  </h1>

                  <p className="mt-5 max-w-[52ch] text-body-lg text-on-surface-variant">
                    Cat-Bot runs Discord and Telegram bots from a single
                    Node.js process. Start, stop, inspect, and message
                    any session from one dashboard.
                  </p>

                  <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-center">
                    <PrimaryAction authenticated={isAuthenticated} />
                    {!isAuthenticated && (
                      <Link
                        to={ROUTES.LOGIN}
                        className="self-start font-mono text-label-md uppercase tracking-[0.1em] text-on-surface-variant underline decoration-hairline underline-offset-4 hover:text-on-surface hover:decoration-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-surface sm:self-auto"
                      >
                        Sign in
                      </Link>
                    )}
                  </div>
                </div>

                <dl className="mt-8 grid max-w-md grid-cols-3 border-t border-hairline">
                  {FACTS.map((fact) => (
                    <div key={fact.label} className="min-w-0 pt-3 pr-4">
                      <dt className="font-mono text-label-sm uppercase tracking-[0.18em] text-on-surface-variant/80">
                        {fact.label}
                      </dt>
                      <dd className="mt-1 break-words font-brand text-headline-sm uppercase text-on-surface">
                        {fact.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Surface index — reference only, all rows require a session */}
              <div className="lg:col-span-5 lg:border-l lg:border-hairline lg:pl-8">
                <div className="rule-label">SURFACE INDEX</div>

                <ul className="mt-4 border-t border-hairline">
                  {SURFACES.map((surface, index) => (
                    <li
                      key={surface.name}
                      className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 border-b border-hairline py-3 last:border-b-0"
                    >
                      <span
                        aria-hidden="true"
                        className="font-mono text-label-sm tabular-nums text-on-surface-variant/80"
                      >
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0">
                        <span className="block font-brand text-body-md uppercase tracking-[0.06em] text-on-surface">
                          {surface.name}
                        </span>
                        <span className="block font-mono text-label-sm uppercase tracking-[0.06em] text-on-surface-variant/85">
                          {surface.detail}
                        </span>
                      </span>
                      <ArrowUpRight
                        aria-hidden="true"
                        strokeWidth={1.75}
                        className="h-3 w-3 text-on-surface-variant/80"
                      />
                    </li>
                  ))}
                </ul>

                <p className="mt-4 flex items-center gap-2 font-mono text-label-sm uppercase tracking-[0.14em] text-on-surface-variant/80">
                  <Lock
                    aria-hidden="true"
                    strokeWidth={1.75}
                    className="h-3 w-3"
                  />
                  Requires a signed-in session
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── 02 / Capabilities ──────────────────────────────────────────── */}
        <section
          aria-labelledby="capabilities-title"
          className="border-b border-hairline"
        >
          <div className="mx-auto w-full max-w-[var(--layout-nav-max)] px-[var(--layout-section-px)] py-[var(--layout-section-py-lg)]">
            <div className="rule-label">02 / CAPABILITIES</div>

            <h2
              id="capabilities-title"
              className="mt-6 max-w-[24ch] font-brand text-display-sm uppercase text-on-surface"
            >
              One runtime. Three adapters.
            </h2>
            <p className="mt-4 max-w-[60ch] text-body-md text-on-surface-variant">
              Each session owns its credentials, command set, and event stream;
              the dashboard is how you reach them.
            </p>

            <div className="mt-12 border-t border-hairline">
              {CAPABILITIES.map((capability, index) => (
                <article
                  key={capability.title}
                  className="grid grid-cols-[2.5rem_1fr] items-baseline gap-x-6 gap-y-2 border-b border-hairline py-6 md:grid-cols-[4rem_15rem_1fr]"
                >
                  <span
                    aria-hidden="true"
                    className="font-brand text-headline-lg tabular-nums text-on-surface-variant/80"
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>

                  <h3 className="flex items-center gap-2 font-brand text-headline-sm uppercase tracking-[0.06em] text-on-surface">
                    <capability.Icon
                      aria-hidden="true"
                      strokeWidth={1.75}
                      className="h-4 w-4 shrink-0 text-primary"
                    />
                    {capability.title}
                  </h3>

                  <p className="col-start-2 max-w-[68ch] text-body-sm text-on-surface-variant md:col-start-3">
                    {capability.description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── 03 / Sequence ──────────────────────────────────────────────── */}
        <section
          aria-labelledby="sequence-title"
          className="border-b border-hairline"
        >
          <div className="mx-auto w-full max-w-[var(--layout-nav-max)] px-[var(--layout-section-px)] py-[var(--layout-section-py-lg)]">
            <div className="rule-label">03 / SEQUENCE</div>

            <h2
              id="sequence-title"
              className="mt-6 font-brand text-display-sm uppercase text-on-surface"
            >
              From account to first session.
            </h2>

            <ol className="mt-10 grid gap-0 divide-y divide-hairline border-t border-hairline md:grid-cols-3 md:divide-x md:divide-y-0">
              {STEPS.map((step, index) => (
                <li
                  key={step.title}
                  className="py-8 first:md:pl-0 last:md:pr-0 md:px-8 md:py-10"
                >
                  <span
                    aria-hidden="true"
                    className="font-brand text-display-md leading-none text-primary/90"
                  >
                    {String(index + 1).padStart(2, '0')}
                  </span>
                  <h3 className="mt-4 font-brand text-headline-sm uppercase text-on-surface">
                    {step.title}
                  </h3>
                  <p className="mt-2 text-body-sm text-on-surface-variant">
                    {step.body}
                  </p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ── 04 / Start ─────────────────────────────────────────────────── */}
        <section
          aria-labelledby="start-title"
          className="border-b border-hairline bg-surface-container-low"
        >
          <div className="mx-auto grid w-full max-w-[var(--layout-nav-max)] gap-8 px-[var(--layout-section-px)] py-[var(--layout-section-py-lg)] md:grid-cols-12 md:items-end">
            <div className="md:col-span-7">
              <div className="rule-label">04 / START</div>

              <h2
                id="start-title"
                className="mt-6 max-w-[20ch] font-brand text-display-sm uppercase text-on-surface"
              >
                Run your first session.
              </h2>
              <p className="mt-4 max-w-[52ch] text-body-md text-on-surface-variant">
                Create an account, add a platform token, and start a bot from
                the dashboard.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row md:col-span-5 md:justify-end">
              <PrimaryAction authenticated={isAuthenticated} />
              {!isAuthenticated && (
                <Button
                  as={Link}
                  to={ROUTES.LOGIN}
                  variant="outline"
                  color="neutral"
                  size="lg"
                  className="rounded-[var(--radius-button)] font-mono text-label-md uppercase tracking-[0.1em]"
                >
                  Sign in
                </Button>
              )}
            </div>
          </div>
        </section>
      </div>
    </>
  )
}
