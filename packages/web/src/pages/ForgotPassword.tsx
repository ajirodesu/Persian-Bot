import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import apiClient from '@/lib/api-client.lib'
import Logo from '@/components/ui/Logo'

export default function ForgotPasswordPage() {
  const isEmailEnabled = import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true'

  const [searchParams] = useSearchParams()
  const [email, setEmail] = useState(searchParams.get('email') || '')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitted, setIsSubmitted] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email) {
      setError('Email is required.')
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
        { email, adminOnly: false },
      )
      if (!check.data.valid) {
        setError(
          check.data.error ?? 'No account found with this email address.',
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
        adminOnly: false,
      })
      setIsSubmitted(true)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setError(e.response?.data?.error || 'Failed to send reset link.')
    } finally {
      setIsLoading(false)
    }
  }

  if (!isEmailEnabled) {
    return (
      <div className="flex items-center justify-center min-h-[calc(100vh-120px)] px-6 py-16">
        <Helmet>
          <title>Forgot Password · Persian</title>
        </Helmet>
        <div className="w-full max-w-[400px]">
          <Alert
            color="warning"
            title="Feature Unavailable"
            message="Email services are not enabled for this installation. Please contact your administrator to reset your password."
          />
          <div className="mt-5 text-center">
            <Button
              as={Link}
              to={ROUTES.LOGIN}
              variant="outline"
              color="primary"
              size="md"
            >
              Back to log in
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-120px)] px-6 py-16">
      <Helmet>
        <title>Forgot Password · Persian</title>
      </Helmet>

      <div
        className="w-full max-w-[400px] flex flex-col gap-7"
        style={{ animation: 'fade-in-up 400ms var(--easing-emphasized-decelerate) both' }}
      >
        {/* Brand mark */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-container/80 border border-primary/20">
            <Logo className="h-6 w-6 text-on-primary-container" />
          </div>
          <div className="text-center flex flex-col gap-1.5">
            <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
              {isSubmitted ? 'Check your email' : 'Forgot your password?'}
            </h1>
            <p className="text-body-sm text-on-surface-variant max-w-xs mx-auto">
              {isSubmitted
                ? `We sent a reset link to ${email}. Check your inbox and follow the instructions.`
                : 'Enter your account email and we\'ll send you a link to reset your password.'}
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-outline-variant/70 bg-surface-container-low shadow-elevation-2 p-6">
          {isSubmitted ? (
            <div className="flex flex-col gap-4">
              {/* Mail icon */}
              <div className="flex h-14 w-14 mx-auto items-center justify-center rounded-2xl bg-success-container/30 border border-success/20">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="text-success"
                  aria-hidden="true"
                >
                  <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                  <path d="m16 19 2 2 4-4" />
                </svg>
              </div>
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
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              noValidate
              className="flex flex-col gap-4"
            >
              <Field.Root invalid={!!error} required>
                <Field.Label>Email address</Field.Label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value)
                    setError(null)
                  }}
                  autoComplete="email"
                />
                <Field.ErrorText>{error}</Field.ErrorText>
              </Field.Root>

              <Button
                type="submit"
                variant="filled"
                color="primary"
                size="md"
                fullWidth
                isLoading={isLoading}
              >
                Send reset link
              </Button>
            </form>
          )}
        </div>

        {!isSubmitted && (
          <p className="text-center text-body-sm text-on-surface-variant">
            Remember your password?{' '}
            <Button
              as={Link}
              to={ROUTES.LOGIN}
              variant="link"
              color="primary"
              size="sm"
            >
              Log in
            </Button>
          </p>
        )}
      </div>
    </div>
  )
}
