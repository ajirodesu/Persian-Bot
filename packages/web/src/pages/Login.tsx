import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import { Platforms } from '@/constants/platform.constants'
import { useUserAuth } from '@/contexts/UserAuthContext'
import Checkbox from '@/components/ui/forms/Checkbox'
import useEmailServiceEnabled from '@/hooks/useEmailServiceEnabled'
import { useFormDraft } from '@/hooks/useFormDraft'
import AuthPanel, {
  AuthField,
  AuthForm,
} from '@/components/layout/AuthPanel'

interface LoginForm {
  email: string
  rememberMe: boolean
  errors: {
    email?: string
    password?: string
  }
}

/**
 * Derived from the client platform registry so the ledger can never claim a
 * platform count the dashboard does not actually offer.
 */
const PLATFORM_COUNT = String(Object.keys(Platforms).length).padStart(2, '0')

const META = [
  { label: 'ROLE', value: 'OPERATOR' },
  { label: 'ACCESS', value: 'EMAIL + PASSWORD' },
  { label: 'PLATFORMS', value: PLATFORM_COUNT },
]

const FIELD_LINK =
  'font-mono text-[10px] uppercase tracking-[0.1em] text-primary hover:underline underline-offset-4'

const FOOTER_LINK =
  'font-mono text-[11px] uppercase tracking-[0.08em] text-primary hover:underline underline-offset-4'

const INITIAL: LoginForm = {
  email: '',
  rememberMe: false,
  errors: {},
}

interface LocationState {
  from?: { pathname: string; search?: string; hash?: string }
}

export default function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useUserAuth()

  // Email + "remember me" + field errors survive tab switches, app switches
  // and reloads. The password deliberately lives only in component state:
  // `sensitive` is empty here because the draft object already excludes it.
  const draft = useFormDraft<LoginForm>(INITIAL, {
    key: 'login',
    storage: 'local',
    sensitive: [],
  })
  const { email, rememberMe } = draft.values

  const [password, setPassword] = useState('')
  const [apiError, setApiError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  // Synchronous lock: a double click or an Enter key repeat can fire two
  // submits before React re-renders with the loading state.
  const submitLock = useRef(false)

  const { isEmailEnabled } = useEmailServiceEnabled()

  const validate = (): LoginForm['errors'] => {
    const next: LoginForm['errors'] = {}
    if (!email) next.email = 'Email is required.'
    else if (!/\S+@\S+\.\S+/.test(email))
      next.email = 'Enter a valid email address.'
    if (!password) next.password = 'Password is required.'
    return next
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
      await login(email, password, rememberMe)
      draft.clearDraft()
      const from = (location.state as LocationState | null)?.from
      const returnTo = from
        ? `${from.pathname}${from.search ?? ''}${from.hash ?? ''}`
        : ROUTES.DASHBOARD.ROOT
      navigate(returnTo, { replace: true })
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Login failed. Please try again.'
      if (msg.toLowerCase().includes('verif')) {
        navigate(
          `${ROUTES.ACCOUNT_VERIFICATION}?email=${encodeURIComponent(email)}`,
        )
        return
      }
      setApiError(msg)
    } finally {
      submitLock.current = false
      setIsLoading(false)
    }
  }

  return (
    <>
      <Helmet>
        <title>Log In · Cat-Bot</title>
      </Helmet>

      <AuthPanel
        index="01"
        kicker="ACCESS"
        title="Sign in"
        description="Run every bot session you own from one console."
        meta={META}
        footer={
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
              NO ACCOUNT
            </span>
            <Link to={ROUTES.SIGNUP} className={FOOTER_LINK}>
              Create one
            </Link>
          </div>
        }
      >
        {draft.restored && email && (
          <p className="border-b border-hairline py-3 font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/85">
            Draft restored · password never stored
          </p>
        )}

        <AuthForm onSubmit={handleSubmit}>
          <AuthField
            label="Email"
            error={draft.values.errors.email}
            required
          >
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
            error={draft.values.errors.password}
            required
            action={
              isEmailEnabled ? (
                <Link to={ROUTES.FORGOT_PASSWORD} className={FIELD_LINK}>
                  Forgot password?
                </Link>
              ) : undefined
            }
          >
            <PasswordInput
              placeholder="Your password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                if (draft.values.errors.password) {
                  draft.setValues((prev) => ({
                    ...prev,
                    errors: { ...prev.errors, password: undefined },
                  }))
                }
              }}
              autoComplete="current-password"
              className="h-11"
            />
          </AuthField>

          <div className="flex items-center justify-between py-5 border-b border-hairline">
            <Checkbox
              label="Remember me"
              checked={rememberMe}
              onChange={(checked) =>
                draft.setValues((prev) => ({ ...prev, rememberMe: checked }))
              }
            />
          </div>

          {apiError && (
            <div className="mt-5" role="alert">
              <Alert
                variant="outlined"
                color="error"
                title="Login Failed"
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
              Log in
            </Button>
          </div>
        </AuthForm>
      </AuthPanel>
    </>
  )
}
