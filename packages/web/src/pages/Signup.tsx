import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import { ROUTES } from '@/constants/routes.constants'
import Alert from '@/components/ui/feedback/Alert'
import { authUserClient } from '@/lib/better-auth-client.lib'
import { useUserAuth } from '@/contexts/UserAuthContext'
import apiClient from '@/lib/api-client.lib'
import Logo from '@/components/ui/Logo'

interface SignupForm {
  name: string
  email: string
  password: string
  confirmPassword: string
}

interface SignupErrors {
  name?: string
  email?: string
  password?: string
  confirmPassword?: string
}

export default function SignupPage() {
  const navigate = useNavigate()
  const { login } = useUserAuth()
  const [form, setForm] = useState<SignupForm>({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
  })
  const [errors, setErrors] = useState<SignupErrors>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const validate = (): SignupErrors => {
    const e: SignupErrors = {}
    if (!form.name.trim()) e.name = 'Name is required.'
    if (!form.email) e.email = 'Email is required.'
    else if (!/\S+@\S+\.\S+/.test(form.email))
      e.email = 'Enter a valid email address.'
    if (!form.password) e.password = 'Password is required.'
    else if (form.password.length < 8)
      e.password = 'Password must be at least 8 characters.'
    if (!form.confirmPassword)
      e.confirmPassword = 'Please confirm your password.'
    else if (form.password !== form.confirmPassword)
      e.confirmPassword = 'Passwords do not match.'
    return e
  }

  const handleChange =
    (field: keyof SignupForm) => (e: React.ChangeEvent<HTMLInputElement>) => {
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
      const { data: status } = await apiClient.post<{
        exists: boolean
        verified: boolean
      }>('/api/v1/validate/email-status', { email: form.email })

      if (status.exists) {
        try {
          await login(form.email, form.password)
          navigate(ROUTES.DASHBOARD.ROOT)
          return
        } catch (signInErr) {
          const signInMsg =
            signInErr instanceof Error ? signInErr.message.toLowerCase() : ''

          if (signInMsg.includes('verif')) {
            if (import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true') {
              navigate(
                `${ROUTES.ACCOUNT_VERIFICATION}?email=${encodeURIComponent(form.email)}`,
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
        name: form.name,
        email: form.email,
        password: form.password,
      })

      if (result.error) {
        throw new Error(result.error.message ?? 'Registration failed')
      }

      if (import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true') {
        navigate(
          `${ROUTES.ACCOUNT_VERIFICATION}?email=${encodeURIComponent(form.email)}`,
        )
      } else {
        navigate(ROUTES.LOGIN)
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Sign-up failed. Please try again.'
      setApiError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-120px)] px-6 py-16">
      <Helmet>
        <title>Sign Up · Cat-Bot</title>
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
              Create your account
            </h1>
            <p className="text-body-sm text-on-surface-variant">
              Deploy bots across Discord and Telegram in minutes.
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
            <Field.Root invalid={!!errors.name} required>
              <Field.Label>Full name</Field.Label>
              <Input
                type="text"
                placeholder="Jane Smith"
                value={form.name}
                onChange={handleChange('name')}
                autoComplete="name"
              />
              <Field.ErrorText>{errors.name}</Field.ErrorText>
            </Field.Root>

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
              <Field.Label>Password</Field.Label>
              <PasswordInput
                placeholder="At least 8 characters"
                value={form.password}
                onChange={handleChange('password')}
                autoComplete="new-password"
              />
              <Field.ErrorText>{errors.password}</Field.ErrorText>
            </Field.Root>

            <Field.Root invalid={!!errors.confirmPassword} required>
              <Field.Label>Confirm password</Field.Label>
              <PasswordInput
                placeholder="Repeat your password"
                value={form.confirmPassword}
                onChange={handleChange('confirmPassword')}
                autoComplete="new-password"
              />
              <Field.ErrorText>{errors.confirmPassword}</Field.ErrorText>
            </Field.Root>

            {apiError && (
              <Alert
                variant="tonal"
                color="error"
                title="Sign-up Failed"
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
              Create account
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-body-sm text-on-surface-variant">
          Already have an account?{' '}
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
      </div>
    </div>
  )
}
