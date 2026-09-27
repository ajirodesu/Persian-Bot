import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowRight, Lock } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import { useAdminAuth } from '@/contexts/AdminAuthContext'
import useEmailServiceEnabled from '@/hooks/useEmailServiceEnabled'

interface LoginForm {
  email: string
  password: string
}

interface LoginErrors {
  email?: string
  password?: string
}

export default function AdminLoginPage() {
  const navigate = useNavigate()
  const { login } = useAdminAuth()

  const [form, setForm] = useState<LoginForm>({ email: '', password: '' })
  const [errors, setErrors] = useState<LoginErrors>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const { isEmailEnabled } = useEmailServiceEnabled()

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
      await login(form.email, form.password)
      navigate(ROUTES.ADMIN.DASHBOARD)
    } catch (err) {
      setApiError(
        err instanceof Error ? err.message : 'Login failed. Please try again.',
      )
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-surface text-on-surface min-h-screen flex flex-col">
      <Helmet>
        <title>Admin · Cat-Bot</title>
      </Helmet>

      <main className="flex-1 flex flex-col w-full px-5">
        <div className="flex flex-col w-full items-center justify-between min-h-[calc(100vh-4rem)] py-6">
          <div className="w-full max-w-sm flex flex-col items-center my-auto">
            {/* Lock hero with live indicator */}
            <div className="flex flex-col items-center text-center mb-8">
              <div className="w-16 h-16 rounded-xl bg-surface-container-low border border-hairline flex items-center justify-center mb-4 relative">
                <div className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-primary ring-4 ring-surface" />
                <Lock className="text-primary w-8 h-8" strokeWidth={2} />
              </div>
              <h1 className="text-[28px] font-bold text-on-surface tracking-tight mb-1">
                Admin Access
              </h1>
              <p className="text-sm text-on-surface-variant max-w-[260px] leading-relaxed">
                Restricted to authorised administrators only.
              </p>
            </div>

            {/* Form card */}
            <div className="w-full bg-surface-container-low border border-hairline p-6 rounded-xl flex flex-col gap-4">
              <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
                <Field.Root invalid={!!errors.email} required>
                  <Field.Label>
                    Email
                  </Field.Label>
                  <Input
                    type="email"
                    placeholder="admin@example.com"
                    value={form.email}
                    onChange={handleChange('email')}
                    autoComplete="email"
                    className="h-14 font-mono text-sm"
                  />
                  <Field.ErrorText>{errors.email}</Field.ErrorText>
                </Field.Root>

                <Field.Root invalid={!!errors.password} required>
                  <div className="flex items-center justify-between mb-1.5">
                    <Field.Label className="mb-0">
                      Password
                    </Field.Label>
                    {isEmailEnabled && (
                      <Link
                        to={ROUTES.ADMIN.FORGOT_PASSWORD}
                        className="text-xs text-primary hover:underline"
                      >
                        Forgot password?
                      </Link>
                    )}
                  </div>
                  <PasswordInput
                    placeholder="••••••••••••"
                    value={form.password}
                    onChange={handleChange('password')}
                    autoComplete="current-password"
                    className="h-14 font-mono text-sm"
                  />
                  <Field.ErrorText>{errors.password}</Field.ErrorText>
                </Field.Root>

                {/* Live verification indicator */}
                {isLoading && (
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface">
                    <span className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                    <span className="font-mono text-on-surface-variant text-[11px]">
                      Verifying credentials...
                    </span>
                  </div>
                )}

                {apiError && (
                  <Alert
                    variant="tonal"
                    color="error"
                    title="Access Denied"
                    message={apiError}
                  />
                )}

                <Button
                  type="submit"
                  variant="filled"
                  color="primary"
                  size="lg"
                  fullWidth
                  isLoading={isLoading}
                  rightIcon={<ArrowRight className="h-[18px] w-[18px]" />}
                  className="h-12 rounded-lg text-[15px] font-semibold mt-1"
                >
                  Sign in
                </Button>
              </form>
            </div>
          </div>

          {/* Dedicated admin footer */}
          <footer className="w-full flex flex-col items-center justify-center pt-6 pb-2 text-center">
            <p className="font-mono text-surface-variant text-[11px] tracking-widest uppercase">
              Cat-Bot Admin Portal
            </p>
          </footer>
        </div>
      </main>
    </div>
  )
}
