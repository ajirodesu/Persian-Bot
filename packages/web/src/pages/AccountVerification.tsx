import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useRef, useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import CodeInput from '@/components/ui/forms/CodeInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import { authUserClient } from '@/lib/better-auth-client.lib'
import apiClient from '@/lib/api-client.lib'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'
import { useFormDraft } from '@/hooks/useFormDraft'
import { useCountdownSeconds } from '@/hooks/useCountdown'
import AuthPanel, {
  AuthField,
  AuthResult,
} from '@/components/layout/AuthPanel'

// Verified against the OTP store: CODE_LENGTH = 6.
// (packages/cat-bot/src/server/lib/otp.lib.ts:29)
const META = [
  { label: 'DELIVERY', value: 'EMAIL' },
  { label: 'CODE', value: '6 DIGITS' },
]

const FOOTER_LINK =
  'font-mono text-[11px] uppercase tracking-[0.08em] text-primary hover:underline underline-offset-4'

const SUBMIT_CLASS =
  'h-11 rounded-[var(--radius-button)] font-mono text-[11px] uppercase tracking-[0.1em] sm:w-auto sm:min-w-[13rem]'

const SUBMIT_ROW =
  'flex flex-col sm:flex-row sm:items-center gap-3 py-5 border-b border-hairline'

export default function AccountVerificationPage() {
  const { isEmailEnabled, isLoading: isEmailStatusLoading } =
    useEmailServiceEnabled()
  const [searchParams] = useSearchParams()
  // Email + "code sent" + resend cooldown survive reloads. The 6-digit code
  // itself is a secret and stays in memory; if the tab is discarded the user
  // re-enters it (the cooldown still shows the correct remaining time).
  const draft = useFormDraft(
    {
      email: searchParams.get('email') || '',
      codeSent: false,
      resendDeadline: null as number | null,
    },
    { key: 'account-verification', storage: 'local', sensitive: [] },
  )
  const email = searchParams.get('email') || draft.values.email
  const codeSent = draft.values.codeSent
  const resendCooldown = useCountdownSeconds(draft.values.resendDeadline)
  const sendLock = useRef(false)

  const [isSending, setIsSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)

  const [code, setCode] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [isVerified, setIsVerified] = useState(false)

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
    if (!email || sendLock.current || resendCooldown > 0) return
    sendLock.current = true
    setIsSending(true)
    setSendError(null)
    draft.setValues((prev) => ({ ...prev, codeSent: false }))
    setVerifyError(null)
    setCode('')

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

      draft.setValues((prev) => ({
        ...prev,
        email,
        codeSent: true,
        resendDeadline: Date.now() + 60_000,
      }))
    } catch (err) {
      setSendError(
        err instanceof Error ? err.message : 'An unexpected error occurred.',
      )
    } finally {
      sendLock.current = false
      setIsSending(false)
    }
  }

  const handleVerifyCode = async (submittedCode = code) => {
    if (!email || submittedCode.length !== 6) return
    setIsVerifying(true)
    setVerifyError(null)

    try {
      await apiClient.post('/api/v1/validate/email-verification/confirm', {
        email,
        code: submittedCode,
      })
      setIsVerified(true)
      draft.clearDraft()
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setVerifyError(e.response?.data?.error || 'Invalid or expired code.')
      setCode('')
    } finally {
      setIsVerifying(false)
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
            message="Account verification by email is not available right now."
          />
          <Link to={ROUTES.LOGIN} className={FOOTER_LINK}>
            Back to log in
          </Link>
        </div>
      </div>
    )
  } else if (emailStatus === 'loading') {
    content = (
      <div className="border-t border-hairline">
        <div className="flex flex-col gap-2 border-b border-hairline py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
            CHECKING ACCOUNT STATUS
          </p>
          <p className="animate-pulse font-mono text-[11px] uppercase tracking-[0.08em] text-on-surface-variant/80">
            Looking up your email…
          </p>
        </div>
      </div>
    )
  } else if (emailStatus === 'not-found') {
    content = (
      <div className="border-t border-hairline">
        <div className="flex flex-col gap-4 border-b border-hairline py-5">
          <Alert
            variant="outlined"
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
            size="lg"
            fullWidth
            className={SUBMIT_CLASS}
          >
            Create an account
          </Button>
        </div>
      </div>
    )
  } else if (emailStatus === 'already-verified') {
    content = (
      <AuthResult
        tone="success"
        title="Verified"
        description="This email address is already verified. You can log in with your credentials."
        action={
          <Button
            as={Link}
            to={ROUTES.LOGIN}
            variant="filled"
            color="primary"
            size="lg"
            fullWidth
            className={SUBMIT_CLASS}
          >
            Go to log in
          </Button>
        }
      />
    )
  } else if (isVerified) {
    content = (
      <AuthResult
        tone="success"
        title="Verified"
        description="Your email is verified. You can now log in with your credentials."
        action={
          <Button
            as={Link}
            to={ROUTES.LOGIN}
            variant="filled"
            color="primary"
            size="lg"
            fullWidth
            className={SUBMIT_CLASS}
          >
            Go to log in
          </Button>
        }
      />
    )
  } else {
    // emailStatus === 'pending'
    content = (
      <div className="border-t border-hairline">
        {sendError && (
          <div className="pt-5">
            <Alert
              variant="outlined"
              color="error"
              title="Failed to send"
              message={sendError}
            />
          </div>
        )}
        {verifyError && (
          <div className="pt-5">
            <Alert
              variant="outlined"
              color="error"
              title="Verification failed"
              message={verifyError}
            />
          </div>
        )}
        {codeSent && (
          <div className="pt-5">
            <Alert
              variant="outlined"
              color="success"
              title="Code sent!"
              message="Check your inbox and enter the code below to verify your account."
            />
          </div>
        )}

        <AuthField label="Verification code" error={verifyError ?? undefined}>
          <CodeInput
            value={code}
            onChange={(next) => {
              setCode(next)
              setVerifyError(null)
            }}
            onComplete={handleVerifyCode}
            disabled={isSending}
            placeholder="000000"
            autoFocus={codeSent}
            className="h-11"
          />
        </AuthField>

        <div className={SUBMIT_ROW}>
          <Button
            onClick={() => void handleVerifyCode()}
            variant="filled"
            color="primary"
            size="lg"
            fullWidth
            isLoading={isVerifying}
            disabled={code.length !== 6}
            className={SUBMIT_CLASS}
          >
            Verify account
          </Button>
          <Button
            onClick={() => void handleSendVerification()}
            variant="text"
            color="neutral"
            size="md"
            isLoading={isSending}
            disabled={!email}
            className="font-mono text-[11px] uppercase tracking-[0.08em]"
          >
            {codeSent ? 'Resend code' : 'Send verification code'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <>
      <Helmet>
        <title>Account Verification · Cat-Bot</title>
      </Helmet>

      <AuthPanel
        index="03"
        kicker="VERIFICATION"
        title="Confirm your address"
        description="Enter the code we sent to your email."
        meta={META}
        footer={
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
              WRONG ADDRESS
            </span>
            <Link to={ROUTES.LOGIN} className={FOOTER_LINK}>
              Back to sign in
            </Link>
          </div>
        }
      >
        {content}
      </AuthPanel>
    </>
  )
}
