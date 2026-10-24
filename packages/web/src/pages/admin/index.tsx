import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import useEmailServiceEnabled from '@/hooks/useEmailServiceEnabled'
import { useFormDraft } from '@/hooks/useFormDraft'
import AuthPanel, {
  AuthField,
  AuthForm,
} from '@/components/layout/AuthPanel'

interface LoginErrors {
  email?: string
  password?: string
}

const META = [
  { label: 'SCOPE', value: 'ADMIN' },
  { label: 'ACCESS', value: 'EMAIL + PASSWORD' },
  { label: 'ROLE', value: 'VERIFIED SERVER-SIDE' },
]

const FIELD_LINK =
  'font-mono text-[10px] uppercase tracking-[0.1em] text-primary hover:underline underline-offset-4'

const FOOTER_LINK =
  'font-mono text-[11px] uppercase tracking-[0.08em] text-primary hover:underline underline-offset-4'

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const { login } = useAdminAuth()

  // Admin login keeps the same draft contract as the user portal: email and
  // field errors persist, the password never leaves component state.
  const draft = useFormDraft<{ email: string; errors: LoginErrors }>(
    { email: '', errors: {} },
    { key: 'admin-login', storage: 'local', sensitive: [] },
  )
  const { email, errors } = draft.values
  const [password, setPassword] = useState('')
  const [apiError, setApiError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const submitLock = useRef(false)

  const { isEmailEnabled } = useEmailServiceEnabled()

  const validate = (): LoginErrors => {
    const e: LoginErrors = {}
    if (!email) e.email = 'Email is required.'
    else if (!/\S+@\S+\.\S+/.test(email))
      e.email = 'Enter a valid email address.'
    if (!password) e.password = 'Password is required.'
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
      await login(email, password)
      draft.clearDraft()
      navigate(ROUTES.ADMIN.DASHBOARD)
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : 'Login failed. Please try again.',
      )
    } finally {
      submitLock.current = false
      setIsLoading(false)
    }
  }

  return (
    <>
      <Helmet>
        <title>Admin · Cat-Bot</title>
      </Helmet>

      <AuthPanel
        variant="admin"
        index="01"
        kicker="ADMIN ACCESS"
        title="Console sign in"
        description="Restricted operations console. Credentials are checked against the administrator role."
        meta={META}
        footer={
          <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
              NOT AN ADMIN
            </span>
            <Link to={ROUTES.HOME} className={FOOTER_LINK}>
              Return to site
            </Link>
          </div>
        }
      >
        <AuthForm onSubmit={handleSubmit}>
          <AuthField label="Email" error={errors.email} required>
            <Input
              type="email"
              placeholder="admin@example.com"
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
              className="h-11 font-mono"
            />
          </AuthField>

          <AuthField
            label="Password"
            error={errors.password}
            required
            action={
              isEmailEnabled ? (
                <Link to={ROUTES.ADMIN.FORGOT_PASSWORD} className={FIELD_LINK}>
                  Forgot password?
                </Link>
              ) : undefined
            }
          >
            <PasswordInput
              placeholder="••••••••••••"
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
              autoComplete="current-password"
              className="h-11 font-mono"
            />
          </AuthField>

          {isLoading && (
            <div className="flex items-center gap-2 border-b border-hairline py-3">
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 animate-pulse bg-primary"
              />
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-on-surface-variant/80">
                Verifying credentials...
              </span>
            </div>
          )}

          {apiError && (
            <div className="mt-5">
              <Alert
                variant="outlined"
                color="error"
                title="Access Denied"
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
              Sign in
            </Button>
          </div>
        </AuthForm>
      </AuthPanel>
    </>
  )
}
