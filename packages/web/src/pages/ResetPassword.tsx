import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import CodeInput from '@/components/ui/forms/CodeInput'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import apiClient from '@/lib/api-client.lib'
import { ShieldCheck } from 'lucide-react'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'

/**
 * AuthShell — ambient-glow background + centered column shared by every
 * state of this page. Mirrors the treatment on the Login page so the email
 * service never renders as a separate, less-considered surface.
 */
function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative flex items-center justify-center min-h-[calc(100vh-120px)] px-6 py-16 overflow-hidden">
      <Helmet>
        <title>Set New Password · Cat-Bot</title>
      </Helmet>

      {/* Ambient glow — same treatment as the marketing pages */}
      <div className="pointer-events-none absolute -top-40 -left-40 h-[480px] w-[480px] rounded-full bg-primary/[0.06] blur-[110px]" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-[420px] w-[420px] rounded-full bg-tertiary/[0.05] blur-[100px]" />

      <div
        className="relative z-10 w-full max-w-[400px] flex flex-col gap-7"
        style={{
          animation: 'fade-in-up 400ms var(--easing-emphasized-decelerate) both',
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** Brand mark — glow-ring icon above the page heading. */
function BrandMark({
  heading,
  subheading,
}: {
  heading: string
  subheading: string
}) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="glow-ring flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-container/80 border border-primary/20">
        <ShieldCheck className="h-6 w-6 text-on-primary-container" />
      </div>
      <div className="text-center flex flex-col gap-1.5">
        <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
          {heading}
        </h1>
        <p className="text-body-sm text-on-surface-variant max-w-xs mx-auto leading-relaxed">
          {subheading}
        </p>
      </div>
    </div>
  )
}

/** A glass marker card used for loading / status-only states. */
function GlassCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="surface-specular glass-surface rounded-2xl border border-[color:var(--glass-border)] shadow-[var(--shadow-card-rest)] p-6 flex flex-col gap-4">
      {children}
    </div>
  )
}

export default function ResetPasswordPage() {
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
        adminOnly: false,
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
        adminOnly: false,
      })
      setResendSuccess(true)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setResendError(e.response?.data?.error || 'Failed to resend reset code.')
    } finally {
      setIsResending(false)
    }
  }

  if (isEmailStatusLoading) {
    return (
      <AuthShell>
        <GlassCard>
          <div className="glow-ring flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-primary-container/80 border border-primary/20">
            <ShieldCheck className="h-6 w-6 text-on-primary-container" />
          </div>
          <div className="text-center flex flex-col gap-2">
            <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
              Checking account status
            </h1>
            <p className="text-body-sm text-on-surface-variant animate-pulse">
              Preparing the email service…
            </p>
          </div>
        </GlassCard>
      </AuthShell>
    )
  }

  if (!isEmailEnabled) {
    return (
      <AuthShell>
        <BrandMark
          heading="Feature Unavailable"
          subheading="Email services are not enabled on this instance."
        />
        <GlassCard>
          <Alert
            color="warning"
            title="Email service disabled"
            message="Password reset by email is not available right now."
          />
          <Button
            as={Link}
            to={ROUTES.LOGIN}
            variant="filled"
            color="primary"
            size="md"
            fullWidth
          >
            Back to log in
          </Button>
        </GlassCard>
      </AuthShell>
    )
  }

  if (!email) {
    return (
      <AuthShell>
        <BrandMark
          heading={resendSuccess ? 'Reset code sent' : 'Start a password reset'}
          subheading={
            resendSuccess
              ? 'A new reset code has been sent to your email.'
              : 'Enter your account email to receive a reset code.'
          }
        />
        <GlassCard>
          <Alert
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
              variant="tonal"
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
            size="md"
            fullWidth
          >
            Request reset code
          </Button>
        </GlassCard>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <BrandMark
        heading={
          isSubmitted
            ? 'Password reset'
            : codeVerified
              ? 'Set new password'
              : 'Enter reset code'
        }
        subheading={
          isSubmitted
            ? 'Your password has been reset successfully.'
            : codeVerified
              ? `Create a strong password for ${email}.`
              : `Enter the 6-digit code we sent to ${email}.`
        }
      />

      {/* Card */}
      <div className="surface-specular glass-surface rounded-2xl border border-[color:var(--glass-border)] shadow-[var(--shadow-card-rest)] p-6">
        {isSubmitted ? (
          <div className="flex flex-col gap-4">
            <Alert
              variant="tonal"
              color="success"
              title="Password updated"
              message="You can now log in with your new password."
            />
            <Button
              onClick={() => {
                window.location.href = ROUTES.LOGIN
              }}
              variant="filled"
              color="primary"
              size="md"
              fullWidth
            >
              Go to log in
            </Button>
          </div>
        ) : !codeVerified ? (
          <div className="flex flex-col gap-4">
            {resendSuccess && (
              <Alert
                variant="tonal"
                color="success"
                title="New code sent"
                message="Check your inbox for the latest code."
                size="sm"
              />
            )}
            {resendError && (
              <Alert
                variant="tonal"
                color="error"
                title="Resend failed"
                message={resendError}
                size="sm"
              />
            )}
            {codeError && (
              <Alert
                variant="tonal"
                color="error"
                title="Verification failed"
                message={codeError}
              />
            )}
            <Field.Root invalid={!!codeError}>
              <Field.Label>Verification code</Field.Label>
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
              />
              {codeError && <Field.ErrorText>{codeError}</Field.ErrorText>}
            </Field.Root>

            <Button
              onClick={() => void handleVerifyCode()}
              variant="filled"
              color="primary"
              size="md"
              fullWidth
              isLoading={isVerifyingCode}
              disabled={code.length !== 6}
            >
              Continue
            </Button>

            <Button
              onClick={() => void handleResend()}
              variant="text"
              color="primary"
              size="md"
              fullWidth
              isLoading={isResending}
            >
              Resend code
            </Button>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-4"
          >
            <Field.Root invalid={!!errors.password} required>
              <Field.Label>New password</Field.Label>
              <PasswordInput
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  setErrors((prev) => ({ ...prev, password: undefined }))
                }}
              />
              <Field.ErrorText>{errors.password}</Field.ErrorText>
            </Field.Root>

            <Field.Root invalid={!!errors.confirmPassword} required>
              <Field.Label>Confirm new password</Field.Label>
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
              />
              <Field.ErrorText>{errors.confirmPassword}</Field.ErrorText>
            </Field.Root>

            <Button
              type="submit"
              variant="filled"
              color="primary"
              size="md"
              fullWidth
              isLoading={isLoading}
              className="mt-1"
            >
              Reset password
            </Button>
          </form>
        )}
      </div>

      {!isSubmitted && (
        <p className="text-center text-body-sm text-on-surface-variant">
          <Button
            as={Link}
            to={ROUTES.FORGOT_PASSWORD}
            variant="link"
            color="primary"
            size="sm"
          >
            Didn't get a code? Request a new one
          </Button>
        </p>
      )}
    </AuthShell>
  )
}