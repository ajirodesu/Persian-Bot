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
        <title>Forgot Password · Cat-Bot</title>
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
        <Logo className="h-6 w-6 text-on-primary-container" />
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

export default function ForgotPasswordPage() {
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

  if (isEmailStatusLoading) {
    return (
      <AuthShell>
        <div className="surface-specular glass-surface rounded-2xl border border-[color:var(--glass-border)] shadow-[var(--shadow-card-rest)] p-6 flex flex-col items-center gap-5">
          <div className="glow-ring flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-container/80 border border-primary/20">
            <Logo className="h-6 w-6 text-on-primary-container" />
          </div>
          <div className="text-center flex flex-col gap-2">
            <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
              Checking account status…
            </h1>
            <p className="text-body-sm text-on-surface-variant animate-pulse">
              Preparing the email service…
            </p>
          </div>
        </div>
      </AuthShell>
    )
  }

  if (!isEmailEnabled) {
    return (
      <AuthShell>
        <BrandMark
          heading="Feature Unavailable"
          subheading="Email services are not enabled for this installation."
        />
        <div className="surface-specular glass-surface rounded-2xl border border-[color:var(--glass-border)] shadow-[var(--shadow-card-rest)] p-6 flex flex-col gap-4">
          <Alert
            color="warning"
            title="Email service disabled"
            message="Please contact your administrator to reset your password."
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
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <BrandMark
        heading={isSubmitted ? 'Check your email' : 'Forgot your password?'}
        subheading={
          isSubmitted
            ? `We sent a reset link to ${email}. Check your inbox and follow the instructions.`
            : 'Enter your account email and we\'ll send you a link to reset your password.'
        }
      />

      {/* Card */}
      <div className="surface-specular glass-surface rounded-2xl border border-[color:var(--glass-border)] shadow-[var(--shadow-card-rest)] p-6">
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
            <Alert
              variant="tonal"
              color="success"
              title="Reset link sent"
              message="Follow the instructions in the email to reset your password."
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
              className="mt-1"
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
    </AuthShell>
  )
}
