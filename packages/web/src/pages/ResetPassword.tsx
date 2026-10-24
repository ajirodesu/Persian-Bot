import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import CodeInput from '@/components/ui/forms/CodeInput'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import apiClient from '@/lib/api-client.lib'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useCountdownSeconds } from '@/hooks/useCountdown'
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

const SUBMIT_CLASS =
  'h-11 rounded-[var(--radius-button)] font-mono text-[11px] uppercase tracking-[0.1em] sm:w-auto sm:min-w-[13rem]'

const SUBMIT_ROW =
  'flex flex-col sm:flex-row sm:items-center gap-3 py-5 border-b border-hairline'

export default function ResetPasswordPage() {
  const { isEmailEnabled, isLoading: isEmailStatusLoading } =
    useEmailServiceEnabled()

  const [searchParams] = useSearchParams()
  // Recovery progress that is safe to keep: the address, the resend cooldown
  // deadline, and nothing else. The OTP and both password fields stay in
  // memory only — a discarded tab means re-entering the code, never a secret
  // left behind in storage.
  const draft = useFormDraft(
    {
      email: searchParams.get('email')?.trim() ?? '',
      resendDeadline: null as number | null,
    },
    { key: 'reset-password', storage: 'local', sensitive: [] },
  )
  const email = searchParams.get('email')?.trim() || draft.values.email
  const resendCooldown = useCountdownSeconds(draft.values.resendDeadline)
  const submitLock = useRef(false)

  const [code, setCode] = useState('')
  const [codeVerified, setCodeVerified] = useState(false)
  const [isVerifyingCode, setIsVerifyingCode] = useState(false)
  const [codeError, setCodeError] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<{
    password?: string
    confirmPassword?: string
  }>({})
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const [isResending, setIsResending] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)
  const [resendError, setResendError] = useState<string | null>(null)

  const handleVerifyCode = async (submittedCode = code) => {
    if (!email || submittedCode.length !== 6) return
    setIsVerifyingCode(true)
    setCodeError(null)

    try {
      const result = await apiClient.post<{ valid: boolean }>(
        '/api/v1/validate/reset-password/verify-code',
        { email, code: submittedCode, adminOnly: false },
      )
      if (result.data.valid) {
        setCodeVerified(true)
      } else {
        setCodeError('Invalid or expired code. Request a new one and try again.')
        setCode('')
      }
    } catch {
      setCodeError('Failed to verify the code. Please try again.')
    } finally {
      setIsVerifyingCode(false)
    }
  }

  const validate = () => {
    const newErrors: typeof errors = {}
    if (!password) {
      newErrors.password = 'Password is required.'
    } else if (password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters.'
    }
    if (!confirmPassword) {
      newErrors.confirmPassword = 'Confirmation is required.'
    } else if (password !== confirmPassword) {
      newErrors.confirmPassword = 'Passwords do not match.'
    }
    return newErrors
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitLock.current) return
    const fieldErrors = validate()
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }

    submitLock.current = true
    setErrors({})
    setIsLoading(true)

    try {
      await apiClient.post('/api/v1/validate/reset-password/confirm', {
        email,
        code,
        password,
        adminOnly: false,
      })
      setIsSubmitted(true)
      // The flow is complete: the draft has served its purpose.
      draft.clearDraft()
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setErrors({
        password: e.response?.data?.error || 'Failed to reset password.',
      })
    } finally {
      submitLock.current = false
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    if (!email || resendCooldown > 0) return
    setIsResending(true)
    setResendError(null)

    try {
      await apiClient.post('/api/v1/validate/reset-password/request', {
        email,
        adminOnly: false,
      })
      setResendSuccess(true)
      // Timestamp, not a counter: correct after the tab sleeps.
      draft.setValues((prev) => ({
        ...prev,
        email,
        resendDeadline: Date.now() + 60_000,
      }))
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setResendError(e.response?.data?.error || 'Failed to resend reset code.')
    } finally {
      setIsResending(false)
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
            message="Password reset by email is not available right now."
          />
          <Link
            to={ROUTES.LOGIN}
            className="inline-flex min-h-11 items-center font-mono text-[11px] uppercase tracking-[0.08em] text-primary hover:underline underline-offset-4"
          >
            Back to log in
          </Link>
        </div>
      </div>
    )
  } else if (!email) {
    content = (
      <div className="border-t border-hairline">
        <div className="flex flex-col gap-4 border-b border-hairline py-5">
          <Alert
            variant="outlined"
            color={resendSuccess ? 'success' : 'info'}
            title={resendSuccess ? 'Code sent' : 'Email required'}
            message={
              resendSuccess
                ? 'Check your inbox and continue on the "Enter the code" screen.'
                : 'Please request a reset code from the forgot-password page.'
            }
          />
          {resendError && (
            <Alert
              variant="outlined"
              color="error"
              title="Resend failed"
              message={resendError}
              size="sm"
            />
          )}
          <Button
            as={Link}
            to={ROUTES.FORGOT_PASSWORD}
            variant="filled"
            color="primary"
            size="lg"
            className={SUBMIT_CLASS}
          >
            Request reset code
          </Button>
        </div>
      </div>
    )
  } else if (isSubmitted) {
    content = (
      <AuthResult
        tone="success"
        title="Password updated"
        description="You can now log in with your new password."
        action={
          <Button
            onClick={() => {
              window.location.href = ROUTES.LOGIN
            }}
            variant="filled"
            color="primary"
            size="lg"
            className={SUBMIT_CLASS}
          >
            Go to log in
          </Button>
        }
      />
    )
  } else if (!codeVerified) {
    content = (
      <div className="border-t border-hairline">
        {resendSuccess && (
          <div className="pt-5">
            <Alert
              variant="outlined"
              color="success"
              title="New code sent"
              message="Check your inbox for the latest code."
              size="sm"
            />
          </div>
        )}
        {resendError && (
          <div className="pt-5">
            <Alert
              variant="outlined"
              color="error"
              title="Resend failed"
              message={resendError}
              size="sm"
            />
          </div>
        )}
        {codeError && (
          <div className="pt-5">
            <Alert
              variant="outlined"
              color="error"
              title="Verification failed"
              message={codeError}
            />
          </div>
        )}

        <AuthField label="Verification code" error={codeError ?? undefined}>
          <CodeInput
            value={code}
            onChange={(next) => {
              setCode(next)
              setCodeError(null)
              setResendError(null)
            }}
            onComplete={handleVerifyCode}
            placeholder="000000"
            autoFocus
            className="h-11"
          />
        </AuthField>

        <div className={SUBMIT_ROW}>
          <Button
            onClick={() => void handleVerifyCode()}
            variant="filled"
            color="primary"
            size="lg"
            isLoading={isVerifyingCode}
            disabled={code.length !== 6}
            className={SUBMIT_CLASS}
          >
            Continue
          </Button>
          <Button
            onClick={() => void handleResend()}
            variant="text"
            color="neutral"
            size="md"
            isLoading={isResending}
            disabled={resendCooldown > 0}
            className="font-mono text-[11px] uppercase tracking-[0.08em]"
          >
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
          </Button>
        </div>
      </div>
    )
  } else {
    content = (
      <AuthForm onSubmit={handleSubmit}>
        <AuthField
          label="New password"
          error={errors.password}
          required
          hint="At least 8 characters"
        >
          <PasswordInput
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setErrors((prev) => ({ ...prev, password: undefined }))
            }}
            className="h-11"
          />
        </AuthField>

        <AuthField
          label="Confirm new password"
          error={errors.confirmPassword}
          required
        >
          <PasswordInput
            placeholder="Repeat your new password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              setErrors((prev) => ({
                ...prev,
                confirmPassword: undefined,
              }))
            }}
            className="h-11"
          />
        </AuthField>

        <div className={SUBMIT_ROW}>
          <Button
            type="submit"
            variant="filled"
            color="primary"
            size="lg"
            isLoading={isLoading}
            className={SUBMIT_CLASS}
          >
            Reset password
          </Button>
        </div>
      </AuthForm>
    )
  }

  return (
    <>
      <Helmet>
        <title>Set New Password · Cat-Bot</title>
      </Helmet>

      <AuthPanel
        index="02"
        kicker="RECOVERY"
        title="Set a new password"
        description="Choose a new password for your account."
        meta={META}
        footer={
          !isSubmitted ? (
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
                NEED HELP
              </span>
              <span className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <Link to={ROUTES.FORGOT_PASSWORD} className={FOOTER_LINK}>
                  Request a new code
                </Link>
                <Link to={ROUTES.LOGIN} className={FOOTER_LINK}>
                  Back to sign in
                </Link>
              </span>
            </div>
          ) : undefined
        }
      >
        {content}
      </AuthPanel>
    </>
  )
}
