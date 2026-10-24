import React from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Check, Info, type LucideIcon } from 'lucide-react'
import Logo from '@/components/ui/Logo'
import { Field } from '@/components/ui/forms/Field'
import { H_HEIGHT } from '@/constants/header.constants'
import { ROUTES } from '@/constants/routes.constants'
import { cn } from '@/utils/cn.util'

/**
 * AuthPanel — one document layout shared by every authentication surface.
 *
 * The screen reads as a printed form you fill in, not a card floating in space:
 * a numbered section header and a metadata ledger on the left, a hairline-ruled
 * field table on the right. No fills, no shadows, no decorative marks. The
 * admin variant supplies its own masthead and colophon because those routes
 * render outside the public shell.
 */
export type AuthPanelProps = {
  /** Two-digit section index, e.g. '01' */
  index: string
  /** Section kicker, e.g. 'ACCESS' — rendered uppercase by .rule-label */
  kicker: string
  /** Condensed uppercase page title */
  title: string
  /** One factual sentence, max ~120 chars */
  description: string
  /** Document metadata rows, shown on lg+ only */
  meta?: Array<{ label: string; value: string }>
  /** 'public' renders inside the existing public shell; 'admin' renders its own chrome */
  variant?: 'public' | 'admin'
  children: React.ReactNode
  /** Bottom row: cross-links, back links */
  footer?: React.ReactNode
}

const MONO_STRIP =
  'font-mono text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/80'

export default function AuthPanel({
  index,
  kicker,
  title,
  description,
  meta,
  variant = 'public',
  children,
  footer,
}: AuthPanelProps) {
  const isAdmin = variant === 'admin'

  return (
    <div
      className={cn(
        'bg-surface text-on-surface',
        isAdmin && 'min-h-dvh flex flex-col',
      )}
    >
      {isAdmin && (
        <div className="border-b border-hairline">
          <div
            className={cn(
              'max-w-[var(--layout-nav-max)] mx-auto px-[var(--layout-section-px)] flex items-center justify-between gap-3',
              H_HEIGHT,
            )}
          >
            <div className="flex min-w-0 items-center gap-3">
              <Link
                to={ROUTES.HOME}
                aria-label="Cat-Bot home"
                className="flex items-center gap-2 text-primary transition-opacity duration-fast hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Logo className="h-5 w-5 text-primary" />
                <span className="font-brand text-[15px] uppercase tracking-[0.16em] text-on-surface">
                  CAT-BOT
                </span>
              </Link>
              <span
                aria-hidden="true"
                className="h-3 w-px shrink-0 bg-hairline"
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-on-surface-variant/85">
                ADMIN
              </span>
            </div>

            <span className={MONO_STRIP}>RESTRICTED ACCESS</span>
          </div>
        </div>
      )}

      <div className="flex-1 w-full max-w-[var(--layout-nav-max)] mx-auto px-[var(--layout-section-px)] py-10 md:py-16">
        <div className="grid lg:grid-cols-12 gap-0">
          <header className="lg:col-span-5 pb-8 border-b border-hairline lg:pb-0 lg:border-b-0 lg:border-r lg:pr-10">
            <p className="rule-label max-w-[15rem]">
              {index} / {kicker}
            </p>

            <h1 className="font-brand uppercase text-display-sm text-on-surface mt-6">
              {title}
            </h1>

            <p className="text-body-md text-on-surface-variant mt-4 max-w-[38ch]">
              {description}
            </p>

            {meta && meta.length > 0 && (
              <dl className="mt-10 hidden lg:block border-t border-hairline">
                {meta.map((row) => (
                  <div
                    key={row.label}
                    className="flex items-baseline justify-between gap-4 border-b border-hairline py-3"
                  >
                    <dt className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
                      {row.label}
                    </dt>
                    <dd className="font-mono text-[10px] uppercase tracking-[0.1em] text-on-surface text-right">
                      {row.value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </header>

          <div className="lg:col-span-7 pt-8 lg:pt-0 lg:pl-10 min-w-0">
            {children}

            {footer && (
              <div className="mt-8 border-t border-hairline pt-4">{footer}</div>
            )}
          </div>
        </div>
      </div>

      {isAdmin && (
        <div className="border-t border-hairline">
          <div className="max-w-[var(--layout-nav-max)] mx-auto px-[var(--layout-section-px)] py-4 flex items-center justify-between gap-3">
            <span className={MONO_STRIP}>CAT-BOT / ADMIN CONSOLE</span>
            <span className={cn(MONO_STRIP, 'text-right')}>
              ONLY AUTHORISED OPERATORS
            </span>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * AuthForm — the ruled field table. The top rule belongs to the table; each
 * child row owns its own bottom rule, so no `divide-*` utilities are needed.
 */
export function AuthForm({
  onSubmit,
  children,
  className,
}: {
  onSubmit: React.FormEventHandler<HTMLFormElement>
  children: React.ReactNode
  className?: string
}) {
  return (
    <form
      onSubmit={onSubmit}
      noValidate
      className={cn('border-t border-hairline', className)}
    >
      {children}
    </form>
  )
}

/**
 * AuthField — one row of the printed form: a mono label in the left gutter,
 * the control in the right column, a hairline underneath.
 */
export function AuthField({
  label,
  error,
  required,
  hint,
  action,
  children,
}: {
  label: string
  error?: string
  required?: boolean
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Field.Root
      invalid={Boolean(error)}
      required={required}
      className="grid gap-1.5 border-b border-hairline py-5 sm:grid-cols-[9.5rem_minmax(0,1fr)] sm:items-start sm:gap-x-6 sm:gap-y-0"
    >
      <div className="flex items-baseline justify-between gap-2 sm:block sm:pt-2.5">
        <Field.Label className="mb-0">{label}</Field.Label>
        {action}
      </div>

      <div className="min-w-0 sm:col-start-2">
        {children}
        {hint && !error && (
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-on-surface-variant/80">
            {hint}
          </p>
        )}
        {error && <Field.ErrorText>{error}</Field.ErrorText>}
      </div>
    </Field.Root>
  )
}

type AuthResultTone = 'success' | 'error' | 'info'

const RESULT_TONES: Record<
  AuthResultTone,
  { label: string; text: string; Icon: LucideIcon }
> = {
  success: { label: 'SUCCESS', text: 'text-success', Icon: Check },
  error: { label: 'ERROR', text: 'text-error', Icon: AlertTriangle },
  info: { label: 'NOTICE', text: 'text-info', Icon: Info },
}

/**
 * AuthResult — terminal state of a flow (sent, verified, updated, failed).
 * A bordered printout block with a tone stamp, never a filled banner.
 */
export function AuthResult({
  tone = 'success',
  title,
  description,
  action,
}: {
  tone?: AuthResultTone
  title: string
  description: string
  action?: React.ReactNode
}) {
  const { label, text, Icon } = RESULT_TONES[tone]

  return (
    <div className="border border-hairline rounded-[var(--radius-card)] bg-surface-container-low p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="h-8 w-8 rounded-[var(--radius-compact)] border border-hairline bg-surface-container-high flex items-center justify-center">
          <Icon className={cn('h-4 w-4', text)} aria-hidden="true" />
        </span>
        <span
          className={cn(
            'font-mono text-[10px] uppercase tracking-[0.18em]',
            text,
          )}
        >
          {label}
        </span>
      </div>

      <h2 className="font-brand uppercase text-headline-sm mt-4 text-on-surface">
        {title}
      </h2>

      <p className="text-body-sm text-on-surface-variant mt-2">{description}</p>

      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
