import { Helmet } from '@dr.pogodin/react-helmet'
import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import { authUserClient } from '@/lib/better-auth-client.lib'
import { MailCheck } from 'lucide-react'
import apiClient from '@/lib/api-client.lib'
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
        <title>Account Verification · Cat-Bot</title>
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
        <MailCheck className="h-6 w-6 text-on-primary-container" />
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

export default function AccountVerificationPage() {
  const { isEmailEnabled, isLoading: isEmailStatusLoading } =
    useEmailServiceEnabled()
  const [searchParams] = useSearchParams()
  const email = searchParams.get('email') || ''

  const [isSending, setIsSending] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [emailStatus, setEmailStatus] = useState<
    'loading' | 'not-found' | 'already-verified' | 'pending'
  >(() => (email ? 'loading' : 'not-found'))

  useEffect(() => {
    if (!email) {
      return
    }
    let isMounted = true
    const checkEmail = async () => {
      try {
        const { data } = await apiClient.post<{
          exists: boolean
          verified: boolean
        }>('/api/v1/validate/email-status', { email })
        if (!isMounted) return
        if (!data.exists) {
          setEmailStatus('not-found')
        } else if (data.verified) {
          setEmailStatus('already-verified')
        } else {
          setEmailStatus('pending')
        }
      } catch {
        if (isMounted) setEmailStatus('pending')
      }
    }
    void checkEmail()
    return () => {
      isMounted = false
    }
  }, [email])

  const handleSendVerification = async () => {
    if (!email) return
    setIsSending(true)
    setError(null)
    setSuccess(false)

    try {
      const { error: sendError } = await authUserClient.sendVerificationEmail({
        email,
        callbackURL: window.location.origin + ROUTES.LOGIN,
      })

      if (sendError) {
        throw new Error(
          sendError.message || 'Failed to send verification email.',
        )
      }

      setSuccess(true)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'An unexpected error occurred.',
      )
    } finally {
      setIsSending(false)
    }
  }

  if (isEmailStatusLoading) {
    return (
      <AuthShell>
        <GlassCard>
          <div className="glow-ring flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-primary-container/80 border border-primary/20">
            <MailCheck className="h-6 w-6 text-on-primary-container" />
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
            message="Account verification by email is not available right now."
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

  if (emailStatus === 'loading') {
    return (
      <AuthShell>
        <GlassCard>
          <div className="glow-ring flex h-12 w-12 mx-auto items-center justify-center rounded-2xl bg-primary-container/80 border border-primary/20">
            <MailCheck className="h-6 w-6 text-on-primary-container" />
          </div>
          <div className="text-center flex flex-col gap-2">
            <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
              Checking account status
            </h1>
            <p className="text-body-sm text-on-surface-variant animate-pulse">
              Looking up your email…
            </p>
          </div>
        </GlassCard>
      </AuthShell>
    )
  }

  if (emailStatus === 'not-found') {
    return (
      <AuthShell>
        <BrandMark
          heading="Email not found"
          subheading="This email address is not registered with any account."
        />
        <GlassCard>
          <Alert
            color="warning"
            title="No account found"
            message={
              email
                ? `"${email}" is not registered. Please sign up to create an account.`
                : 'This email address is not registered.'
            }
          />
          <Button
            as={Link}
            to={ROUTES.SIGNUP}
            variant="filled"
            color="primary"
            size="md"
            fullWidth
          >
            Create an account
          </Button>
        </GlassCard>
      </AuthShell>
    )
  }

  if (emailStatus === 'already-verified') {
    return (
      <AuthShell>
        <BrandMark
          heading="Already verified"
          subheading="This email address is verified."
        />
        <GlassCard>
          <Alert
            variant="tonal"
            color="success"
            title="Verified"
            message="This email address is already verified. You can log in with your credentials."
          />
          <Button
            as={Link}
            to={ROUTES.LOGIN}
            variant="filled"
            color="primary"
            size="md"
            fullWidth
          >
            Go to log in
          </Button>
        </GlassCard>
      </AuthShell>
    )
  }

  // emailStatus === 'pending'
  return (
    <AuthShell>
      <BrandMark
        heading="Verify your email"
        subheading={`We can send a new verification link to ${
          email || 'your email'
        }.`}
      />

      {/* Card */}
      <div className="surface-specular glass-surface rounded-2xl border border-[color:var(--glass-border)] shadow-[var(--shadow-card-rest)] p-6">
        {success ? (
          <div className="flex flex-col gap-4">
            <Alert
              variant="tonal"
              color="success"
              title="Verification email sent!"
              message="Check your inbox and click the link to verify your account."
            />
            <Button
              as={Link}
              to={ROUTES.LOGIN}
              variant="filled"
              color="primary"
              size="md"
              fullWidth
            >
              Go to log in
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {error && (
              <Alert
                variant="tonal"
                color="error"
                title="Failed to send"
                message={error}
              />
            )}
            <Button
              onClick={() => void handleSendVerification()}
              variant="filled"
              color="primary"
              size="md"
              fullWidth
              isLoading={isSending}
              disabled={!email}
            >
              Send verification email
            </Button>
          </div>
        )}
      </div>

      {!success && (
        <p className="text-center text-body-sm text-on-surface-variant">
          <Button
            as={Link}
            to={ROUTES.LOGIN}
            variant="link"
            color="primary"
            size="sm"
          >
            Back to log in
          </Button>
        </p>
      )}
    </AuthShell>
  )
}