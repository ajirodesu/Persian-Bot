import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import Input from '@/components/ui/forms/Input'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import apiClient from '@/lib/api-client.lib'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'
import { useFormDraft } from '@/hooks/useFormDraft'
import AuthPanel, {
  AuthField,
  AuthForm,
  AuthResult,
} from '@/components/layout/AuthPanel'

// Verified against the server OTP store: 6-digit code, 10-minute TTL.
// (packages/cat-bot/src/server/lib/otp.lib.ts:29-30)
const META = [
  { label: 'CHANNEL', value: 'EMAIL' },
  { label: 'CODE', value: '6 DIGITS' },
  { label: 'EXPIRY', value: '10 MINUTES' },
]

const FOOTER_LINK =
  'font-mono text-[11px] uppercase tracking-[0.08em] text-primary hover:underline underline-offset-4'

const ACTION_LINK =
  'inline-flex min-h-11 items-center font-mono text-[11px] uppercase tracking-[0.08em] text-primary hover:underline underline-offset-4'

export default function ForgotPasswordPage() {
  const { isEmailEnabled, isLoading: isEmailStatusLoading } =
    useEmailServiceEnabled()

  const [searchParams] = useSearchParams()
  // Step + email + validation error survive reloads; this is a recovery flow,
  // not a one-shot. No secret is stored by this form.
  const draft = useFormDraft(
    {
      email: searchParams.get('email') || '',
      error: null as string | null,
      isSubmitted: false,
    },
    { key: 'forgot-password', storage: 'local', sensitive: [] },
  )
  const { email, error, isSubmitted } = draft.values
  const isLoadingRef = useRef(false)
  const [isLoading, setIsLoading] = React.useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (isLoadingRef.current) return
    if (!email) {
      draft.setValues((prev) => ({ ...prev, error: 'Email is required.' }))
      return
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      draft.setValues((prev) => ({
        ...prev,
        error: 'Enter a valid email address.',
      }))
      return
    }

    isLoadingRef.current = true
    draft.setValues((prev) => ({ ...prev, error: null }))
    setIsLoading(true)

    try {
      const check = await apiClient.post<{ valid: boolean; error?: string }>(
        '/api/v1/validate/email-reset',
        { email, adminOnly: false },
      )
      if (!check.data.valid) {
        draft.setValues((prev) => ({
          ...prev,
          error: check.data.error ?? 'No account found with this email address.',
        }))
        isLoadingRef.current = false
        setIsLoading(false)
        return
      }
    } catch {
      // Fall through
    }

    try {
      await apiClient.post('/api/v1/validate/reset-password/request', {
        email,
        adminOnly: false,
      })
      draft.setValues((prev) => ({ ...prev, isSubmitted: true, error: null }))
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      draft.setValues((prev) => ({
        ...prev,
        error: e.response?.data?.error || 'Failed to send reset code.',
      }))
    } finally {
      isLoadingRef.current = false
      setIsLoading(false)
    }
  }

  let content: React.ReactNode

  if (isEmailStatusLoading) {
    content = (
      <div className="border-t border-hairline">
        <div className="flex flex-col gap-2 border-b border-hairline py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
            CHECKING ACCOUNT STATUS
          </p>
          <p className="animate-pulse font-mono text-[11px] uppercase tracking-[0.08em] text-on-surface-variant/80">
            Preparing the email service…
          </p>
        </div>
      </div>
    )
  } else if (!isEmailEnabled) {
    content = (
      <div className="border-t border-hairline">
        <div className="flex flex-col gap-4 border-b border-hairline py-5">
          <Alert
            variant="outlined"
            color="warning"
            title="Email service disabled"
            message="Please contact your administrator to reset your password."
          />
          <Link to={ROUTES.LOGIN} className={ACTION_LINK}>
            Back to log in
          </Link>
        </div>
      </div>
    )
  } else if (isSubmitted) {
    content = (
      <AuthResult
        tone="success"
        title="Check your inbox"
        description={`We sent a 6-digit code to ${email}. Enter it on the next screen to reset your password.`}
        action={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              as={Link}
              to={`${ROUTES.RESET_PASSWORD}?email=${encodeURIComponent(email)}`}
              variant="filled"
              color="primary"
              size="lg"
              className="h-11 rounded-[var(--radius-button)] font-mono text-[11px] uppercase tracking-[0.1em] sm:w-auto sm:min-w-[13rem]"
            >
              Enter the code
            </Button>
            <Link to={ROUTES.LOGIN} className={ACTION_LINK}>
              Back to log in
            </Link>
          </div>
        }
      />
    )
  } else {
    content = (
      <AuthForm onSubmit={handleSubmit}>
        <AuthField
          label="Email address"
          error={error ?? undefined}
          required
        >
          <Input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              const value = e.target.value
              draft.setValues((prev) => ({ ...prev, email: value, error: null }))
            }}
            autoComplete="email"
            className="h-11"
          />
        </AuthField>

        <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-5 border-b border-hairline">
          <Button
            type="submit"
            variant="filled"
            color="primary"
            size="lg"
            isLoading={isLoading}
            fullWidth
            className="h-11 rounded-[var(--radius-button)] font-mono text-[11px] uppercase tracking-[0.1em] sm:w-auto sm:min-w-[13rem]"
          >
            Send reset code
          </Button>
        </div>
      </AuthForm>
    )
  }

  return (
    <>
      <Helmet>
        <title>Forgot Password · Cat-Bot</title>
      </Helmet>

      <AuthPanel
        index="02"
        kicker="RECOVERY"
        title="Reset access"
        description="Enter the address on your account and we will send a reset code."
        meta={META}
        footer={
          !isSubmitted ? (
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
                REMEMBERED IT
              </span>
              <Link to={ROUTES.LOGIN} className={FOOTER_LINK}>
                Back to sign in
              </Link>
            </div>
          ) : undefined
        }
      >
        {content}
      </AuthPanel>
    </>
  )
}
