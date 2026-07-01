import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import apiClient from '@/lib/api-client.lib'

export default function AdminForgotPasswordPage() {
  const isEmailEnabled = import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true'

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
      setError(e.response?.data?.error || 'Failed to send reset link.')
    } finally {
      setIsLoading(false)
    }
  }

  const wrapperClass =
    'min-h-screen flex items-center justify-center bg-surface-container-highest px-4 py-12 relative overflow-hidden'

  if (!isEmailEnabled) {
    return (
      <div className={wrapperClass}>
        <Helmet>
          <title>Admin Recovery · Persian</title>
        </Helmet>
        <div className="w-full max-w-[380px]">
          <Alert
            color="warning"
            title="Feature Unavailable"
            message="Email services are not enabled on this instance."
          />
        </div>
      </div>
    )
  }

  return (
    <div className={wrapperClass}>
      <Helmet>
        <title>Admin Recovery · Persian</title>
      </Helmet>

      {/* Subtle background */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            'radial-gradient(circle, rgb(var(--color-outline-variant) / 0.25) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div
        className="relative w-full max-w-[380px] flex flex-col gap-7"
        style={{ animation: 'fade-in-up 400ms var(--easing-emphasized-decelerate) both' }}
      >
        {/* Heading */}
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-container/80 border border-primary/20">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-6 h-6 text-on-primary-container"
              aria-hidden="true"
            >
              <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
              <path d="m16 19 2 2 4-4" />
            </svg>
          </div>
          <div className="flex flex-col gap-1.5">
            <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
              Account Recovery
            </h1>
            <p className="text-body-sm text-on-surface-variant">
              Request a secure reset link for your admin account.
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-outline-variant/70 bg-surface-container-low shadow-elevation-2 p-6 flex flex-col gap-5">
          {isSubmitted ? (
            <div className="flex flex-col gap-4">
              <Alert
                variant="tonal"
                color="success"
                title="Request processed"
                message={`Instructions have been sent to ${email} if an admin account exists.`}
              />
              <Button
                as={Link}
                to={ROUTES.ADMIN.ROOT}
                variant="filled"
                color="primary"
                size="md"
                fullWidth
              >
                Return to admin login
              </Button>
            </div>
          ) : (
            <form
              onSubmit={handleSubmit}
              noValidate
              className="flex flex-col gap-4"
            >
              <Field.Root invalid={!!error} required>
                <Field.Label>Admin email</Field.Label>
                <Input
                  type="email"
                  placeholder="admin@example.com"
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
                Send secure link
              </Button>
            </form>
          )}
        </div>

        {!isSubmitted && (
          <p className="text-center text-body-sm text-on-surface-variant">
            <Link
              to={ROUTES.ADMIN.ROOT}
              className="text-primary hover:opacity-80 transition-opacity duration-fast"
            >
              Cancel and return to login
            </Link>
          </p>
        )}

        <p className="text-center text-label-xs text-on-surface-variant/40 font-mono tracking-widest uppercase">
          Persian Admin Portal
        </p>
      </div>
    </div>
  )
}
