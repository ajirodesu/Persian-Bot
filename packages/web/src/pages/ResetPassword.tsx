import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import apiClient from '@/lib/api-client.lib'
import { ShieldCheck } from 'lucide-react'

export default function ResetPasswordPage() {
  const isEmailEnabled = import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true'

  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')?.trim()
  const emailParam = searchParams.get('email')?.trim()

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<{
    password?: string
    confirmPassword?: string
  }>({})
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isValidating, setIsValidating] = useState(true)
  const [isTokenValid, setIsTokenValid] = useState(false)

  const [isResending, setIsResending] = useState(false)
  const [resendSuccess, setResendSuccess] = useState(false)
  const [resendError, setResendError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setIsValidating(false)
      return
    }

    let isMounted = true
    const checkToken = async () => {
      try {
        const result = await apiClient.post<{ valid: boolean }>(
          '/api/v1/validate/reset-password/verify-token',
          { token, adminOnly: false },
        )
        if (isMounted) setIsTokenValid(result.data.valid)
      } catch {
        if (isMounted) setIsTokenValid(false)
      } finally {
        if (isMounted) setIsValidating(false)
      }
    }
    void checkToken()
    return () => {
      isMounted = false
    }
  }, [token])

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
        token,
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
    if (!emailParam) return
    setIsResending(true)
    setResendError(null)

    try {
      await apiClient.post('/api/v1/validate/reset-password/request', {
        email: emailParam,
        adminOnly: false,
      })
      setResendSuccess(true)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setResendError(e.response?.data?.error || 'Failed to resend reset link.')
    } finally {
      setIsResending(false)
    }
  }

  const wrapperClass =
    'flex items-center justify-center min-h-[calc(100vh-120px)] px-6 py-16'

  if (!isEmailEnabled) {
    return (
      <div className={wrapperClass}>
        <Helmet>
          <title>Set New Password · Persian</title>
        </Helmet>
        <div className="w-full max-w-[400px]">
          <Alert
            color="warning"
            title="Feature Unavailable"
            message="Email services are not enabled on this instance."
          />
        </div>
      </div>
    )
  }

  if (isValidating) {
    return (
      <div className={wrapperClass}>
        <Helmet>
          <title>Validating… · Persian</title>
        </Helmet>
        <p className="text-body-sm text-on-surface-variant animate-pulse">
          Validating your reset link…
        </p>
      </div>
    )
  }

  if (!token || !isTokenValid) {
    return (
      <div className={wrapperClass}>
        <Helmet>
          <title>Invalid Link · Persian</title>
        </Helmet>
        <div
          className="w-full max-w-[400px] flex flex-col gap-5"
          style={{ animation: 'fade-in-up 400ms var(--easing-emphasized-decelerate) both' }}
        >
          <Alert
            color={resendSuccess ? 'success' : 'error'}
            title={resendSuccess ? 'Reset link sent' : 'Invalid or expired link'}
            message={
              resendSuccess
                ? 'A new secure reset link has been sent to your email.'
                : 'This password reset link is missing, invalid, or has expired. Please request a new one.'
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
          <div className="flex flex-col gap-2.5">
            {!resendSuccess && emailParam && (
              <Button
                onClick={() => void handleResend()}
                variant="filled"
                color="primary"
                size="md"
                fullWidth
                isLoading={isResending}
              >
                Resend reset link
              </Button>
            )}
            <Button
              as={Link}
              to={`${ROUTES.FORGOT_PASSWORD}${emailParam ? `?email=${encodeURIComponent(emailParam)}` : ''}`}
              variant={!resendSuccess && emailParam ? 'outline' : 'filled'}
              color="primary"
              size="md"
              fullWidth
            >
              {emailParam ? 'Use a different email' : 'Request new link'}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={wrapperClass}>
      <Helmet>
        <title>Set New Password · Persian</title>
      </Helmet>

      <div
        className="w-full max-w-[400px] flex flex-col gap-7"
        style={{ animation: 'fade-in-up 400ms var(--easing-emphasized-decelerate) both' }}
      >
        {/* Brand mark */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-container/80 border border-primary/20">
            <ShieldCheck className="h-6 w-6 text-on-primary-container" />
          </div>
          <div className="text-center flex flex-col gap-1.5">
            <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
              {isSubmitted ? 'Password reset' : 'Set new password'}
            </h1>
            <p className="text-body-sm text-on-surface-variant">
              {isSubmitted
                ? 'Your password has been reset successfully.'
                : 'Create a strong password for your account.'}
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-outline-variant/70 bg-surface-container-low shadow-elevation-2 p-6">
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
      </div>
    </div>
  )
}
