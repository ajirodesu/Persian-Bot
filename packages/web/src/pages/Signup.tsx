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
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'

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
  const { isEmailEnabled } = useEmailServiceEnabled()
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
            if (isEmailEnabled) {
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

      if (isEmailEnabled) {
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
    <div className="bg-[#0A0C0E] text-[#F1F4F8] min-h-[calc(100vh-48px)] flex flex-col">
      <Helmet>
        <title>Sign Up · Cat-Bot</title>
      </Helmet>

      <main className="flex-1 flex flex-col w-full max-w-sm mx-auto px-5 pb-8">
        <div className="flex flex-col w-full my-auto py-10">
          {/* Hero — 72px double-well mark per create_account.html */}
          <section className="flex flex-col items-center text-center mb-8">
            <div className="w-[72px] h-[72px] rounded-xl bg-[#13161A] border border-[#242930] flex items-center justify-center mb-5">
              <div className="w-12 h-12 rounded-lg bg-[#191D22] border border-[#242930] flex items-center justify-center text-[#10B981]">
                <Logo className="w-[30px] h-[30px]" />
              </div>
            </div>
            <h1 className="text-[32px] font-bold text-[#F1F4F8] tracking-tight mb-1">
              Create your account
            </h1>
            <p className="text-sm text-[#8B95A2] max-w-[280px] leading-relaxed">
              Deploy bots across Discord, Telegram, and Fluxer in minutes.
            </p>
          </section>

          {/* Form card */}
          <div className="w-full bg-[#13161A] border border-[#242930] rounded-xl p-6 mb-8">
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
              <Field.Root invalid={!!errors.name} required>
                <Field.Label>
                  Full name <span className="text-[#EF4444]">*</span>
                </Field.Label>
                <Input
                  type="text"
                  placeholder="Jane Smith"
                  value={form.name}
                  onChange={handleChange('name')}
                  autoComplete="name"
                  className="h-[52px]"
                />
                <Field.ErrorText>{errors.name}</Field.ErrorText>
              </Field.Root>

              <Field.Root invalid={!!errors.email} required>
                <Field.Label>
                  Email <span className="text-[#EF4444]">*</span>
                </Field.Label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  value={form.email}
                  onChange={handleChange('email')}
                  autoComplete="email"
                  className="h-[52px]"
                />
                <Field.ErrorText>{errors.email}</Field.ErrorText>
              </Field.Root>

              <Field.Root invalid={!!errors.password} required>
                <Field.Label>
                  Password <span className="text-[#EF4444]">*</span>
                </Field.Label>
                <PasswordInput
                  placeholder="At least 8 characters"
                  value={form.password}
                  onChange={handleChange('password')}
                  autoComplete="new-password"
                  className="h-[52px]"
                />
                <Field.ErrorText>{errors.password}</Field.ErrorText>
              </Field.Root>

              <Field.Root invalid={!!errors.confirmPassword} required>
                <Field.Label>
                  Confirm password <span className="text-[#EF4444]">*</span>
                </Field.Label>
                <PasswordInput
                  placeholder="Repeat your password"
                  value={form.confirmPassword}
                  onChange={handleChange('confirmPassword')}
                  autoComplete="new-password"
                  className="h-[52px]"
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

              <div className="pt-1">
                <Button
                  type="submit"
                  variant="filled"
                  color="primary"
                  size="lg"
                  fullWidth
                  isLoading={isLoading}
                  className="h-12 rounded-lg text-[15px] font-semibold"
                >
                  Create account
                </Button>
              </div>
            </form>
          </div>

          {/* Redirect */}
          <div className="flex items-center justify-center gap-1.5 mb-8">
            <span className="text-sm text-[#8B95A2]">Already have an account?</span>
            <Button
              as={Link}
              to={ROUTES.LOGIN}
              variant="link"
              color="primary"
              size="sm"
              className="font-semibold min-h-[44px] inline-flex items-center"
            >
              Log in
            </Button>
          </div>

          {/* Mini footer */}
          <footer className="mt-auto flex flex-col items-center justify-center text-center gap-1 py-4">
            <div className="flex items-center gap-1.5 text-[#8B95A2]">
              <Logo className="w-4 h-4" />
              <span className="text-xs font-medium">Cat-Bot</span>
            </div>
            <p className="font-mono text-xs text-[#8B95A2]">
              Multi-platform bot management — open source
            </p>
          </footer>
        </div>
      </main>
    </div>
  )
}
