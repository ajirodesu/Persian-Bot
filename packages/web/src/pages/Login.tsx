import { Helmet } from '@dr.pogodin/react-helmet'
import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import { ROUTES } from '@/constants/routes.constants'
import { useUserAuth } from '@/contexts/UserAuthContext'
import Checkbox from '@/components/ui/forms/Checkbox'
import Logo from '@/components/ui/Logo'
import useEmailServiceEnabled from '@/hooks/useEmailServiceEnabled'

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

  const [form, setForm] = useState<LoginForm>({ email: '', password: '' })
  const [errors, setErrors] = useState<LoginErrors>({})
  const [apiError, setApiError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)

  const { isEmailEnabled } = useEmailServiceEnabled()

  const validate = (): LoginErrors => {
    const e: LoginErrors = {}
    if (!form.email) e.email = 'Email is required.'
    else if (!/\S+@\S+\.\S+/.test(form.email)) e.email = 'Enter a valid email address.'
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
      const msg = err instanceof Error ? err.message : 'Login failed. Please try again.'
      if (msg.toLowerCase().includes('verif')) {
        navigate(`${ROUTES.ACCOUNT_VERIFICATION}?email=${encodeURIComponent(form.email)}`)
        return
      }
      setApiError(msg)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="bg-[#0A0C0E] text-[#F1F4F8] min-h-[calc(100vh-48px)] flex flex-col">
      <Helmet>
        <title>Log In · Cat-Bot</title>
      </Helmet>

      <main className="flex-1 flex flex-col w-full max-w-sm mx-auto px-5 pb-8">
        <div className="flex flex-col w-full my-auto py-10">
          {/* Hero */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="relative w-16 h-16 rounded-xl bg-[#13161A] border border-[#242930] flex items-center justify-center mb-4">
              <div className="absolute inset-0 rounded-xl bg-[#10B981]/10" />
              <Logo className="w-8 h-8 text-[#10B981] relative z-10" />
            </div>
            <h1 className="text-[32px] font-bold text-[#F1F4F8] tracking-tight mb-1">
              Welcome back
            </h1>
            <p className="text-sm text-[#8B95A2] max-w-xs leading-relaxed">
              Sign in to manage your bots across Discord, Telegram, and Fluxer.
            </p>
          </div>

          {/* Form card */}
          <div className="w-full bg-[#13161A] border border-[#242930] rounded-xl p-6 flex flex-col gap-5">
            <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
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
                  className="h-14"
                />
                <Field.ErrorText>{errors.email}</Field.ErrorText>
              </Field.Root>

              <Field.Root invalid={!!errors.password} required>
                <div className="flex items-center justify-between mb-1.5">
                  <Field.Label className="mb-0">
                    Password <span className="text-[#EF4444]">*</span>
                  </Field.Label>
                  {isEmailEnabled && (
                    <Link
                      to={ROUTES.FORGOT_PASSWORD}
                      className="text-xs text-[#10B981] hover:underline"
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
                  className="h-14"
                />
                <Field.ErrorText>{errors.password}</Field.ErrorText>
              </Field.Root>

              <div className="flex items-center justify-between py-1">
                <Checkbox label="Remember me" checked={rememberMe} onChange={setRememberMe} />
              </div>

              {apiError && (
                <Alert variant="tonal" color="error" title="Login Failed" message={apiError} />
              )}

              <Button
                type="submit"
                variant="filled"
                color="primary"
                size="lg"
                fullWidth
                isLoading={isLoading}
                rightIcon={<ArrowRight className="h-[18px] w-[18px]" />}
                className="h-12 rounded-lg text-[15px] font-semibold"
              >
                Log in
              </Button>
            </form>
          </div>

          {/* Redirect */}
          <div className="flex items-center justify-center py-6 text-center">
            <p className="text-sm text-[#8B95A2]">
              Don&apos;t have an account?
              <Button
                as={Link}
                to={ROUTES.SIGNUP}
                variant="link"
                color="primary"
                size="sm"
                className="ml-1 font-semibold"
              >
                Sign up free
              </Button>
            </p>
          </div>

          {/* Mini footer */}
          <div className="flex flex-col items-center justify-center gap-1 text-center">
            <div className="flex items-center gap-1.5 text-[#8B95A2]">
              <Logo className="w-4 h-4" />
              <span className="text-[15px] font-semibold">Cat-Bot</span>
            </div>
            <span className="text-xs text-[#5D6775]">
              Multi-platform bot management — open source
            </span>
          </div>
        </div>
      </main>
    </div>
  )
}
