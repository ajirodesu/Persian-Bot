/**
 * Database Panel — session-scoped user & group management.
 *
 * Shows every user and group this bot session has interacted with.
 * Admins can search, filter, sort, inspect, ban/unban, or remove records.
 *
 * Design: mirrors the Admin → Users page exactly:
 *   • text-headline-md page title + text-body-md description
 *   • Pill search bar wrapped in a bg-surface rounded-full container
 *   • Glass-variant Table.Root inside a bg-surface Table.ScrollArea
 *   • Table.Loading / Table.Empty / Table.Pagination compound components
 *   • Pill Badges everywhere (variant="tonal", size="sm"/"md", pill)
 *   • Tonal, xs-size row-action buttons
 *   • Dialog-scoped loading/error state, closeOnEsc/closeOnOverlayClick
 *     disabled mid-request, Dialog.CloseTrigger asChild Cancel buttons,
 *     Field + Textarea for the optional ban reason
 *   • Plain rounded-xl bg-error-container div for page-level fetch errors
 *   • Snackbar toasts for success / warning feedback on actions
 */

import { useState } from 'react'
import {
  Users,
  MessageSquare,
  Search,
  Eye,
  RefreshCw,
} from 'lucide-react'
import Tabs from '@/components/ui/navigation/Tabs'
import Input from '@/components/ui/forms/Input'
import Select from '@/components/ui/forms/Select'
import Textarea from '@/components/ui/forms/Textarea'
import { Field } from '@/components/ui/forms/Field'
import Button from '@/components/ui/buttons/Button'
import Badge from '@/components/ui/data-display/Badge'
import Alert from '@/components/ui/feedback/Alert'
import Table from '@/components/ui/data-display/Table'
import Dialog from '@/components/ui/overlay/Dialog'
import DataList from '@/components/ui/data-display/DataList'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'
import {
  useBotDatabaseUsers,
  useBotDatabaseGroups,
} from '@/features/users/hooks/useBotDatabase'
import type {
  BotDatabaseUser,
  BotDatabaseGroup,
  BotDatabaseStatusFilter,
  BotDatabaseSortBy,
} from '@/features/users/services/bot.service'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function userDisplayName(u: {
  name: string
  username: string | null
  first_name: string | null
}): string {
  if (u.username) return `@${u.username}`
  if (u.first_name) return u.first_name
  return u.name
}

const statusFilterOptions = [
  { value: 'all', label: 'All statuses' },
  { value: 'active', label: 'Active only' },
  { value: 'banned', label: 'Banned only' },
]

// ── Detail dialog ─────────────────────────────────────────────────────────────

interface DetailField {
  label: string
  value: React.ReactNode
}

interface DetailDialogProps {
  open: boolean
  onClose: () => void
  title: string
  isBanned: boolean
  fields: DetailField[]
}

function DetailDialog({ open, onClose, title, isBanned, fields }: DetailDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Positioner position="center">
        <Dialog.Backdrop />
        <Dialog.Content size="sm">
          <Dialog.Header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <div className="mb-4">
              <Badge
                variant="tonal"
                color={isBanned ? 'error' : 'success'}
                size="sm"
                pill
              >
                {isBanned ? 'Banned' : 'Active'}
              </Badge>
            </div>
            <DataList.Root size="sm" divideY>
              {fields.map((field) => (
                <DataList.Item key={field.label}>
                  <DataList.ItemLabel>{field.label}</DataList.ItemLabel>
                  <DataList.ItemValue>{field.value}</DataList.ItemValue>
                </DataList.Item>
              ))}
            </DataList.Root>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.CloseTrigger asChild>
              <Button variant="text" color="neutral" size="sm">
                Close
              </Button>
            </Dialog.CloseTrigger>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

function DatabaseToolbar({
  search,
  onSearchChange,
  searchPlaceholder,
  status,
  onStatusChange,
  total,
  matchedLabel,
  isLoading,
  onRefresh,
}: {
  search: string
  onSearchChange: (v: string) => void
  searchPlaceholder: string
  status: BotDatabaseStatusFilter
  onStatusChange: (v: BotDatabaseStatusFilter) => void
  total: number
  matchedLabel: string
  isLoading: boolean
  onRefresh: () => void
}) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="bg-surface p-2 rounded-full flex-1 min-w-0">
        <Input
          placeholder={searchPlaceholder}
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          leftIcon={<Search className="h-4 w-4 text-on-surface-variant" />}
          pill
        />
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Select
          options={statusFilterOptions}
          value={status}
          onChange={(v) => onStatusChange(v as BotDatabaseStatusFilter)}
          size="sm"
          className="min-w-[9.5rem]"
        />
        <Button
          variant="tonal"
          color="secondary"
          size="sm"
          iconOnly
          leftIcon={<RefreshCw className="h-4 w-4" />}
          aria-label="Refresh"
          onClick={onRefresh}
          isLoading={isLoading}
        />
        {!isLoading && (
          <Badge variant="tonal" color="primary" size="md" pill className="shrink-0">
            {search.trim() || status !== 'all' ? `${total} matched` : matchedLabel}
          </Badge>
        )}
      </div>
    </div>
  )
}

// ── Users tab ─────────────────────────────────────────────────────────────────

function UsersTab({ sessionId, sessionKey }: { sessionId: string; sessionKey?: string }) {
  const {
    users,
    total,
    page,
    isLoading,
    error,
    search,
    setSearch,
    status,
    setStatus,
    sortBy,
    sortDir,
    toggleSort,
    setPage,
    pending,
    refetch,
    deleteUser,
    banUser,
    unbanUser,
  } = useBotDatabaseUsers(sessionId, sessionKey)
  const { snackbar, setPosition } = useSnackbar()

  const notify = (message: string, color: 'success' | 'warning') => {
    setPosition('bottom-right')
    snackbar({ message, color, duration: 4000 })
  }

  // ── Ban dialog state ──
  const [banTarget, setBanTarget] = useState<BotDatabaseUser | null>(null)
  const [banReason, setBanReason] = useState('')
  const [isBanning, setIsBanning] = useState(false)
  const [banError, setBanError] = useState<string | null>(null)

  const openBanDialog = (user: BotDatabaseUser) => {
    setBanTarget(user)
    setBanReason('')
    setBanError(null)
  }
  const closeBanDialog = () => {
    if (isBanning) return
    setBanTarget(null)
    setBanError(null)
  }
  const handleBanUser = async () => {
    if (!banTarget) return
    setIsBanning(true)
    setBanError(null)
    try {
      await banUser(banTarget.id, banReason.trim() || undefined)
      notify(`${userDisplayName(banTarget)} has been banned.`, 'warning')
      setBanTarget(null)
      setBanReason('')
    } catch (err) {
      setBanError(err instanceof Error ? err.message : 'Failed to ban user')
    } finally {
      setIsBanning(false)
    }
  }

  // ── Unban dialog state ──
  const [unbanTarget, setUnbanTarget] = useState<BotDatabaseUser | null>(null)
  const [isUnbanning, setIsUnbanning] = useState(false)
  const [unbanError, setUnbanError] = useState<string | null>(null)

  const openUnbanDialog = (user: BotDatabaseUser) => {
    setUnbanTarget(user)
    setUnbanError(null)
  }
  const closeUnbanDialog = () => {
    if (isUnbanning) return
    setUnbanTarget(null)
    setUnbanError(null)
  }
  const handleUnbanUser = async () => {
    if (!unbanTarget) return
    setIsUnbanning(true)
    setUnbanError(null)
    try {
      await unbanUser(unbanTarget.id)
      notify(`${userDisplayName(unbanTarget)} has been unbanned.`, 'success')
      setUnbanTarget(null)
    } catch (err) {
      setUnbanError(err instanceof Error ? err.message : 'Failed to unban user')
    } finally {
      setIsUnbanning(false)
    }
  }

  // ── Delete dialog state ──
  const [deleteTarget, setDeleteTarget] = useState<BotDatabaseUser | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const openDeleteDialog = (user: BotDatabaseUser) => {
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
      await deleteUser(deleteTarget.id)
      notify(`${userDisplayName(deleteTarget)} was removed from this session.`, 'success')
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete user')
    } finally {
      setIsDeleting(false)
    }
  }

  const [detailUser, setDetailUser] = useState<BotDatabaseUser | null>(null)

  const sortDirFor = (column: BotDatabaseSortBy) => (sortBy === column ? sortDir : null)

  return (
    <div className="flex flex-col gap-4">
      <DatabaseToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search users by name, username, or ID…"
        status={status}
        onStatusChange={setStatus}
        total={total}
        matchedLabel={`${total} total`}
        isLoading={isLoading}
        onRefresh={refetch}
      />

      {error !== null && (
        <div className="rounded-xl bg-error-container text-on-error-container px-4 py-3 text-body-md">
          {error}
        </div>
      )}

      <Table.ScrollArea className="bg-surface">
        <Table.Root variant="glass" fullWidth>
          <Table.Header>
            <Table.Row>
              <Table.Head
                sortable
                sortDirection={sortDirFor('name')}
                onClick={() => toggleSort('name')}
              >
                Name
              </Table.Head>
              <Table.Head>ID</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head
                sortable
                sortDirection={sortDirFor('last_seen')}
                onClick={() => toggleSort('last_seen')}
              >
                Last Seen
              </Table.Head>
              <Table.Head align="right">Actions</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {isLoading && <Table.Loading colSpan={5} rows={5} />}
            {!isLoading &&
              users.map((user) => (
                <Table.Row key={user.id}>
                  <Table.Cell className="font-medium">
                    {userDisplayName(user)}
                  </Table.Cell>
                  <Table.Cell className="text-on-surface-variant">
                    <code className="text-xs bg-surface-container px-1.5 py-0.5 rounded">
                      {user.id}
                    </code>
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      variant="tonal"
                      color={user.is_banned ? 'error' : 'success'}
                      size="sm"
                      pill
                    >
                      {user.is_banned ? 'Banned' : 'Active'}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell className="text-on-surface-variant">
                    {formatDate(user.last_seen)}
                  </Table.Cell>
                  <Table.Cell align="right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="tonal"
                        color="secondary"
                        size="xs"
                        iconOnly
                        leftIcon={<Eye className="h-3.5 w-3.5" />}
                        aria-label={`View details for ${userDisplayName(user)}`}
                        onClick={() => setDetailUser(user)}
                      />
                      {user.is_banned ? (
                        <Button
                          variant="tonal"
                          color="success"
                          size="xs"
                          isLoading={pending.has(user.id)}
                          onClick={() => openUnbanDialog(user)}
                        >
                          Unban
                        </Button>
                      ) : (
                        <Button
                          variant="tonal"
                          color="error"
                          size="xs"
                          onClick={() => openBanDialog(user)}
                        >
                          Ban
                        </Button>
                      )}
                      <Button
                        variant="tonal"
                        color="error"
                        size="xs"
                        onClick={() => openDeleteDialog(user)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            {!isLoading && users.length === 0 && (
              <Table.Empty
                colSpan={5}
                icon={<Users className="h-8 w-8" />}
                message={
                  search.trim()
                    ? `No users match "${search.trim()}"`
                    : status !== 'all'
                      ? `No ${status} users found`
                      : 'No users found.'
                }
              />
            )}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>

      {total > 0 && (
        <Table.Pagination
          currentPage={page}
          totalItems={total}
          itemsPerPage={20}
          onPageChange={setPage}
        />
      )}

      {/* Ban dialog */}
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
                  {banTarget ? userDisplayName(banTarget) : ''}
                </span>{' '}
                will block them from using this bot session.
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
                  placeholder="Describe why this user is being banned…"
                  disabled={isBanning}
                  rows={3}
                />
              </Field.Root>
              {banError !== null && (
                <div className="mt-3">
                  <Alert variant="tonal" color="error" title={banError} size="sm" />
                </div>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="text" color="neutral" size="sm" disabled={isBanning}>
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="error"
                size="sm"
                onClick={() => void handleBanUser()}
                isLoading={isBanning}
                disabled={isBanning}
              >
                Ban User
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Unban dialog */}
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
                  {unbanTarget ? userDisplayName(unbanTarget) : ''}
                </span>
                ? This will restore their access to the bot.
              </p>
              {unbanError !== null && (
                <div className="mt-3">
                  <Alert variant="tonal" color="error" title={unbanError} size="sm" />
                </div>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="text" color="neutral" size="sm" disabled={isUnbanning}>
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="success"
                size="sm"
                onClick={() => void handleUnbanUser()}
                isLoading={isUnbanning}
                disabled={isUnbanning}
              >
                Unban User
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Delete dialog */}
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
              <Dialog.Title>Delete User Record</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-2">
                This will remove{' '}
                <span className="font-semibold text-on-surface">
                  {deleteTarget ? userDisplayName(deleteTarget) : ''}
                </span>{' '}
                from this bot session&apos;s database. They can rejoin later. This
                action cannot be undone.
              </p>
              {deleteError !== null && (
                <div className="mt-3">
                  <Alert variant="tonal" color="error" title={deleteError} size="sm" />
                </div>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="text" color="neutral" size="sm" disabled={isDeleting}>
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
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

      <DetailDialog
        open={!!detailUser}
        onClose={() => setDetailUser(null)}
        title={detailUser ? userDisplayName(detailUser) : 'User details'}
        isBanned={!!detailUser?.is_banned}
        fields={
          detailUser
            ? [
                { label: 'User ID', value: <code className="text-xs">{detailUser.id}</code> },
                { label: 'Display name', value: detailUser.name },
                { label: 'Username', value: detailUser.username ? `@${detailUser.username}` : '—' },
                { label: 'First name', value: detailUser.first_name ?? '—' },
                { label: 'Last seen', value: formatDate(detailUser.last_seen) },
                { label: 'Ban reason', value: detailUser.ban_reason ?? '—' },
              ]
            : []
        }
      />
    </div>
  )
}

// ── Groups tab ────────────────────────────────────────────────────────────────

function GroupsTab({ sessionId, sessionKey }: { sessionId: string; sessionKey?: string }) {
  const {
    groups,
    total,
    page,
    isLoading,
    error,
    search,
    setSearch,
    status,
    setStatus,
    sortBy,
    sortDir,
    toggleSort,
    setPage,
    pending,
    refetch,
    deleteGroup,
    banGroup,
    unbanGroup,
  } = useBotDatabaseGroups(sessionId, sessionKey)
  const { snackbar, setPosition } = useSnackbar()

  const notify = (message: string, color: 'success' | 'warning') => {
    setPosition('bottom-right')
    snackbar({ message, color, duration: 4000 })
  }

  // ── Ban dialog state ──
  const [banTarget, setBanTarget] = useState<BotDatabaseGroup | null>(null)
  const [banReason, setBanReason] = useState('')
  const [isBanning, setIsBanning] = useState(false)
  const [banError, setBanError] = useState<string | null>(null)

  const openBanDialog = (group: BotDatabaseGroup) => {
    setBanTarget(group)
    setBanReason('')
    setBanError(null)
  }
  const closeBanDialog = () => {
    if (isBanning) return
    setBanTarget(null)
    setBanError(null)
  }
  const handleBanGroup = async () => {
    if (!banTarget) return
    setIsBanning(true)
    setBanError(null)
    try {
      await banGroup(banTarget.id, banReason.trim() || undefined)
      notify(`"${banTarget.name}" has been banned.`, 'warning')
      setBanTarget(null)
      setBanReason('')
    } catch (err) {
      setBanError(err instanceof Error ? err.message : 'Failed to ban group')
    } finally {
      setIsBanning(false)
    }
  }

  // ── Unban dialog state ──
  const [unbanTarget, setUnbanTarget] = useState<BotDatabaseGroup | null>(null)
  const [isUnbanning, setIsUnbanning] = useState(false)
  const [unbanError, setUnbanError] = useState<string | null>(null)

  const openUnbanDialog = (group: BotDatabaseGroup) => {
    setUnbanTarget(group)
    setUnbanError(null)
  }
  const closeUnbanDialog = () => {
    if (isUnbanning) return
    setUnbanTarget(null)
    setUnbanError(null)
  }
  const handleUnbanGroup = async () => {
    if (!unbanTarget) return
    setIsUnbanning(true)
    setUnbanError(null)
    try {
      await unbanGroup(unbanTarget.id)
      notify(`"${unbanTarget.name}" has been unbanned.`, 'success')
      setUnbanTarget(null)
    } catch (err) {
      setUnbanError(err instanceof Error ? err.message : 'Failed to unban group')
    } finally {
      setIsUnbanning(false)
    }
  }

  // ── Delete dialog state ──
  const [deleteTarget, setDeleteTarget] = useState<BotDatabaseGroup | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const openDeleteDialog = (group: BotDatabaseGroup) => {
    setDeleteTarget(group)
    setDeleteError(null)
  }
  const closeDeleteDialog = () => {
    if (isDeleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }
  const handleDeleteGroup = async () => {
    if (!deleteTarget) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await deleteGroup(deleteTarget.id)
      notify(`"${deleteTarget.name}" was removed from this session.`, 'success')
      setDeleteTarget(null)
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete group')
    } finally {
      setIsDeleting(false)
    }
  }

  const [detailGroup, setDetailGroup] = useState<BotDatabaseGroup | null>(null)

  const sortDirFor = (column: BotDatabaseSortBy) => (sortBy === column ? sortDir : null)

  return (
    <div className="flex flex-col gap-4">
      <DatabaseToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search groups by name or ID…"
        status={status}
        onStatusChange={setStatus}
        total={total}
        matchedLabel={`${total} total`}
        isLoading={isLoading}
        onRefresh={refetch}
      />

      {error !== null && (
        <div className="rounded-xl bg-error-container text-on-error-container px-4 py-3 text-body-md">
          {error}
        </div>
      )}

      <Table.ScrollArea className="bg-surface">
        <Table.Root variant="glass" fullWidth>
          <Table.Header>
            <Table.Row>
              <Table.Head
                sortable
                sortDirection={sortDirFor('name')}
                onClick={() => toggleSort('name')}
              >
                Name
              </Table.Head>
              <Table.Head>ID</Table.Head>
              <Table.Head>Members</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head
                sortable
                sortDirection={sortDirFor('last_seen')}
                onClick={() => toggleSort('last_seen')}
              >
                Last Seen
              </Table.Head>
              <Table.Head align="right">Actions</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {isLoading && <Table.Loading colSpan={6} rows={5} />}
            {!isLoading &&
              groups.map((group) => (
                <Table.Row key={group.id}>
                  <Table.Cell className="font-medium">
                    <div className="flex items-center gap-2">
                      <span>{group.name}</span>
                      {group.is_group && (
                        <Badge variant="tonal" color="secondary" size="sm" pill>
                          Group
                        </Badge>
                      )}
                    </div>
                  </Table.Cell>
                  <Table.Cell className="text-on-surface-variant">
                    <code className="text-xs bg-surface-container px-1.5 py-0.5 rounded">
                      {group.id}
                    </code>
                  </Table.Cell>
                  <Table.Cell className="text-on-surface-variant">
                    {group.member_count != null
                      ? group.member_count.toLocaleString()
                      : '—'}
                  </Table.Cell>
                  <Table.Cell>
                    <Badge
                      variant="tonal"
                      color={group.is_banned ? 'error' : 'success'}
                      size="sm"
                      pill
                    >
                      {group.is_banned ? 'Banned' : 'Active'}
                    </Badge>
                  </Table.Cell>
                  <Table.Cell className="text-on-surface-variant">
                    {formatDate(group.last_seen)}
                  </Table.Cell>
                  <Table.Cell align="right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="tonal"
                        color="secondary"
                        size="xs"
                        iconOnly
                        leftIcon={<Eye className="h-3.5 w-3.5" />}
                        aria-label={`View details for ${group.name}`}
                        onClick={() => setDetailGroup(group)}
                      />
                      {group.is_banned ? (
                        <Button
                          variant="tonal"
                          color="success"
                          size="xs"
                          isLoading={pending.has(group.id)}
                          onClick={() => openUnbanDialog(group)}
                        >
                          Unban
                        </Button>
                      ) : (
                        <Button
                          variant="tonal"
                          color="error"
                          size="xs"
                          onClick={() => openBanDialog(group)}
                        >
                          Ban
                        </Button>
                      )}
                      <Button
                        variant="tonal"
                        color="error"
                        size="xs"
                        onClick={() => openDeleteDialog(group)}
                      >
                        Delete
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            {!isLoading && groups.length === 0 && (
              <Table.Empty
                colSpan={6}
                icon={<MessageSquare className="h-8 w-8" />}
                message={
                  search.trim()
                    ? `No groups match "${search.trim()}"`
                    : status !== 'all'
                      ? `No ${status} groups found`
                      : 'No groups found.'
                }
              />
            )}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>

      {total > 0 && (
        <Table.Pagination
          currentPage={page}
          totalItems={total}
          itemsPerPage={20}
          onPageChange={setPage}
        />
      )}

      {/* Ban dialog */}
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
              <Dialog.Title>Ban Group</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-4">
                Banning{' '}
                <span className="font-semibold text-on-surface">
                  {banTarget?.name ?? ''}
                </span>{' '}
                will stop the bot from responding in that chat.
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
                  placeholder="Describe why this group is being banned…"
                  disabled={isBanning}
                  rows={3}
                />
              </Field.Root>
              {banError !== null && (
                <div className="mt-3">
                  <Alert variant="tonal" color="error" title={banError} size="sm" />
                </div>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="text" color="neutral" size="sm" disabled={isBanning}>
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="error"
                size="sm"
                onClick={() => void handleBanGroup()}
                isLoading={isBanning}
                disabled={isBanning}
              >
                Ban Group
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Unban dialog */}
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
              <Dialog.Title>Unban Group</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-4">
                Are you sure you want to unban{' '}
                <span className="font-semibold text-on-surface">
                  {unbanTarget?.name ?? ''}
                </span>
                ? The bot will respond in that chat again.
              </p>
              {unbanError !== null && (
                <div className="mt-3">
                  <Alert variant="tonal" color="error" title={unbanError} size="sm" />
                </div>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="text" color="neutral" size="sm" disabled={isUnbanning}>
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="success"
                size="sm"
                onClick={() => void handleUnbanGroup()}
                isLoading={isUnbanning}
                disabled={isUnbanning}
              >
                Unban Group
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Delete dialog */}
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
              <Dialog.Title>Delete Group Record</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-2">
                This will remove{' '}
                <span className="font-semibold text-on-surface">
                  {deleteTarget?.name ?? ''}
                </span>{' '}
                from this bot session&apos;s database. This action cannot be
                undone.
              </p>
              {deleteError !== null && (
                <div className="mt-3">
                  <Alert variant="tonal" color="error" title={deleteError} size="sm" />
                </div>
              )}
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="text" color="neutral" size="sm" disabled={isDeleting}>
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="error"
                size="sm"
                onClick={() => void handleDeleteGroup()}
                isLoading={isDeleting}
                disabled={isDeleting}
              >
                Delete Group
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      <DetailDialog
        open={!!detailGroup}
        onClose={() => setDetailGroup(null)}
        title={detailGroup?.name ?? 'Group details'}
        isBanned={!!detailGroup?.is_banned}
        fields={
          detailGroup
            ? [
                { label: 'Group ID', value: <code className="text-xs">{detailGroup.id}</code> },
                { label: 'Type', value: detailGroup.is_group ? 'Group' : 'Direct / channel' },
                {
                  label: 'Members',
                  value:
                    detailGroup.member_count != null
                      ? detailGroup.member_count.toLocaleString()
                      : '—',
                },
                { label: 'Last seen', value: formatDate(detailGroup.last_seen) },
                { label: 'Ban reason', value: detailGroup.ban_reason ?? '—' },
              ]
            : []
        }
      />
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function BotDatabasePage() {
  const { bot, id: sessionId } = useBotContext()
  const [activeTab, setActiveTab] = useState<'users' | 'groups'>('users')
  // Full session key for the real-time Socket.IO room — matches the server's
  // `${userId}:${platform}:${sessionId}` convention (banned.repo.ts / bot-database.socket.ts).
  const sessionKey = bot ? `${bot.userId}:${bot.platform}:${bot.sessionId}` : undefined

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-headline-md font-semibold text-on-surface">
          Database
        </h1>
        <p className="mt-1 text-body-md text-on-surface-variant">
          Manage users and groups this bot session has interacted with.
        </p>
      </div>

      <Tabs.Root
        value={activeTab}
        onChange={(v) => setActiveTab(v as 'users' | 'groups')}
      >
        <Tabs.List variant="enclosed" className="mx-auto w-fit">
          <Tabs.Tab value="users">
            <span className="flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              Users
            </span>
          </Tabs.Tab>
          <Tabs.Tab value="groups">
            <span className="flex items-center gap-1.5">
              <MessageSquare className="h-4 w-4" />
              Groups
            </span>
          </Tabs.Tab>
        </Tabs.List>
      </Tabs.Root>

      {activeTab === 'users' ? (
        <UsersTab sessionId={sessionId} sessionKey={sessionKey} />
      ) : (
        <GroupsTab sessionId={sessionId} sessionKey={sessionKey} />
      )}
    </div>
  )
}
