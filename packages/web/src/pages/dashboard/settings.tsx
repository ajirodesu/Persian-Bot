import { Helmet } from '@dr.pogodin/react-helmet'
import { useState } from 'react'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Card from '@/components/ui/data-display/Card'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import DataList from '@/components/ui/data-display/DataList'
import Divider from '@/components/ui/layout/Divider'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { authUserClient } from '@/lib/better-auth-client.lib'
import apiClient from '@/lib/api-client.lib'

// ============================================================================
// Page
// ============================================================================

export default function SettingsPage() {
  const isEmailEnabled = import.meta.env.VITE_EMAIL_SERVICES_ENABLE === 'true'

  const { data: session, isPending: sessionLoading } =
    authUserClient.useSession()

  // ── Profile state ──────────────────────────────────────────────────────────
  const [profileName, setProfileName] = useState('')
  const [nameInitialized, setNameInitialized] = useState(false)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSuccess, setProfileSuccess] = useState(false)

  if (session?.user?.name && !nameInitialized) {
    setProfileName(session.user.name)
    setNameInitialized(true)
  }

  const handleUpdateProfile = async (): Promise<void> => {
    if (!profileName.trim()) {
      setProfileError('Name cannot be empty')
      return
    }
    setProfileSaving(true)
    setProfileError(null)
    setProfileSuccess(false)

    const { error } = await authUserClient.updateUser({
      name: profileName.trim(),
    })
    if (error) {
      setProfileError(error.message ?? 'Failed to update profile')
    } else {
      setProfileSuccess(true)
      setTimeout(() => setProfileSuccess(false), 3000)
    }
    setProfileSaving(false)
  }

  // ── Password state ─────────────────────────────────────────────────────────
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [resetSent, setResetSent] = useState(false)

  const handleChangePassword = async (): Promise<void> => {
    setPasswordError(null)
    setPasswordSuccess(false)

    if (newPassword !== confirmPassword) {
      setPasswordError('New passwords do not match')
      return
    }
    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters')
      return
    }

    setPasswordSaving(true)
    const { error } = await authUserClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    })

    if (error) {
      setPasswordError(error.message ?? 'Failed to change password')
    } else {
      setPasswordSuccess(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setTimeout(() => setPasswordSuccess(false), 3000)
    }
    setPasswordSaving(false)
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl pb-12">
      <Helmet>
        <title>Settings · Cat-Bot</title>
      </Helmet>

      {/* Page header */}
      <div>
        <h1 className="text-headline-sm font-bold text-on-surface tracking-tight">
          Settings
        </h1>
        <p className="mt-1 text-body-sm text-on-surface-variant">
          Manage your profile and account security.
        </p>
      </div>

      {/* ── Appearance ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div>
            <Card.Title as="h2">Appearance</Card.Title>
            <Card.Description>
              Choose the interface theme. Winter is the new default; Summer
              is the original look.
            </Card.Description>
          </div>
        </Card.Header>
        <ThemeToggle />
      </Card.Root>

      {/* ── Profile ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div>
            <Card.Title as="h2">Profile</Card.Title>
            <Card.Description>
              Update your display name and account information.
            </Card.Description>
          </div>
        </Card.Header>

        <div className="flex flex-col gap-5">
          {/* Email — display only */}
          <DataList.Root size="sm">
            <DataList.Item>
              <DataList.ItemLabel>Email</DataList.ItemLabel>
              <DataList.ItemValue>
                {sessionLoading ? (
                  <Skeleton textSize="body-sm" width="55%" />
                ) : (
                  <span className="text-body-sm font-medium text-on-surface">
                    {session?.user?.email ?? '—'}
                  </span>
                )}
              </DataList.ItemValue>
            </DataList.Item>
          </DataList.Root>

          {/* Editable display name */}
          <Field.Root>
            <Field.Label>Display name</Field.Label>
            <div className="flex gap-2">
              <Input
                value={profileName}
                onChange={(e) => {
                  setProfileName(e.target.value)
                  setProfileError(null)
                  setProfileSuccess(false)
                }}
                placeholder={sessionLoading ? 'Loading…' : 'Your name'}
                disabled={sessionLoading || profileSaving}
              />
              <Button
                variant="tonal"
                color="primary"
                size="md"
                onClick={() => {
                  void handleUpdateProfile()
                }}
                disabled={sessionLoading || profileSaving}
                isLoading={profileSaving}
                className="flex-shrink-0"
              >
                Save
              </Button>
            </div>
          </Field.Root>

          {profileError && (
            <Alert variant="tonal" color="error" title={profileError} size="sm" />
          )}
          {profileSuccess && (
            <Alert
              variant="tonal"
              color="success"
              title="Profile updated successfully."
              size="sm"
            />
          )}
        </div>
      </Card.Root>

      {/* ── Security ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div>
            <Card.Title as="h2">Security</Card.Title>
            <Card.Description>
              Change your password. All other sessions will be signed out on
              success.
            </Card.Description>
          </div>
        </Card.Header>

        <div className="flex flex-col gap-4">
          {isEmailEnabled && (
            <>
              {/* Quick reset link shortcut */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface-container-highest/40 rounded-xl border border-outline-variant/50">
                <div>
                  <p className="text-label-lg font-semibold text-on-surface">
                    Password Reset
                  </p>
                  <p className="text-body-sm text-on-surface-variant">
                    Send a secure reset link to your email address.
                  </p>
                </div>
                <Button
                  variant="tonal"
                  color="primary"
                  size="sm"
                  onClick={async () => {
                    setResetSent(true)
                    await apiClient.post(
                      '/api/v1/validate/reset-password/request',
                      {
                        email: session?.user?.email || '',
                        adminOnly: false,
                      },
                    )
                  }}
                  disabled={resetSent}
                >
                  {resetSent ? 'Link Sent' : 'Send Reset Link'}
                </Button>
              </div>
              {resetSent && (
                <Alert
                  variant="tonal"
                  color="success"
                  title="Check your email"
                  message="We've sent you a secure link to reset your password."
                  size="sm"
                />
              )}
              <Divider spacing="sm" />
            </>
          )}

          <Field.Root>
            <Field.Label>Current password</Field.Label>
            <PasswordInput
              value={currentPassword}
              onChange={(e) => {
                setCurrentPassword(e.target.value)
                setPasswordError(null)
              }}
              placeholder="Enter current password"
              disabled={passwordSaving}
            />
          </Field.Root>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field.Root>
              <Field.Label>New password</Field.Label>
              <PasswordInput
                value={newPassword}
                onChange={(e) => {
                  setNewPassword(e.target.value)
                  setPasswordError(null)
                }}
                placeholder="At least 8 characters"
                disabled={passwordSaving}
              />
            </Field.Root>

            <Field.Root>
              <Field.Label>Confirm new password</Field.Label>
              <PasswordInput
                value={confirmPassword}
                onChange={(e) => {
                  setConfirmPassword(e.target.value)
                  setPasswordError(null)
                }}
                placeholder="Repeat new password"
                disabled={passwordSaving}
              />
            </Field.Root>
          </div>

          {passwordError && (
            <Alert
              variant="tonal"
              color="error"
              title={passwordError}
              size="sm"
            />
          )}
          {passwordSuccess && (
            <Alert
              variant="tonal"
              color="success"
              title="Password changed successfully."
              message="All other sessions have been signed out."
              size="sm"
            />
          )}

          <div className="flex justify-end pt-1">
            <Button
              variant="filled"
              color="primary"
              size="sm"
              onClick={() => {
                void handleChangePassword()
              }}
              disabled={
                passwordSaving ||
                !currentPassword ||
                !newPassword ||
                !confirmPassword
              }
              isLoading={passwordSaving}
            >
              Change password
            </Button>
          </div>
        </div>
      </Card.Root>
    </div>
  )
}
