import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import CodeInput from '@/components/ui/forms/CodeInput'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import apiClient from '@/lib/api-client.lib'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'
import AuthPanel, {
  AuthField,
  AuthForm,
  AuthResult,
} from '@/components/layout/AuthPanel'

/**
 * Admin Reset Password page — requires the email a reset code was sent to.
 * Flows: (1) enter the 6-digit code, (2) set a new password.
 */

// Verified: 6-digit OTP (otp.lib.ts:29) and the 8-character minimum enforced
// by this page's validate() below.
const META = [
  { label: 'SCOPE', value: 'ADMIN' },
  { label: 'CODE', value: '6 DIGITS' },
  { label: 'PASSWORD', value: 'MIN 08 CHARS' },
]

const FOOTER_LINK =
  'font-mono text-[11px] uppercase tracking-[0.08em] text-primary hover:underline underline-offset-4'

const SUBMIT_CLASS =
  'h-11 rounded-[var(--radius-button)] font-mono text-[11px] uppercase tracking-[0.1em] sm:w-auto sm:min-w-[13rem]'

const SUBMIT_ROW =
  'flex flex-col sm:flex-row sm:items-center gap-3 py-5 border-b border-hairline'

export default function AdminResetPasswordPage() {
  const { isEmailEnabled, isLoading: isEmailStatusLoading } =
    useEmailServiceEnabled()

  const [searchParams] = useSearchParams()
  const email = searchParams.get('email')?.trim() ?? ''

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
        {
          email,
          code: submittedCode,
          adminOnly: true,
        },
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

    const fieldErrors = validate()
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }

    setErrors({})
    setIsLoading(true)

    try {
      await apiClient.post('/api/v1/validate/reset-password/confirm', {
        email,
        code,
        password,
        adminOnly: true,
      })
      setIsSubmitted(true)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setErrors({
        password: e.response?.data?.error || 'Failed to reset password.',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const handleResend = async () => {
    if (!email) return
    setIsResending(true)
    setResendError(null)

    try {
      await apiClient.post('/api/v1/validate/reset-password/request', {
        email,
        adminOnly: true,
      })
      setResendSuccess(true)
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
            title="Disabled"
            message="Email services are disabled on this instance."
          />
        </div>
      </div>
    )
  } else if (!email) {
    content = (
      <div className="border-t border-hairline">
        <div className="flex flex-col gap-4 border-b border-hairline py-5">
          <Alert
            variant="outlined"
            color="info"
            title="Start a password reset"
            message="Request a reset code from the admin recovery page, then enter it here."
          />
          <Button
            as={Link}
            to={ROUTES.ADMIN.FORGOT_PASSWORD}
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
        title="Credential Updated"
        description="Your admin password was successfully secured."
        action={
          <Button
            onClick={() => {
              // WHY: Force a hard page reload to clear any stale session state in React memory
              window.location.href = ROUTES.ADMIN.ROOT
            }}
            variant="filled"
            color="primary"
            size="lg"
            className={SUBMIT_CLASS}
          >
            Access Dashboard
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
              message="Check your admin inbox for the latest code."
              size="sm"
            />
          </div>
        )}
        {resendError && (
          <div className="pt-5">
            <Alert
              variant="outlined"
              color="error"
              title="Resend Failed"
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
            className="font-mono text-[11px] uppercase tracking-[0.08em]"
          >
            Resend code
          </Button>
        </div>
      </div>
    )
  } else {
    content = (
      <AuthForm onSubmit={handleSubmit}>
        <AuthField
          label="New Password"
          error={errors.password}
          required
          hint="At least 8 characters"
        >
          <PasswordInput
            placeholder="Secure string"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setErrors((prev) => ({ ...prev, password: undefined }))
            }}
            className="h-11"
          />
        </AuthField>

        <AuthField
          label="Confirm Password"
          error={errors.confirmPassword}
          required
        >
          <PasswordInput
            placeholder="Repeat secure string"
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
            Confirm reset
          </Button>
        </div>
      </AuthForm>
    )
  }

  return (
    <>
      <Helmet>
        <title>Admin Reset Password · Cat-Bot</title>
      </Helmet>

      <AuthPanel
        variant="admin"
        index="02"
        kicker="ADMIN RECOVERY"
        title="Set a new password"
        description={`Enter the 6-digit code sent to ${email || 'your admin address'}, then choose a new password.`}
        meta={META}
        footer={
          !isSubmitted ? (
            <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
                ADMIN ACCESS
              </span>
              <Link to={ROUTES.ADMIN.ROOT} className={FOOTER_LINK}>
                Return to admin sign in
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
