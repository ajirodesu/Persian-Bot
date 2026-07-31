import { Helmet } from '@dr.pogodin/react-helmet'
import { useEffect, useState } from 'react'
import Card from '@/components/ui/data-display/Card'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import PasswordInput from '@/components/ui/forms/PasswordInput'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import DataList from '@/components/ui/data-display/DataList'
import Divider from '@/components/ui/layout/Divider'
import ThemeToggle from '@/components/ui/ThemeToggle'
import { authAdminClient } from '@/lib/better-auth-admin-client.lib'
import { Plus, Trash2, TriangleAlert } from 'lucide-react'
import Dialog from '@/components/ui/overlay/Dialog'
import { adminService } from '@/features/admin/services/admin.service'
import type { SystemAdminDto } from '@/features/admin/services/admin.service'
import { RESET_ALL_DATABASE_CONFIRMATION_PHRASE } from '@/features/admin/services/admin.service'
import apiClient from '@/lib/api-client.lib'
import { useEmailServiceEnabled } from '@/hooks/useEmailServiceEnabled'
import { useSnackbar } from '@/contexts/SnackbarContext'

/** Max length mirrored from the server-side validator in admin.controller.ts — client-side is a UX convenience, the server is the source of truth. */
const SYSTEM_ADMIN_ID_MAX_LENGTH = 128

/** Extracts the backend's `{ error }` message from a failed apiClient call, falling back to a status-aware default. */
function extractApiError(err: unknown, fallback: string): string {
  const e = err as {
    response?: { status?: number; data?: { error?: string } }
    message?: string
  }
  if (e.response?.status === 401) {
    return 'Your session has expired. Please sign in again.'
  }
  if (e.response?.status === 403) {
    return 'You do not have permission to perform this action.'
  }
  return e.response?.data?.error || (err instanceof Error ? err.message : fallback)
}

/**
 * AdminSettingsPage
 *
 * System Admins section now persists to and loads from /api/v1/admin/system-admins
 * so registered IDs survive server restarts and are visible to all admin accounts.
 */
export default function AdminSettingsPage() {
  const { isEmailEnabled } = useEmailServiceEnabled()

  const { data: session, isPending: sessionLoading } =
    authAdminClient.useSession()
  const { snackbar } = useSnackbar()

  // ── Profile edit state ─────────────────────────────────────────────────────
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
    const { error } = await authAdminClient.updateUser({
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

  // ── Password change state ──────────────────────────────────────────────────
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
    const { error } = await authAdminClient.changePassword({
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

  // ── System Admins — real API ───────────────────────────────────────────────
  const [systemAdmins, setSystemAdmins] = useState<SystemAdminDto[]>([])
  const [adminIds, setAdminIds] = useState<string[]>([''])
  const [adminLoading, setAdminLoading] = useState(true)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [adminSaving, setAdminSaving] = useState(false)
  const [adminSuccess, setAdminSuccess] = useState(false)

  // Reloads the authoritative list from the database — always the last step of any
  // mutation, win or lose, so the dashboard never drifts from what's actually stored.
  const reloadSystemAdmins = async (): Promise<void> => {
    const result = await adminService.getSystemAdmins()
    setSystemAdmins(result.admins)
    setAdminIds(
      result.admins.length > 0 ? result.admins.map((a) => a.adminId) : [''],
    )
  }

  // Load persisted system admins on mount
  useEffect(() => {
    const load = async () => {
      try {
        await reloadSystemAdmins()
      } catch (err) {
        setAdminError(extractApiError(err, 'Failed to load system admins'))
      } finally {
        setAdminLoading(false)
      }
    }
    void load()
  }, [])

  const handleAdminChange = (index: number, value: string) => {
    setAdminIds((prev) => {
      const ids = [...prev]
      ids[index] = value
      return ids
    })
    setAdminError(null)
    setAdminSuccess(false)
  }

  const handleAddAdminRow = () => {
    setAdminIds((prev) => [...prev, ''])
  }

  const handleRemoveAdminRow = (index: number) => {
    setAdminIds((prev) =>
      prev.length > 1 ? prev.filter((_, i) => i !== index) : prev,
    )
  }

  // ── Client-side validation (UX convenience; admin.controller.ts re-validates
  //    everything server-side and is the actual source of truth) ──────────────
  const trimmedAdminIds = adminIds.map((id) => id.trim())
  const tooLongIndexes = new Set(
    trimmedAdminIds
      .map((id, i) => (id.length > SYSTEM_ADMIN_ID_MAX_LENGTH ? i : -1))
      .filter((i) => i !== -1),
  )
  // Rows whose (trimmed, non-empty) value repeats an earlier row — flagged so the
  // admin can see and fix a typo'd duplicate before it ever reaches the server.
  const duplicateIndexes = new Set<number>()
  {
    const seen = new Set<string>()
    trimmedAdminIds.forEach((id, i) => {
      if (!id) return
      if (seen.has(id)) duplicateIndexes.add(i)
      seen.add(id)
    })
  }
  const hasClientValidationErrors = tooLongIndexes.size > 0

  // Compute diff to determine if a save is needed and what to dispatch
  const targetIds = Array.from(
    new Set(trimmedAdminIds.filter((id) => id !== '')),
  )
  const currentIds = systemAdmins.map((a) => a.adminId)
  const isAdminsModified =
    targetIds.length !== currentIds.length ||
    targetIds.some((id) => !currentIds.includes(id)) ||
    currentIds.some((id) => !targetIds.includes(id))

  const handleSaveAdmins = async (): Promise<void> => {
    if (hasClientValidationErrors) {
      setAdminError(
        `System admin IDs must be ${SYSTEM_ADMIN_ID_MAX_LENGTH} characters or fewer.`,
      )
      return
    }

    setAdminSaving(true)
    setAdminError(null)
    setAdminSuccess(false)

    const toAdd = targetIds.filter((id) => !currentIds.includes(id))
    const toRemove = currentIds.filter((id) => !targetIds.includes(id))

    // Run sequentially (not Promise.all) to avoid DB lock contention from concurrent
    // writes to the same table, but track each operation's outcome independently so
    // one failure doesn't hide or roll back the others — every operation gets its
    // own clear success/error notification.
    const failures: { id: string; action: 'add' | 'remove'; message: string }[] = []
    let addedCount = 0
    let removedCount = 0

    for (const id of toRemove) {
      try {
        await adminService.removeSystemAdmin(id)
        removedCount++
      } catch (err) {
        const message = extractApiError(err, 'Failed to remove system admin')
        failures.push({ id, action: 'remove', message })
        snackbar({
          message: `Failed to remove "${id}": ${message}`,
          color: 'error',
          duration: 5000,
        })
      }
    }

    for (const id of toAdd) {
      try {
        await adminService.addSystemAdmin(id)
        addedCount++
      } catch (err) {
        const message = extractApiError(err, 'Failed to add system admin')
        failures.push({ id, action: 'add', message })
        snackbar({
          message: `Failed to add "${id}": ${message}`,
          color: 'error',
          duration: 5000,
        })
      }
    }

    // Always resync with the database afterward, whether every op succeeded or not —
    // the DB is the source of truth and the form must reflect exactly what's stored.
    try {
      await reloadSystemAdmins()
    } catch (err) {
      setAdminError(extractApiError(err, 'Failed to refresh system admins'))
    }

    if (failures.length === 0) {
      const parts: string[] = []
      if (addedCount > 0) parts.push(`${addedCount} added`)
      if (removedCount > 0) parts.push(`${removedCount} removed`)
      snackbar({
        message:
          parts.length > 0
            ? `System administrators updated — ${parts.join(', ')}.`
            : 'System administrators updated successfully.',
        color: 'success',
        duration: 4000,
      })
      setAdminSuccess(true)
      setTimeout(() => setAdminSuccess(false), 3000)
    } else {
      setAdminError(
        `${failures.length} operation${failures.length > 1 ? 's' : ''} failed. Successful changes were saved; failed rows remain editable above.`,
      )
    }

    setAdminSaving(false)
  }

  // ── Reset All Database — destructive, admin-only ─────────────────────────────
  const [resetDialogOpen, setResetDialogOpen] = useState(false)
  const [resetConfirmInput, setResetConfirmInput] = useState('')
  const [isResetting, setIsResetting] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetSuccess, setResetSuccess] = useState(false)

  const openResetDialog = () => {
    setResetDialogOpen(true)
    setResetConfirmInput('')
    setResetError(null)
  }

  const closeResetDialog = () => {
    if (isResetting) return
    setResetDialogOpen(false)
    setResetConfirmInput('')
    setResetError(null)
  }

  const isResetConfirmed =
    resetConfirmInput === RESET_ALL_DATABASE_CONFIRMATION_PHRASE

  const handleResetAllDatabase = async (): Promise<void> => {
    if (!isResetConfirmed) return
    setIsResetting(true)
    setResetError(null)
    try {
      await adminService.resetAllDatabase(resetConfirmInput)
      setResetDialogOpen(false)
      setResetConfirmInput('')
      setResetSuccess(true)
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setResetError(
        e.response?.data?.error ||
          (err instanceof Error ? err.message : 'Failed to reset database'),
      )
    } finally {
      setIsResetting(false)
    }
  }

  return (
    <div className="flex flex-col gap-6 max-w-2xl mx-auto pb-12">
      <Helmet>
        <title>Admin Settings · Cat-Bot</title>
      </Helmet>

      <div>
        <h1 className="text-headline-md font-semibold text-on-surface">
          Settings
        </h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Manage your admin profile and interface preferences.
        </p>
      </div>

      {/* ── Appearance ── */}
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
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

      {/* ── Profile ── */}
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div>
            <Card.Title as="h2">Admin Profile</Card.Title>
            <Card.Description>Update your display name.</Card.Description>
          </div>
        </Card.Header>
        <div className="flex flex-col gap-5">
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
            <Alert
              variant="tonal"
              color="error"
              title={profileError}
              size="sm"
            />
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

      {/* ── System Administrators ── */}
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div className="flex items-start justify-between w-full">
            <div>
              <Card.Title as="h2">System Administrators</Card.Title>
              <Card.Description>
                The absolute highest authority role in Cat-Bot. System
                Administrators bypass all command role restrictions and ban
                checks.
              </Card.Description>
            </div>
            <Button
              variant="text"
              color="primary"
              size="sm"
              leftIcon={<Plus className="h-3.5 w-3.5" />}
              onClick={handleAddAdminRow}
              disabled={adminSaving || adminLoading}
              aria-label="Add another system admin user ID"
            >
              Add
            </Button>
          </div>
        </Card.Header>
        <div className="flex flex-col gap-3">
          {adminLoading ? (
            <div className="flex flex-col gap-2">
              {[1, 2].map((i) => (
                <div
                  key={i}
                  className="h-10 rounded-xl bg-surface-container animate-pulse"
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {adminIds.map((adminId, index) => {
                const rowInvalid =
                  tooLongIndexes.has(index) || duplicateIndexes.has(index)
                return (
                  <div key={index} className="flex items-start gap-2">
                    <div className="flex-1">
                      <Field.Root invalid={rowInvalid}>
                        <Input
                          placeholder={`System admin user ID ${index + 1}`}
                          value={adminId}
                          onChange={(e) =>
                            handleAdminChange(index, e.target.value)
                          }
                          disabled={adminSaving}
                          aria-label={`System admin user ID ${index + 1}`}
                        />
                        {tooLongIndexes.has(index) && (
                          <Field.ErrorText>
                            Must be {SYSTEM_ADMIN_ID_MAX_LENGTH} characters or
                            fewer.
                          </Field.ErrorText>
                        )}
                        {!tooLongIndexes.has(index) &&
                          duplicateIndexes.has(index) && (
                            <Field.ErrorText>
                              Duplicate — already entered above.
                            </Field.ErrorText>
                          )}
                      </Field.Root>
                    </div>
                    {adminIds.length > 1 && (
                      <Button
                        variant="text"
                        color="error"
                        iconOnly
                        onClick={() => handleRemoveAdminRow(index)}
                        aria-label={`Remove system admin ${index + 1}`}
                        leftIcon={<Trash2 className="h-4 w-4" />}
                        disabled={adminSaving}
                        className="mt-0.5"
                      />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {adminError !== null && (
            <Alert variant="tonal" color="error" title={adminError} size="sm" />
          )}
          {adminSuccess && (
            <Alert
              variant="tonal"
              color="success"
              title="System administrators updated successfully."
              size="sm"
            />
          )}

          <div className="flex justify-end pt-1">
            <Button
              variant="filled"
              color="primary"
              size="sm"
              onClick={() => void handleSaveAdmins()}
              disabled={
                adminSaving ||
                !isAdminsModified ||
                adminLoading ||
                hasClientValidationErrors
              }
              isLoading={adminSaving}
            >
              Save changes
            </Button>
          </div>
        </div>
      </Card.Root>

      {/* ── Security ── */}
      <Card.Root variant="elevated" shadowElevation={1} padding="md">
        <Card.Header>
          <div>
            <Card.Title as="h2">Security</Card.Title>
            <Card.Description>
              Change your password. All other active sessions will be signed
              out.
            </Card.Description>
          </div>
        </Card.Header>
        <div className="flex flex-col gap-4">
          {isEmailEnabled && (
            <>
              {/* Admin password recovery directly from session state */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/50">
                <div>
                  <p className="text-label-lg font-medium text-on-surface">
                    Password Reset
                  </p>
                  <p className="text-body-sm text-on-surface-variant">
                    Send a secure reset link to your admin email.
                  </p>
                </div>
                <Button
                  variant="tonal"
                  color="primary"
                  size="sm"
                  onClick={async () => {
                    setResetSent(true)
                    // Target the custom HMAC token flow that powers the Admin Forgot Password page
                    // instead of better-auth's native implementation.
                    await apiClient.post(
                      '/api/v1/validate/reset-password/request',
                      {
                        email: session?.user?.email || '',
                        adminOnly: true,
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
        className="border border-error/40"
      >
        <Card.Header>
          <div className="flex items-center gap-2">
            <TriangleAlert className="h-5 w-5 text-error flex-shrink-0" />
            <div>
              <Card.Title as="h2">Danger Zone</Card.Title>
              <Card.Description>
                Irreversible, destructive actions. Proceed with caution.
              </Card.Description>
            </div>
          </div>
        </Card.Header>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 bg-surface-container-lowest rounded-xl border border-outline-variant/50">
          <div>
            <p className="text-label-lg font-medium text-on-surface">
              Reset All Database
            </p>
            <p className="text-body-sm text-on-surface-variant max-w-md">
              Permanently deletes and resets every database record and system
              setting — every other admin/user account, bot session,
              credential, and configuration. Only your own admin account and
              its associated data are preserved. This cannot be undone.
            </p>
          </div>
          <Button
            variant="tonal"
            color="error"
            size="sm"
            className="flex-shrink-0"
            onClick={openResetDialog}
          >
            Reset All Database
          </Button>
        </div>
        {resetSuccess && (
          <Alert
            variant="tonal"
            color="success"
            title="Database reset complete."
            message="All records were wiped except your own admin account and data. Reload the page to see the updated state."
            size="sm"
          />
        )}
      </Card.Root>

      {/* Reset All Database Dialog */}
      <Dialog.Root
        open={resetDialogOpen}
        onOpenChange={(open) => {
          if (!open) closeResetDialog()
        }}
        closeOnEsc={!isResetting}
        closeOnOverlayClick={!isResetting}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Reset All Database</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-3">
                This will{' '}
                <span className="font-semibold text-on-surface">
                  permanently delete every database record and system setting
                </span>
                — every other admin/user account, bot session, credential,
                thread, and configuration. Only your own admin account (
                {session?.user?.email ?? 'this account'}) and its associated
                data will remain intact. This action cannot be undone.
              </p>
              <Field.Root>
                <Field.Label>
                  Type{' '}
                  <span className="font-mono font-semibold text-on-surface">
                    {RESET_ALL_DATABASE_CONFIRMATION_PHRASE}
                  </span>{' '}
                  to confirm
                </Field.Label>
                <Input
                  value={resetConfirmInput}
                  onChange={(e) => {
                    setResetConfirmInput(e.target.value)
                    setResetError(null)
                  }}
                  placeholder={RESET_ALL_DATABASE_CONFIRMATION_PHRASE}
                  disabled={isResetting}
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field.Root>
              {resetError !== null && (
                <div className="mt-3">
                  <Alert
                    variant="tonal"
                    color="error"
                    title={resetError}
                    size="sm"
                  />
                </div>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button
                  variant="text"
                  color="neutral"
                  size="sm"
                  disabled={isResetting}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                className="!bg-[#e7000b] !text-white"
                size="sm"
                onClick={() => void handleResetAllDatabase()}
                isLoading={isResetting}
                disabled={isResetting || !isResetConfirmed}
              >
                Reset All Database
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </div>
  )
}
