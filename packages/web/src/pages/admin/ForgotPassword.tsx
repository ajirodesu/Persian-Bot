import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import Input from '@/components/ui/forms/Input'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import apiClient from '@/lib/api-client.lib'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'
import AuthPanel, {
  AuthField,
  AuthForm,
  AuthResult,
} from '@/components/layout/AuthPanel'

// Verified against the server OTP store: 6-digit code, 10-minute TTL.
// (packages/cat-bot/src/server/lib/otp.lib.ts:29-30)
const META = [
  { label: 'SCOPE', value: 'ADMIN' },
  { label: 'CODE', value: '6 DIGITS' },
  { label: 'EXPIRY', value: '10 MINUTES' },
]

const FOOTER_LINK =
  'font-mono text-[11px] uppercase tracking-[0.08em] text-primary hover:underline underline-offset-4'

const SUBMIT_CLASS =
  'h-11 rounded-[var(--radius-button)] font-mono text-[11px] uppercase tracking-[0.1em] sm:w-auto sm:min-w-[13rem]'

export default function AdminForgotPasswordPage() {
  const { isEmailEnabled, isLoading: isEmailStatusLoading } =
    useEmailServiceEnabled()

  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email) {
      setError('Admin email is required.')
      return
    }
    if (!/\S+@\S+\.\S+/.test(email)) {
      setError('Enter a valid email address.')
      return
    }

    setError(null)
    setIsLoading(true)

    try {
      const check = await apiClient.post<{ valid: boolean; error?: string }>(
        '/api/v1/validate/email-reset',
        { email, adminOnly: true },
      )
      if (!check.data.valid) {
        setError(
          check.data.error ?? 'No admin account found with this email address.',
        )
        setIsLoading(false)
        return
      }
    } catch {
      // Fall through
    }

    try {
      await apiClient.post('/api/v1/validate/reset-password/request', {
        email,
        adminOnly: true,
      })
      setIsSubmitted(true)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setError(e.response?.data?.error || 'Failed to send reset code.')
    } finally {
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
            Checking account status…
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
            title="Feature Unavailable"
            message="Email services are not enabled on this instance."
          />
        </div>
      </div>
    )
  } else if (isSubmitted) {
    content = (
      <AuthResult
        tone="success"
        title="Code sent"
        description={`A 6-digit reset code has been sent to ${email} if an admin account exists.`}
        action={
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <Button
              as={Link}
              to={`${ROUTES.ADMIN.RESET_PASSWORD}?email=${encodeURIComponent(email)}`}
              variant="filled"
              color="primary"
              size="lg"
              className={SUBMIT_CLASS}
            >
              Enter the code
            </Button>
            <Link to={ROUTES.ADMIN.ROOT} className={FOOTER_LINK}>
              Return to admin login
            </Link>
          </div>
        }
      />
    )
  } else {
    content = (
      <AuthForm onSubmit={handleSubmit}>
        <AuthField
          label="Admin email"
          error={error ?? undefined}
          required
        >
          <Input
            type="email"
            placeholder="admin@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError(null)
            }}
            autoComplete="email"
            className="h-11 font-mono"
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
            className={SUBMIT_CLASS}
          >
            Send secure code
          </Button>
        </div>
      </AuthForm>
    )
  }

  return (
    <>
      <Helmet>
        <title>Admin Recovery · Cat-Bot</title>
      </Helmet>

      <AuthPanel
        variant="admin"
        index="02"
        kicker="ADMIN RECOVERY"
        title="Reset admin access"
        description="Request a secure 6-digit code for your admin account."
        meta={META}
        footer={
          !isSubmitted ? (
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
                ADMIN ACCESS
              </span>
              <Link to={ROUTES.ADMIN.ROOT} className={FOOTER_LINK}>
                Cancel and return to login
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
