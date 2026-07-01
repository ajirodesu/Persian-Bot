import { Helmet } from '@dr.pogodin/react-helmet'
import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import { authUserClient } from '@/lib/better-auth-client.lib'
import { MailCheck } from 'lucide-react'
import apiClient from '@/lib/api-client.lib'

export default function AccountVerificationPage() {
  const isEmailEnabled = import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true'
  const [searchParams] = useSearchParams()
  const email = searchParams.get('email') || ''

  const [isSending, setIsSending] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [emailStatus, setEmailStatus] = useState<
    'loading' | 'not-found' | 'already-verified' | 'pending'
  >('loading')

  useEffect(() => {
    if (!email) {
      setEmailStatus('not-found')
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

  const wrapperClass =
    'flex items-center justify-center min-h-[calc(100vh-120px)] px-6 py-16'

  if (!isEmailEnabled) {
    return (
      <div className={wrapperClass}>
        <Helmet>
          <title>Account Verification · Cat-Bot</title>
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

  if (emailStatus === 'loading') {
    return (
      <div className={wrapperClass}>
        <Helmet>
          <title>Account Verification · Cat-Bot</title>
        </Helmet>
        <p className="text-body-sm text-on-surface-variant animate-pulse">
          Checking account status…
        </p>
      </div>
    )
  }

  if (emailStatus === 'not-found') {
    return (
      <div className={wrapperClass}>
        <Helmet>
          <title>Account Verification · Cat-Bot</title>
        </Helmet>
        <div
          className="w-full max-w-[400px] flex flex-col gap-5"
          style={{ animation: 'fade-in-up 400ms var(--easing-emphasized-decelerate) both' }}
        >
          <Alert
            color="warning"
            title="Email not found"
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
        </div>
      </div>
    )
  }

  if (emailStatus === 'already-verified') {
    return (
      <div className={wrapperClass}>
        <Helmet>
          <title>Account Verification · Cat-Bot</title>
        </Helmet>
        <div
          className="w-full max-w-[400px] flex flex-col gap-5"
          style={{ animation: 'fade-in-up 400ms var(--easing-emphasized-decelerate) both' }}
        >
          <Alert
            variant="tonal"
            color="success"
            title="Already verified"
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
        </div>
      </div>
    )
  }

  // emailStatus === 'pending'
  return (
    <div className={wrapperClass}>
      <Helmet>
        <title>Account Verification · Cat-Bot</title>
      </Helmet>

      <div
        className="w-full max-w-[400px] flex flex-col gap-7"
        style={{ animation: 'fade-in-up 400ms var(--easing-emphasized-decelerate) both' }}
      >
        {/* Brand mark + heading */}
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-container/80 border border-primary/20">
            <MailCheck className="h-6 w-6 text-on-primary-container" />
          </div>
          <div className="text-center flex flex-col gap-1.5">
            <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
              Verify your email
            </h1>
            <p className="text-body-sm text-on-surface-variant max-w-xs mx-auto leading-relaxed">
              We can send a new verification link to{' '}
              <span className="font-semibold text-on-surface">
                {email || 'your email'}
              </span>
              .
            </p>
          </div>
        </div>

        {/* Card */}
        <div className="rounded-2xl border border-outline-variant/70 bg-surface-container-low shadow-elevation-2 p-6">
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
      </div>
    </div>
  )
}
