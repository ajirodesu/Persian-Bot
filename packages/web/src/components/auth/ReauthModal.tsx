/**
 * Author: AjiroDesu
 *
 * In-place re-authentication.
 *
 * When a session expires — during idle, overnight, or on return from a
 * backgrounded phone — the dashboard stays mounted underneath this dialog
 * with its last known data. Signing in here resumes the same page instead of
 * redirecting to `/login` and losing the user's context.
 *
 * The password lives only in React state: it is never written to storage,
 * never put in the URL, and is cleared as soon as the dialog closes.
 */
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { KeyRound } from 'lucide-react'
import Dialog from '@/components/ui/overlay/Dialog'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Input from '@/components/ui/forms/Input'
import Alert from '@/components/ui/feedback/Alert'
import Button from '@/components/ui/buttons/Button'
import { useUserAuth } from '@/contexts/UserAuthContext'
import { ROUTES } from '@/constants/routes.constants'

export default function ReauthModal() {
  const { lastKnownUser, login, acknowledgeReauth, sessionExpired } =
    useUserAuth()
  const [email, setEmail] = useState(lastKnownUser?.email ?? '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const open = sessionExpired && lastKnownUser !== null

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !password) {
      setError('Enter your email and password.')
      return
    }
    setIsSubmitting(true)
    setError(null)
    try {
      await login(email.trim(), password)
      acknowledgeReauth()
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed. Try again.')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog.Root open={open} closeOnEsc={false} closeOnOverlayClick={false}>
      <Dialog.Positioner position="center">
        <Dialog.Backdrop />
        <Dialog.Content size="sm">
          <Dialog.Header>
            <div className="flex flex-col gap-1.5">
              <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-on-surface-variant">
                <KeyRound aria-hidden="true" className="h-4 w-4 text-primary" />
                SESSION EXPIRED
              </span>
              <Dialog.Title>Sign in to resume</Dialog.Title>
            </div>
          </Dialog.Header>

          <Dialog.Body>
            <p className="mb-4 text-body-sm text-on-surface-variant">
              Your dashboard and its last saved data are still here. Sign in
              again to keep working without losing your place.
            </p>

            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant">
                  Email
                </span>
                <Input
                  type="email"
                  value={email}
                  autoComplete="email"
                  onChange={(event) => setEmail(event.target.value)}
                  className="h-11"
                  required
                />
              </label>

              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant">
                  Password
                </span>
                <PasswordInput
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => setPassword(event.target.value)}
                  className="h-11"
                  required
                />
              </label>

              {error && (
                <Alert
                  variant="outlined"
                  color="error"
                  size="sm"
                  title="Sign-in failed"
                  message={error}
                />
              )}

              <Button
                type="submit"
                variant="filled"
                color="primary"
                size="lg"
                isLoading={isSubmitting}
                fullWidth
                className="h-11"
              >
                {isSubmitting ? 'Signing in' : 'Resume session'}
              </Button>
            </form>
          </Dialog.Body>

          <Dialog.Footer>
            <div className="flex w-full flex-wrap items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-on-surface-variant/80">
                Data is preserved locally
              </span>
              <Link
                to={ROUTES.LOGIN}
                className="inline-flex min-h-9 items-center font-mono text-[10px] uppercase tracking-[0.14em] text-primary underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                Use the sign-in page
              </Link>
            </div>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}

