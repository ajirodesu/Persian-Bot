import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import { ROUTES } from '@/constants/routes.constants'
import { Platforms } from '@/constants/platform.constants'
import Alert from '@/components/ui/feedback/Alert'
import { authUserClient } from '@/lib/better-auth-client.lib'
import { useUserAuth } from '@/contexts/UserAuthContext'
import apiClient from '@/lib/api-client.lib'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'
import { useFormDraft } from '@/hooks/useFormDraft'
import AuthPanel, {
  AuthField,
  AuthForm,
} from '@/components/layout/AuthPanel'

interface SignupDraft {
  name: string
  email: string
  errors: {
    name?: string
    email?: string
    password?: string
    confirmPassword?: string
  }
}

const INITIAL: SignupDraft = { name: '', email: '', errors: {} }

/** Derived from the client platform registry — see Login.tsx. */
const PLATFORM_COUNT = String(Object.keys(Platforms).length).padStart(2, '0')

const META = [
  { label: 'ROLE', value: 'OPERATOR' },
  { label: 'SESSION', value: 'PERSISTENT' },
  { label: 'PLATFORMS', value: PLATFORM_COUNT },
]

const FOOTER_LINK =
  'font-mono text-[11px] uppercase tracking-[0.08em] text-primary hover:underline underline-offset-4'

export default function SignupPage() {
  const navigate = useNavigate()
  const { login } = useUserAuth()
  const { isEmailEnabled } = useEmailServiceEnabled()

  // Name + email + field errors persist; both password fields are memory-only.
  const draft = useFormDraft<SignupDraft>(INITIAL, {
    key: 'signup',
    storage: 'local',
    sensitive: [],
  })
  const { name, email, errors } = draft.values

  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [apiError, setApiError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const submitLock = useRef(false)

  const validate = (): SignupDraft['errors'] => {
    const e: SignupDraft['errors'] = {}
    if (!name.trim()) e.name = 'Name is required.'
    if (!email) e.email = 'Email is required.'
    else if (!/\S+@\S+\.\S+/.test(email))
      e.email = 'Enter a valid email address.'
    if (!password) e.password = 'Password is required.'
    else if (password.length < 8)
      e.password = 'Password must be at least 8 characters.'
    if (!confirmPassword) e.confirmPassword = 'Please confirm your password.'
    else if (password !== confirmPassword)
      e.confirmPassword = 'Passwords do not match.'
    return e
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitLock.current) return

    const fieldErrors = validate()
    if (Object.keys(fieldErrors).length > 0) {
      draft.setValues((prev) => ({ ...prev, errors: fieldErrors }))
      return
    }

    submitLock.current = true
    draft.setValues((prev) => ({ ...prev, errors: {} }))
    setApiError(null)
    setIsLoading(true)
    try {
      const { data: status } = await apiClient.post<{
        exists: boolean
        verified: boolean
      }>('/api/v1/validate/email-status', { email })

      if (status.exists) {
        try {
          await login(email, password)
          draft.clearDraft()
          navigate(ROUTES.DASHBOARD.ROOT)
          return
        } catch (signInErr) {
          const signInMsg =
            signInErr instanceof Error ? signInErr.message.toLowerCase() : ''

          if (signInMsg.includes('verif')) {
            if (isEmailEnabled) {
              draft.clearDraft()
              navigate(
                `${ROUTES.ACCOUNT_VERIFICATION}?email=${encodeURIComponent(email)}`,
              )
            } else {
              setApiError(
                signInErr instanceof Error
                  ? signInErr.message
                  : 'Please verify your email.',
              )
            }
            return
          }

          if (signInMsg.includes('banned')) {
            setApiError(
              signInErr instanceof Error
                ? signInErr.message
                : 'Your account has been banned.',
            )
            return
          }

          setApiError(
            'This email is already registered. Please use a different email or log in.',
          )
          return
        }
      }

      const result = await authUserClient.signUp.email({
        name,
        email,
        password,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Registration failed')
      }

      draft.clearDraft()
      if (isEmailEnabled) {
        navigate(
          `${ROUTES.ACCOUNT_VERIFICATION}?email=${encodeURIComponent(email)}`,
        )
      } else {
        navigate(ROUTES.LOGIN)
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Sign-up failed. Please try again.'
      setApiError(msg)
    } finally {
      submitLock.current = false
      setIsLoading(false)
    }
  }

  return (
    <>
      <Helmet>
        <title>Sign Up · Cat-Bot</title>
      </Helmet>

      <AuthPanel
        index="01"
        kicker="REGISTRATION"
        title="Create account"
        description="One account runs every bot session you own."
        meta={META}
        footer={
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
              ALREADY REGISTERED
            </span>
            <Link to={ROUTES.LOGIN} className={FOOTER_LINK}>
              Sign in
            </Link>
          </div>
        }
      >
        {draft.restored && (name || email) && (
          <p className="border-b border-hairline py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/85">
            Draft restored · passwords never stored
          </p>
        )}

        <AuthForm onSubmit={handleSubmit}>
          <AuthField label="Full name" error={errors.name} required>
            <Input
              type="text"
              placeholder="Jane Smith"
              value={name}
              onChange={(e) => {
                const value = e.target.value
                draft.setValues((prev) => ({
                  ...prev,
                  name: value,
                  errors: { ...prev.errors, name: undefined },
                }))
              }}
              autoComplete="name"
              className="h-11"
            />
          </AuthField>

          <AuthField label="Email" error={errors.email} required>
            <Input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => {
                const value = e.target.value
                draft.setValues((prev) => ({
                  ...prev,
                  email: value,
                  errors: { ...prev.errors, email: undefined },
                }))
                setApiError(null)
              }}
              autoComplete="email"
              className="h-11"
            />
          </AuthField>

          <AuthField
            label="Password"
            error={errors.password}
            required
            hint="At least 8 characters"
          >
            <PasswordInput
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (errors.password) {
                  draft.setValues((prev) => ({
                    ...prev,
                    errors: { ...prev.errors, password: undefined },
                  }))
                }
              }}
              autoComplete="new-password"
              className="h-11"
            />
          </AuthField>

          <AuthField
            label="Confirm password"
            error={errors.confirmPassword}
            required
          >
            <PasswordInput
              placeholder="Repeat your password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                if (errors.confirmPassword) {
                  draft.setValues((prev) => ({
                    ...prev,
                    errors: { ...prev.errors, confirmPassword: undefined },
                  }))
                }
              }}
              autoComplete="new-password"
              className="h-11"
            />
          </AuthField>

          {apiError && (
            <div className="mt-5" role="alert">
              <Alert
                variant="outlined"
                color="error"
                title="Sign-up Failed"
                message={apiError}
              />
            </div>
          )}

          <div className="flex flex-col sm:flex-row sm:items-center gap-3 py-5 border-b border-hairline">
            <Button
              type="submit"
              variant="filled"
              color="primary"
              size="lg"
              isLoading={isLoading}
              fullWidth
              className="h-11 rounded-[var(--radius-button)] font-mono text-[11px] uppercase tracking-[0.1em] sm:w-auto sm:min-w-[13rem]"
            >
              Create account
            </Button>
          </div>
        </AuthForm>
      </AuthPanel>
    </>
  )
}
