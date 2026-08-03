import { Helmet } from '@dr.pogodin/react-helmet'
import { useEffect, useState } from 'react'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Card from '@/components/ui/data-display/Card'
import Button from '@/components/ui/buttons/Button'
import Badge from '@/components/ui/data-display/Badge'
import Dialog from '@/components/ui/overlay/Dialog'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import DataList from '@/components/ui/data-display/DataList'
import Divider from '@/components/ui/layout/Divider'
import ThemeToggle from '@/components/ui/ThemeToggle'
import TimezoneSelect from '@/components/ui/forms/TimezoneSelect'
import { useTimezone } from '@/contexts/TimezoneContext'
import { authUserClient } from '@/lib/better-auth-client.lib'
import apiClient from '@/lib/api-client.lib'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'
import { ROUTES } from '@/constants/routes.constants'

// ============================================================================
// Page
// ============================================================================

export default function SettingsPage() {
  const { isEmailEnabled } = useEmailServiceEnabled()

  const { data: session, isPending: sessionLoading } =
    authUserClient.useSession()

  // ── Timezone state ──────────────────────────────────────────────────────────
  const {
    timezone: activeTimezone,
    savedTimezone,
    browserTimezone,
    isLoading: timezoneLoading,
    setTimezone: persistTimezone,
  } = useTimezone()
  const [timezoneDraft, setTimezoneDraft] = useState<string | null>(null)

  const timezoneValue = timezoneDraft ?? activeTimezone
  const timezoneDirty = timezoneDraft !== null && timezoneDraft !== savedTimezone

  // ── Profile state ──────────────────────────────────────────────────────────
  const [profileName, setProfileName] = useState('')
  const [nameInitialized, setNameInitialized] = useState(false)

  if (session?.user?.name && !nameInitialized) {
    setProfileName(session.user.name)
    setNameInitialized(true)
  }

  const profileDirty =
    nameInitialized &&
    profileName.trim() !== '' &&
    profileName.trim() !== (session?.user?.name ?? '')

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

  // ── Delete account state ───────────────────────────────────────────────────
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDeleteAccount = async (): Promise<void> => {
    if (!deletePassword) {
      setDeleteError('Enter your password to confirm deletion')
      return
    }
    setDeleteError(null)
    setIsDeleting(true)

    // Password is required here because the /delete-user route only accepts
    // the request without it when the session is younger than 1 day
    // (sensitiveSessionMiddleware). The full data wipe runs server-side via
    // the deleteUser beforeDelete hook.
    const { error } = await authUserClient.deleteUser({
      password: deletePassword,
    })

    if (error) {
      setDeleteError(error.message ?? 'Failed to delete account')
      setIsDeleting(false)
      return
    }

    // better-auth clears the session cookie on success — hard-redirect so the
    // auth state provider re-mounts cleanly on the public route.
    window.location.assign(ROUTES.LOGIN)
  }

  // ── Groq API key state ───────────────────────────────────────────────────
  const [groqStatus, setGroqStatus] = useState<{
    hasKey: boolean
    keyHint: string | null
  } | null>(null)
  const [groqLoading, setGroqLoading] = useState(true)
  const [groqKeyInput, setGroqKeyInput] = useState('')
  const [groqEditing, setGroqEditing] = useState(false)
  const [groqRemoving, setGroqRemoving] = useState(false)
  const [groqRemoveError, setGroqRemoveError] = useState<string | null>(null)

  // Fetch the current key status once on mount — the API never returns the key
  // itself, only whether one exists and a 4-char hint.
  useEffect(() => {
    let cancelled = false
    apiClient
      .get<{ hasKey: boolean; keyHint: string | null }>(
        '/api/v1/settings/groq-key',
      )
      .then((res) => {
        if (!cancelled) setGroqStatus(res.data)
      })
      .catch(() => {
        if (!cancelled) setGroqStatus({ hasKey: false, keyHint: null })
      })
      .finally(() => {
        if (!cancelled) setGroqLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const groqDirty =
    (groqEditing || !groqStatus?.hasKey) && groqKeyInput.trim() !== ''

  const handleRemoveGroqKey = async (): Promise<void> => {
    setGroqRemoveError(null)
    setGroqRemoving(true)
    try {
      await apiClient.delete('/api/v1/settings/groq-key')
      setGroqStatus({ hasKey: false, keyHint: null })
      setGroqEditing(false)
      setGroqKeyInput('')
    } catch {
      setGroqRemoveError('Failed to remove Groq API key')
    } finally {
      setGroqRemoving(false)
    }
  }

  // ── Unified save — Timezone + AI key + Profile ──────────────────────────────
  const hasUnsavedChanges = timezoneDirty || profileDirty || groqDirty
  const [isSavingAll, setIsSavingAll] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveSuccess, setSaveSuccess] = useState(false)

  const handleSaveChanges = async (): Promise<void> => {
    setSaveError(null)
    setSaveSuccess(false)
    setIsSavingAll(true)
    try {
      if (timezoneDirty && timezoneDraft) {
        await persistTimezone(timezoneDraft)
      }
      if (profileDirty) {
        const { error } = await authUserClient.updateUser({
          name: profileName.trim(),
        })
        if (error) throw new Error(error.message ?? 'Failed to update profile')
      }
      if (groqDirty) {
        const res = await apiClient.put<{ hasKey: boolean; keyHint: string }>(
          '/api/v1/settings/groq-key',
          { apiKey: groqKeyInput.trim() },
        )
        setGroqStatus(res.data)
        setGroqKeyInput('')
        setGroqEditing(false)
      }
      setTimezoneDraft(null)
      setSaveSuccess(true)
      setTimeout(() => setSaveSuccess(false), 3000)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setSaveError(
        e.response?.data?.error ??
          (err instanceof Error ? err.message : 'Failed to save changes'),
      )
    } finally {
      setIsSavingAll(false)
    }
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
              Select the interface theme. Choose only one option: Aqua, Burnt, or Indigo.
            </Card.Description>
          </div>
        </Card.Header>
        <ThemeToggle />
      </Card.Root>

      {/* ── Timezone ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div className="flex items-start justify-between w-full">
            <div>
              <Card.Title as="h2">Timezone</Card.Title>
              <Card.Description>
                Used across the dashboard for timestamps, logs, and bot
                notices — like ban messages sent on your behalf.
              </Card.Description>
            </div>
            {timezoneDirty && (
              <Badge color="primary" size="sm" variant="tonal" pill>
                Unsaved
              </Badge>
            )}
          </div>
        </Card.Header>

        {timezoneLoading ? (
          <Skeleton className="h-11 w-full max-w-sm rounded-[var(--radius-input)]" />
        ) : (
          <div className="flex flex-col gap-4">
            <Field.Root className="max-w-sm">
              <TimezoneSelect
                value={timezoneValue}
                onChange={(tz) => {
                  setTimezoneDraft(tz)
                }}
              />
            </Field.Root>

            {!savedTimezone && !timezoneDirty && (
              <p className="text-body-sm text-on-surface-variant">
                No timezone saved yet — currently showing your browser's
                timezone ({browserTimezone}). Pick one and click Save
                Changes below.
              </p>
            )}
          </div>
        )}
      </Card.Root>

      {/* ── AI Integration ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div className="flex items-start justify-between w-full">
            <div>
              <Card.Title as="h2">AI Integration</Card.Title>
              <Card.Description>
                AI features run on your own Groq API key. The key is stored
                encrypted and used only by your bots.
              </Card.Description>
            </div>
            {groqDirty && (
              <Badge color="primary" size="sm" variant="tonal" pill>
                Unsaved
              </Badge>
            )}
          </div>
        </Card.Header>

        <div className="flex flex-col gap-4">
          {groqLoading ? (
            <Skeleton textSize="body-sm" width="60%" />
          ) : groqStatus?.hasKey ? (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface-container-highest/40 rounded-[var(--radius-card)] border border-outline-variant/50">
              <div>
                <p className="text-label-lg font-semibold text-on-surface">
                  Groq API key connected
                </p>
                <p className="text-body-sm text-on-surface-variant">
                  Ending in{' '}
                  <span className="font-mono font-semibold text-on-surface">
                    {groqStatus.keyHint ? `…${groqStatus.keyHint}` : '—'}
                  </span>
                </p>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <Button
                  variant="tonal"
                  color="primary"
                  size="sm"
                  onClick={() => setGroqEditing(true)}
                  disabled={groqRemoving}
                >
                  Replace
                </Button>
                <Button
                  variant="tonal"
                  color="error"
                  size="sm"
                  onClick={() => {
                    void handleRemoveGroqKey()
                  }}
                  disabled={groqRemoving}
                  isLoading={groqRemoving}
                >
                  Remove
                </Button>
              </div>
            </div>
          ) : (
            <Alert
              variant="tonal"
              color="warning"
              title="AI features are disabled"
              message="No Groq API key is configured for your account. AI features won't work until you add your own key below."
            />
          )}

          {(groqEditing || !groqStatus?.hasKey) && (
            <Field.Root>
              <Field.Label>Groq API key</Field.Label>
              <PasswordInput
                value={groqKeyInput}
                onChange={(e) => {
                  setGroqKeyInput(e.target.value)
                }}
                placeholder="gsk_…"
              />
              <p className="mt-1.5 text-body-sm text-on-surface-variant">
                Enter your key, then click Save Changes below.
              </p>
            </Field.Root>
          )}

          {groqRemoveError && (
            <Alert
              variant="tonal"
              color="error"
              title={groqRemoveError}
              size="sm"
            />
          )}
        </div>
      </Card.Root>

      {/* ── Profile ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-outline-variant/60"
      >
        <Card.Header>
          <div className="flex items-start justify-between w-full">
            <div>
              <Card.Title as="h2">Profile</Card.Title>
              <Card.Description>
                Update your display name and account information.
              </Card.Description>
            </div>
            {profileDirty && (
              <Badge color="primary" size="sm" variant="tonal" pill>
                Unsaved
              </Badge>
            )}
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
            <Input
              value={profileName}
              onChange={(e) => {
                setProfileName(e.target.value)
              }}
              placeholder={sessionLoading ? 'Loading…' : 'Your name'}
              disabled={sessionLoading}
            />
          </Field.Root>
        </div>
      </Card.Root>

      {/* ── Unified save bar — Timezone + AI Integration + Profile ── */}
      <div className="flex items-start gap-3">
        <div className="flex-1">
          {saveError && <p className="text-body-sm text-error">{saveError}</p>}
          {saveSuccess && (
            <p className="text-body-sm text-success">
              Changes saved successfully.
            </p>
          )}
        </div>
        <Button
          variant="filled"
          color="primary"
          onClick={() => void handleSaveChanges()}
          disabled={!hasUnsavedChanges || isSavingAll}
          isLoading={isSavingAll}
        >
          Save Changes
        </Button>
      </div>

      <Divider spacing="sm" />

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
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface-container-highest/40 rounded-[var(--radius-card)] border border-outline-variant/50">
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

      {/* ── Danger Zone ── */}
      <Card.Root
        variant="elevated"
        shadowElevation={1}
        padding="md"
        className="border border-error/50"
      >
        <Card.Header>
          <div>
            <Card.Title as="h2">Danger Zone</Card.Title>
            <Card.Description>
              Permanently delete your account and all associated data.
            </Card.Description>
          </div>
        </Card.Header>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <p className="text-body-sm text-on-surface-variant">
            Deleting your account permanently removes your profile, chats,
            sessions, and connected bot credentials. This action cannot be
            undone.
          </p>
          <Button
            variant="tonal"
            color="error"
            size="md"
            className="flex-shrink-0"
            onClick={() => {
              setDeletePassword('')
              setDeleteError(null)
              setDeleteDialogOpen(true)
            }}
          >
            Delete Account
          </Button>
        </div>
      </Card.Root>

      {/* Delete account confirmation dialog — requires the current password
          (the /delete-user route only skips it for sessions younger than 1 day). */}
      <Dialog.Root
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteDialogOpen(false)
        }}
        closeOnEsc={!isDeleting}
        closeOnOverlayClick={!isDeleting}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Delete account?</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-sm text-on-surface-variant">
                This permanently deletes your account, chat history, sessions,
                and connected bot credentials. This action cannot be undone.
              </p>
              <Field.Root>
                <Field.Label>Confirm password</Field.Label>
                <PasswordInput
                  value={deletePassword}
                  onChange={(e) => {
                    setDeletePassword(e.target.value)
                    setDeleteError(null)
                  }}
                  placeholder="Enter your password"
                  disabled={isDeleting}
                />
              </Field.Root>
              {deleteError && (
                <Alert
                  variant="tonal"
                  color="error"
                  title={deleteError}
                  size="sm"
                />
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button
                  variant="text"
                  color="neutral"
                  size="sm"
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                color="error"
                size="sm"
                onClick={() => {
                  void handleDeleteAccount()
                }}
                isLoading={isDeleting}
                disabled={isDeleting || !deletePassword}
              >
                Delete account
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </div>
  )
}
