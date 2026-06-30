import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import { useUserAuth } from '@/contexts/UserAuthContext'
import Checkbox from '@/components/ui/forms/Checkbox'
import Logo from '@/components/ui/Logo'

interface LoginForm {
  email: string
  password: string
}

interface LoginErrors {
  email?: string
  password?: string
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useUserAuth()

  const isEmailEnabled = import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true'

  const [form, setForm] = useState<LoginForm>({ email: '', password: '' })
  const [errors, setErrors] = useState<LoginErrors>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)

  const validate = (): LoginErrors => {
    const e: LoginErrors = {}
    if (!form.email) e.email = 'Email is required.'
    else if (!/\S+@\S+\.\S+/.test(form.email))
      e.email = 'Enter a valid email address.'
    if (!form.password) e.password = 'Password is required.'
    return e
  }

  const handleChange =
    (field: keyof LoginForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }))
      if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }))
    }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const fieldErrors = validate()
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors)
      return
    }
    setApiError(null)
    setIsLoading(true)
    try {
      await login(form.email, form.password, rememberMe)
      navigate(ROUTES.DASHBOARD.ROOT)
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Login failed. Please try again.'
      if (msg.toLowerCase().includes('verif')) {
        navigate(
          `${ROUTES.ACCOUNT_VERIFICATION}?email=${encodeURIComponent(form.email)}`,
        )
        return
      }
      setApiError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-120px)] px-6 py-16">
      <Helmet>
        <title>Log In · Cat-Bot</title>
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
              Welcome back
            </h1>
            <p className="text-body-sm text-on-surface-variant">
              Sign in to manage your bots across Discord and Telegram.
            </p>
          </div>
        </div>

        {/* Form card */}
        <div className="rounded-2xl border border-outline-variant/70 bg-surface-container-low shadow-elevation-2 p-6 flex flex-col gap-5">
          <form
            onSubmit={handleSubmit}
            noValidate
            className="flex flex-col gap-4"
          >
            <Field.Root invalid={!!errors.email} required>
              <Field.Label>Email</Field.Label>
              <Input
                type="email"
                placeholder="you@example.com"
                value={form.email}
                onChange={handleChange('email')}
                autoComplete="email"
              />
              <Field.ErrorText>{errors.email}</Field.ErrorText>
            </Field.Root>

            <Field.Root invalid={!!errors.password} required>
              <div className="flex items-center justify-between mb-1.5">
                <Field.Label className="mb-0">Password</Field.Label>
                {isEmailEnabled && (
                  <Link
                    to={ROUTES.FORGOT_PASSWORD}
                    className="text-label-sm text-primary hover:opacity-80 transition-opacity duration-fast"
                  >
                    Forgot password?
                  </Link>
                )}
              </div>
              <PasswordInput
                placeholder="Your password"
                value={form.password}
                onChange={handleChange('password')}
                autoComplete="current-password"
              />
              <Field.ErrorText>{errors.password}</Field.ErrorText>
            </Field.Root>

            <Checkbox
              label="Remember me"
              checked={rememberMe}
              onChange={setRememberMe}
            />

            {apiError && (
              <Alert
                variant="tonal"
                color="error"
                title="Login Failed"
                message={apiError}
              />
            )}

            <Button
              type="submit"
              variant="filled"
              color="primary"
              size="md"
              fullWidth
              isLoading={isLoading}
              className="mt-1"
            >
              Log in
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-body-sm text-on-surface-variant">
          Don&apos;t have an account?{' '}
          <Button
            as={Link}
            to={ROUTES.SIGNUP}
            variant="link"
            color="primary"
            size="sm"
          >
            Sign up free
          </Button>
        </p>
      </div>
    </div>
  )
}
