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
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'

/**
 * Admin Reset Password page — requires the email a reset code was sent to.
 * Flows: (1) enter the 6-digit code, (2) set a new password.
 */
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

  if (isEmailStatusLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-container-highest px-4 py-12">
        <Helmet>
          <title>Admin Reset Password · Cat-Bot</title>
        </Helmet>
        <p className="text-body-sm text-on-surface-variant animate-pulse">
          Checking account status…
        </p>
      </div>
    )
  }

  if (!isEmailEnabled) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-container-highest px-4 py-12">
        <Helmet>
          <title>Admin Reset Password · Cat-Bot</title>
        </Helmet>
        <Alert
          color="warning"
          title="Disabled"
          message="Email services are disabled on this instance."
        />
      </div>
    )
  }

  if (!email) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-container-highest px-4 py-12">
        <Helmet>
          <title>Admin Reset Password · Cat-Bot</title>
        </Helmet>
        <div className="w-full max-w-sm flex flex-col gap-4">
          <Alert
            color="info"
            title="Start a password reset"
            message="Request a reset code from the admin recovery page, then enter it here."
          />
          <Button
            as={Link}
            to={ROUTES.ADMIN.FORGOT_PASSWORD}
            variant="filled"
            color="primary"
            size="md"
            fullWidth
          >
            Request reset code
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-container-highest px-4 py-12">
      <Helmet>
        <title>Admin Reset Password · Cat-Bot</title>
      </Helmet>

      <div className="w-full max-w-sm flex flex-col gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="inline-flex items-center justify-center w-11 h-11 rounded-2xl bg-primary/10 text-primary">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-5 h-5"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </span>
          <div>
            <h1 className="text-headline-sm font-semibold text-on-surface">
              {isSubmitted
                ? 'Password Reset'
                : codeVerified
                  ? 'Set New Password'
                  : 'Enter Reset Code'}
            </h1>
            <p className="mt-1 text-body-sm text-on-surface-variant">
              {isSubmitted
                ? 'Your admin password was successfully reset.'
                : codeVerified
                  ? `Establish a new credential pair for ${email}.`
                  : `Enter the 6-digit code sent to ${email}.`}
            </p>
          </div>
        </div>

        <div className="rounded-2xl bg-surface shadow-elevation-1 p-6 flex flex-col gap-5">
          {isSubmitted ? (
            <div className="flex flex-col gap-5">
              <Alert
                variant="tonal"
                color="success"
                title="Credential Updated"
                message="Your admin password was successfully secured."
              />
              <Button
                onClick={() => {
                  // WHY: Force a hard page reload to clear any stale session state in React memory
                  window.location.href = ROUTES.ADMIN.ROOT
                }}
                variant="filled"
                color="primary"
                size="md"
                fullWidth
              >
                Access Dashboard
              </Button>
            </div>
          ) : !codeVerified ? (
            <div className="flex flex-col gap-4">
              {resendSuccess && (
                <Alert
                  variant="tonal"
                  color="success"
                  title="New code sent"
                  message="Check your admin inbox for the latest code."
                  size="sm"
                />
              )}
              {resendError && (
                <Alert
                  variant="tonal"
                  color="error"
                  title="Resend Failed"
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
                <Field.Label>New Password</Field.Label>
                <PasswordInput
                  placeholder="Secure string"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value)
                    setErrors((prev) => ({ ...prev, password: undefined }))
                  }}
                />
                <Field.ErrorText>{errors.password}</Field.ErrorText>
              </Field.Root>

              <Field.Root invalid={!!errors.confirmPassword} required>
                <Field.Label>Confirm Password</Field.Label>
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
              >
                Confirm reset
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}