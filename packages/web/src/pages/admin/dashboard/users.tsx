import { Helmet } from '@dr.pogodin/react-helmet'
import { useState } from 'react'
import { Search, Users } from 'lucide-react'
import { authAdminClient } from '@/lib/better-auth-admin-client.lib'
import Table from '@/components/ui/data-display/Table'
import Dialog from '@/components/ui/overlay/Dialog'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Textarea from '@/components/ui/forms/Textarea'
import Select from '@/components/ui/forms/Select'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import { useAdminBots } from '@/features/admin/hooks/useAdminBots'
import { useAdminUsers } from '@/features/admin/hooks/useAdminUsers'
import { useDebounce } from '@/hooks/useDebounce'
import adminService from '@/features/admin/services/admin.service'
import { useTimezone } from '@/contexts/TimezoneContext'
import { formatDate } from '@/utils/datetime.util'
import { cn } from '@/utils/cn.util'

interface ManagedUser {
  id: string
  name: string
  email: string
  role: string | null
  createdAt: string
  banned: boolean
  emailVerified: boolean
}

// ============================================================================
// Small presentational pieces matching dashboard settings
// ============================================================================

function IconWell({ children }: { children: React.ReactNode }) {
  return (
    <div className="w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0 bg-surface-container-high border-hairline text-on-surface-variant">
      {children}
    </div>
  )
}

function MonoChip({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'accent' | 'danger'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border',
        tone === 'accent' &&
          'bg-surface-container-high text-primary border-primary/30',
        tone === 'danger' &&
          'bg-surface-container-high text-error border-error/30',
        tone === 'default' &&
          'bg-surface-container-high text-on-surface-variant border-hairline',
      )}
    >
      {children}
    </span>
  )
}

function UserRowSkeleton() {
  return (
    <div className="p-3.5 flex items-center justify-between" aria-hidden="true">
      <div className="flex items-center space-x-3 min-w-0">
        <Skeleton variant="input" width={36} height={36} />
        <div className="flex flex-col gap-2">
          <Skeleton textSize="body-sm" width="128px" />
          <Skeleton textSize="body-sm" width="64px" />
        </div>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <Skeleton variant="pill" width={44} height={24} />
        <Skeleton variant="pill" width={44} height={24} />
      </div>
    </div>
  )
}

// Compact raw action buttons (settings vocabulary).
const ROW_BTN =
  'px-2.5 py-1 text-xs font-semibold rounded border transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex-shrink-0'
const ROW_BTN_SECONDARY =
  'bg-surface-container-high hover:bg-surface-container-highest/60 border-hairline text-on-surface'
const ROW_BTN_ACCENT =
  'bg-primary/10 hover:bg-primary/15 border-primary/30 text-primary'
const ROW_BTN_DANGER =
  'bg-error/10 hover:bg-error/15 border-error/30 text-error'

/**
 * AdminUsersPage
 *
 * Standalone page for user management. Separating this ensures the overview
 * page doesn't unnecessarily pull the entire user payload when not needed.
 */
export default function AdminUsersPage() {
  const { timezone } = useTimezone()
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)

  // Reset to page 1 whenever the debounced search term changes. Adjusting state
  // during render (rather than in an effect) avoids an extra render + effect
  // round-trip — see https://react.dev/learn/you-might-not-need-an-effect
  const [prevSearch, setPrevSearch] = useState(debouncedSearch)
  if (debouncedSearch !== prevSearch) {
    setPrevSearch(debouncedSearch)
    setPage(1)
  }

  const { users, total, isLoading, error, refetch } = useAdminUsers(
    page,
    10,
    debouncedSearch,
  )

  // We still load ALL bots locally without pagination to safely derive user-bot relation counts on the client
  const { bots } = useAdminBots(1, 10000, '')

  // ── Delete User State ──────────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const openDeleteDialog = (user: ManagedUser) => {
    setDeleteTarget(user)
    setDeleteError(null)
  }

  const closeDeleteDialog = () => {
    if (isDeleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }

  const handleDeleteUser = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await adminService.deleteUser(deleteTarget.id)
      setDeleteTarget(null)
      void refetch()
    } catch (err) {
      const e = err as { response?: { data?: { error?: string } } }
      setDeleteError(
        e.response?.data?.error ||
          (err instanceof Error ? err.message : 'Failed to delete user'),
      )
    } finally {
      setIsDeleting(false)
    }
  }

  // Tracks which user the admin is about to ban — null means the dialog is closed.
  // Keeping this as a full ManagedUser object (not just id) lets the dialog render
  // the target's name without a secondary lookup.
  const [banTarget, setBanTarget] = useState<ManagedUser | null>(null)
  const [banReason, setBanReason] = useState('')
  const [isBanning, setIsBanning] = useState(false)
  const [banError, setBanError] = useState<string | null>(null)

  // Tracks the user currently selected for unbanning
  const [unbanTarget, setUnbanTarget] = useState<ManagedUser | null>(null)
  const [isUnbanning, setIsUnbanning] = useState(false)
  const [unbanError, setUnbanError] = useState<string | null>(null)

  // ── Edit User State ────────────────────────────────────────────────────────
  const [editTarget, setEditTarget] = useState<ManagedUser | null>(null)
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    role: 'user',
  })
  const [isEditing, setIsEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)

  const openEditDialog = (user: ManagedUser) => {
    setEditTarget(user)
    setEditForm({
      name: user.name,
      email: user.email,
      role: user.role ?? 'user',
    })
    setEditError(null)
  }

  const closeEditDialog = () => {
    if (isEditing) return
    setEditTarget(null)
    setEditError(null)
  }

  const handleEditUser = async () => {
    if (!editTarget) return
    setIsEditing(true)
    setEditError(null)
    try {
      await adminService.updateUser(editTarget.id, editForm)
      void refetch()
      closeEditDialog()
    } catch (err) {
      // WHY: Extract explicit { error: "..." } from Axios/fetch responses to surface backend validation errors (e.g., email collisions) instead of generic 400 messages
      const e = err as { response?: { data?: { error?: string } } }
      setEditError(
        e.response?.data?.error ||
          (err instanceof Error ? err.message : 'Failed to update user'),
      )
    } finally {
      setIsEditing(false)
    }
  }

  // ── Verify State ───────────────────────────────────────────────────────────
  const [verifyTarget, setVerifyTarget] = useState<ManagedUser | null>(null)
  const [isVerifying, setIsVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)

  const openVerifyDialog = (user: ManagedUser) => {
    setVerifyTarget(user)
    setVerifyError(null)
  }

  const closeVerifyDialog = () => {
    if (isVerifying) return
    setVerifyTarget(null)
    setVerifyError(null)
  }

  // Refactored to operate on the active dialog target rather than inline execution
  const handleVerifyUser = async () => {
    if (!verifyTarget) return
    setIsVerifying(true)
    setVerifyError(null)
    try {
      await adminService.verifyUser(verifyTarget.id)
      void refetch()
      closeVerifyDialog()
    } catch (err) {
      // WHY: Ensure server-side verification errors are surfaced correctly to the UI
      const e = err as { response?: { data?: { error?: string } } }
      setVerifyError(
        e.response?.data?.error ||
          (err instanceof Error ? err.message : 'Failed to verify user'),
      )
    } finally {
      setIsVerifying(false)
    }
  }

  // Calls better-auth admin.banUser then optimistically flips the local row's
  // banned flag so the operator sees immediate feedback without a full re-fetch.
  // banReason is optional per the schema (String? on the user model).
  const handleBanUser = async (): Promise<void> => {
    if (!banTarget) return
    setIsBanning(true)
    setBanError(null)
    try {
      const result = await authAdminClient.admin.banUser({
        userId: banTarget.id,
        ...(banReason.trim() ? { banReason: banReason.trim() } : {}),
      })
      if (result.error) {
        setBanError(result.error.message ?? 'Failed to ban user')
      } else {
        setBanTarget(null)
        setBanReason('')
        void refetch()
        // Fire-and-forget: stop all running bot sessions for the banned user.
        // The dialog closes immediately; session teardown is async so the operator
        // is never blocked by network latency or a large bot-session count.
        adminService.stopUserSessions(banTarget.id).catch((err) => {
          console.error(
            '[AdminUsersPage] Failed to stop sessions for banned user',
            err,
          )
        })
      }
    } catch (err) {
      setBanError(err instanceof Error ? err.message : 'Failed to ban user')
    } finally {
      setIsBanning(false)
    }
  }

  const openBanDialog = (user: ManagedUser) => {
    setBanTarget(user)
    setBanReason('')
    setBanError(null)
  }

  // Guard against closing mid-request — losing the isBanning state would leave
  // the UI stuck showing a loading spinner with no way to dismiss it.
  const closeBanDialog = () => {
    if (isBanning) return
    setBanTarget(null)
    setBanReason('')
    setBanError(null)
  }

  // Calls better-auth admin.unbanUser to restore a user's access, followed by an optimistic table update
  const handleUnbanUser = async (): Promise<void> => {
    if (!unbanTarget) return
    setIsUnbanning(true)
    setUnbanError(null)
    try {
      const result = await authAdminClient.admin.unbanUser({
        userId: unbanTarget.id,
      })
      if (result.error) {
        setUnbanError(result.error.message ?? 'Failed to unban user')
      } else {
        setUnbanTarget(null)
        void refetch()
        // Fire-and-forget: restart all bot sessions for the unbanned user.
        // Same rationale as the ban path — the UI resolves immediately.
        adminService.startUserSessions(unbanTarget.id).catch((err) => {
          console.error(
            '[AdminUsersPage] Failed to start sessions for unbanned user',
            err,
          )
        })
      }
    } catch (err) {
      setUnbanError(err instanceof Error ? err.message : 'Failed to unban user')
    } finally {
      setIsUnbanning(false)
    }
  }

  const openUnbanDialog = (user: ManagedUser) => {
    setUnbanTarget(user)
    setUnbanError(null)
  }

  const closeUnbanDialog = () => {
    if (isUnbanning) return
    setUnbanTarget(null)
    setUnbanError(null)
  }

  return (
    <div className="flex flex-col max-w-2xl lg:max-w-4xl w-full mx-auto">
      <Helmet>
        <title>Admin Users · Cat-Bot</title>
      </Helmet>

      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            Users
          </h2>
          {!isLoading && (
            <span className="text-[11px] font-mono font-medium text-surface-variant">
              {searchQuery.trim() ? `${total} matched` : `${total} total`}
            </span>
          )}
        </div>

        {error !== null && (
          <Alert variant="tonal" color="error" title="Error" message={error} size="sm" />
        )}

        <Input
          placeholder="Search users by name, email, or role…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          aria-label="Search users"
          className="h-11 text-sm"
        />

        {isLoading ? (
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {[0, 1, 2, 3, 4].map((i) => (
              <UserRowSkeleton key={`skeleton-${i}`} />
            ))}
          </div>
        ) : users.length === 0 ? (
          <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
            <p className="p-6 text-sm text-on-surface-variant italic text-center">
              {searchQuery.trim()
                ? `No users match "${searchQuery}"`
                : 'No users found.'}
            </p>
          </div>
        ) : (
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {users.map((u) => {
              const userBots = bots.filter((b) => b.userId === u.id)
              const botTotal = userBots.length
              // Count only the running sessions for this specific user, not the global total
              const botActive = userBots.filter((b) => b.isRunning).length
              return (
                <div
                  key={u.id}
                  className="p-3.5 flex items-center justify-between space-x-3"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <IconWell>
                      <Users className="h-4 w-4" strokeWidth={2} />
                    </IconWell>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center space-x-2 min-w-0 flex-wrap gap-y-1">
                        <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                          {u.name}
                        </span>
                        <MonoChip tone={u.role === 'admin' ? 'accent' : 'default'}>
                          {u.role ?? 'user'}
                        </MonoChip>
                        <MonoChip tone={u.emailVerified ? 'accent' : 'default'}>
                          {u.emailVerified ? 'Verified' : 'Pending'}
                        </MonoChip>
                        {u.banned === true && (
                          <MonoChip tone="danger">Banned</MonoChip>
                        )}
                        {botTotal > 0 && (
                          <MonoChip tone="default">
                            {botActive}/{botTotal} session{botTotal !== 1 ? 's' : ''}
                          </MonoChip>
                        )}
                      </div>
                      <span className="text-[11px] font-mono text-on-surface-variant truncate mt-0.5">
                        {u.email} · {formatDate(u.createdAt, timezone)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                    {u.role !== 'admin' && !u.banned && (
                      <button
                        type="button"
                        onClick={() => openBanDialog(u)}
                        className={cn(ROW_BTN, ROW_BTN_DANGER)}
                      >
                        Ban
                      </button>
                    )}
                    {u.banned === true && (
                      <button
                        type="button"
                        onClick={() => openUnbanDialog(u)}
                        className={cn(ROW_BTN, ROW_BTN_ACCENT)}
                      >
                        Unban
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditDialog(u)}
                      className={cn(ROW_BTN, ROW_BTN_SECONDARY)}
                    >
                      Edit
                    </button>
                    {!u.emailVerified && (
                      <button
                        type="button"
                        onClick={() => openVerifyDialog(u)}
                        className={cn(ROW_BTN, ROW_BTN_SECONDARY)}
                      >
                        Verify
                      </button>
                    )}
                    {u.role !== 'admin' && (
                      <button
                        type="button"
                        onClick={() => openDeleteDialog(u)}
                        className={cn(ROW_BTN, ROW_BTN_DANGER)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
        {total > 0 && (
          <Table.Pagination
            currentPage={page}
            totalItems={total}
            itemsPerPage={10}
            onPageChange={setPage}
          />
        )}
      </div>

      {/* Ban dialog — controlled via banTarget state so no Trigger is needed.
          closeOnEsc / closeOnOverlayClick are disabled while the request is in
          flight to prevent abandoning a partially committed ban operation. */}
      <Dialog.Root
        open={banTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeBanDialog()
        }}
        closeOnEsc={!isBanning}
        closeOnOverlayClick={!isBanning}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Ban User</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-4">
                Banning{' '}
                <span className="font-semibold text-on-surface">
                  {banTarget?.name} ({banTarget?.email})
                </span>{' '}
                will prevent them from signing in. The reason is stored in the
                database and visible to other admins.
              </p>
              <Field.Root>
                <Field.Label>
                  Reason{' '}
                  <span className="text-on-surface-variant font-normal">
                    (optional)
                  </span>
                </Field.Label>
                <Textarea
                  value={banReason}
                  onChange={(e) => {
                    setBanReason(e.target.value)
                    setBanError(null)
                  }}
                  placeholder="Describe why this account is being banned…"
                  disabled={isBanning}
                  rows={3}
                />
              </Field.Root>
              {banError !== null && (
                <div className="mt-3">
                  <Alert
                    variant="tonal"
                    color="error"
                    title={banError}
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
                  disabled={isBanning}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              {/* Was a hardcoded !bg-[#e7000b] override; use Button's own
                  semantic error color (same --color-error token every other
                  destructive control in the app already reads from). */}
              <Button
                color="error"
                size="sm"
                onClick={() => {
                  void handleBanUser()
                }}
                isLoading={isBanning}
                disabled={isBanning}
              >
                Ban User
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Unban dialog — controlled via unbanTarget state.
          closeOnEsc / closeOnOverlayClick are disabled while the request is in flight. */}
      <Dialog.Root
        open={unbanTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeUnbanDialog()
        }}
        closeOnEsc={!isUnbanning}
        closeOnOverlayClick={!isUnbanning}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Unban User</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-4">
                Are you sure you want to unban{' '}
                <span className="font-semibold text-on-surface">
                  {unbanTarget?.name} ({unbanTarget?.email})
                </span>
                ? This will restore their access to the platform.
              </p>
              {unbanError !== null && (
                <div className="mt-3">
                  <Alert
                    variant="tonal"
                    color="error"
                    title={unbanError}
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
                  disabled={isUnbanning}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="success"
                size="sm"
                onClick={() => {
                  void handleUnbanUser()
                }}
                isLoading={isUnbanning}
                disabled={isUnbanning}
              >
                Unban User
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Edit User Dialog */}
      <Dialog.Root
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeEditDialog()
        }}
        closeOnEsc={!isEditing}
        closeOnOverlayClick={!isEditing}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Edit User</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body className="flex flex-col gap-4">
              <Field.Root>
                <Field.Label>Name</Field.Label>
                <Input
                  value={editForm.name}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, name: e.target.value }))
                  }
                  disabled={isEditing}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Email</Field.Label>
                <Input
                  type="email"
                  value={editForm.email}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, email: e.target.value }))
                  }
                  disabled={isEditing}
                />
              </Field.Root>
              <Field.Root>
                <Field.Label>Role</Field.Label>
                {/* Utilizing the unified design system Select component */}
                <Select
                  options={[
                    { value: 'user', label: 'User' },
                    { value: 'admin', label: 'Admin' },
                  ]}
                  value={editForm.role}
                  onChange={(value) =>
                    setEditForm((prev) => ({ ...prev, role: value }))
                  }
                  disabled={isEditing}
                />
              </Field.Root>
              {editError !== null && (
                <div className="mt-2">
                  <Alert
                    variant="tonal"
                    color="error"
                    title={editError}
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
                  disabled={isEditing}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="primary"
                size="sm"
                onClick={() => void handleEditUser()}
                isLoading={isEditing}
                disabled={isEditing}
              >
                Save Changes
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Verify User Dialog */}
      <Dialog.Root
        open={verifyTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeVerifyDialog()
        }}
        closeOnEsc={!isVerifying}
        closeOnOverlayClick={!isVerifying}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Verify User</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-4">
                Are you sure you want to manually verify{' '}
                <span className="font-semibold text-on-surface">
                  {verifyTarget?.name} ({verifyTarget?.email})
                </span>
                ? This will bypass the email verification process.
              </p>
              {verifyError !== null && (
                <div className="mt-3">
                  <Alert
                    variant="tonal"
                    color="error"
                    title={verifyError}
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
                  disabled={isVerifying}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="info"
                size="sm"
                onClick={() => void handleVerifyUser()}
                isLoading={isVerifying}
                disabled={isVerifying}
              >
                Verify User
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Delete User Dialog */}
      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) closeDeleteDialog()
        }}
        closeOnEsc={!isDeleting}
        closeOnOverlayClick={!isDeleting}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Delete User</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-2">
                This will permanently delete{' '}
                <span className="font-semibold text-on-surface">
                  {deleteTarget?.name} ({deleteTarget?.email})
                </span>{' '}
                and all their data, including every bot session, credential, and
                configuration. This action cannot be undone.
              </p>
              {deleteError !== null && (
                <div className="mt-3">
                  <Alert
                    variant="tonal"
                    color="error"
                    title={deleteError}
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
                  disabled={isDeleting}
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              {/* Was a hardcoded !bg-[#e7000b] override; use Button's own
                  semantic error color (same --color-error token every other
                  destructive control in the app already reads from). */}
              <Button
                color="error"
                size="sm"
                onClick={() => void handleDeleteUser()}
                isLoading={isDeleting}
                disabled={isDeleting}
              >
                Delete User
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </div>
  )
}
