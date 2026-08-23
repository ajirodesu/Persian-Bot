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

import { useState, useEffect } from 'react'
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
import Skeleton from '@/components/ui/feedback/Skeleton'
import Dialog from '@/components/ui/overlay/Dialog'
import DataList from '@/components/ui/data-display/DataList'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { useTimezone } from '@/contexts/TimezoneContext'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'
import {
  useBotDatabaseUsers,
  useBotDatabaseServers,
  useBotDatabaseChannels,
  useBotDatabaseGroupSelector,
} from '@/features/users/hooks/useBotDatabase'
import { useDebounce } from '@/hooks/useDebounce'
import { botService } from '@/features/users/services/bot.service'
import type {
  BotDatabaseUser,
  BotDatabaseGroup,
  BotDatabaseStatusFilter,
  BotDatabaseTypeFilter,
  BotDatabaseSortBy,
} from '@/features/users/services/bot.service'
import { formatDateTime } from '@/utils/datetime.util'

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDate(iso: string | null, timezone: string): string {
  return formatDateTime(iso, timezone)
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

/** Groups label ban state differently from users — "Not banned", not "Active". */
const groupStatusFilterOptions = [
  { value: 'all', label: 'All groups' },
  { value: 'active', label: 'Not banned' },
  { value: 'banned', label: 'Banned' },
]

const channelTypeLabels: Record<string, string> = {
  text: 'Text',
  voice: 'Voice',
  category: 'Category',
  announcement: 'Announcement',
  thread: 'Thread',
  stage: 'Stage',
  forum: 'Forum',
  media: 'Media',
}

function channelTypeLabel(type: string | null): string {
  if (!type) return '—'
  return channelTypeLabels[type] ?? type
}

// Telegram exposes every entity where a bot can be a member via its Chat.type
// enum: private (1:1, never stored as a group), group, supergroup, and channel.
// These labels keep the panel's Type column human-readable for all of them.
const telegramTypeLabels: Record<string, string> = {
  group: 'Group',
  supergroup: 'Supergroup',
  channel: 'Channel',
  private: 'Private',
}

/** Best-effort Type column value: the persisted chat type, else fall back to the is_group flag. */
function groupTypeLabel(group: { type: string | null; is_group: boolean }): string {
  if (group.type) return telegramTypeLabels[group.type] ?? group.type
  return group.is_group ? 'Group' : '—'
}

function groupTypeColor(type: string | null): 'secondary' | 'tertiary' | 'info' {
  switch (type) {
    case 'supergroup':
      return 'tertiary'
    case 'channel':
      return 'info'
    case 'group':
    default:
      return 'secondary'
  }
}

const typeFilterOptions = [
  { value: 'all', label: 'All types' },
  { value: 'group', label: 'Groups' },
  { value: 'supergroup', label: 'Supergroups' },
  { value: 'channel', label: 'Channels' },
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
  type,
  onTypeChange,
  total,
  matchedLabel,
  isLoading,
  onRefresh,
  statusOptions = statusFilterOptions,
  typeOptions = typeFilterOptions,
}: {
  search: string
  onSearchChange: (v: string) => void
  searchPlaceholder: string
  status: BotDatabaseStatusFilter
  onStatusChange: (v: BotDatabaseStatusFilter) => void
  type?: BotDatabaseTypeFilter
  onTypeChange?: (v: BotDatabaseTypeFilter) => void
  total: number
  matchedLabel: string
  isLoading: boolean
  onRefresh: () => void
  /** Per-tab status filter options (e.g. groups label states "Not banned"). */
  statusOptions?: { value: string; label: string }[]
  /** Per-tab type filter options. */
  typeOptions?: { value: string; label: string }[]
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
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0 min-w-0">
        {onTypeChange && type && (
          <Select
            options={typeOptions}
            value={type}
            onChange={(v) => onTypeChange(v as BotDatabaseTypeFilter)}
            size="sm"
            className="min-w-0 sm:min-w-[8.5rem]"
          />
        )}
        <Select
          options={statusOptions}
          value={status}
          onChange={(v) => onStatusChange(v as BotDatabaseStatusFilter)}
          size="sm"
          className="min-w-0 sm:min-w-[9.5rem]"
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
        {isLoading ? (
          /* Mirrors the count badge's footprint so the toolbar row never
             reflows when results arrive. */
          <Skeleton variant="pill" width={72} height={26} />
        ) : (
          <Badge variant="tonal" color="primary" size="md" pill className="shrink-0">
            {search.trim() || status !== 'all' || (type && type !== 'all')
              ? `${total} matched`
              : matchedLabel}
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
  const { timezone } = useTimezone()

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
        <div className="rounded-[var(--radius-card)] bg-error-container text-on-error-container px-4 py-3 text-body-md">
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
            {isLoading &&
              // Row skeletons mirror the real user rows: name, mono ID chip,
              // status badge pill, last-seen date, and the right-aligned
              // detail/ban/delete action cluster.
              [0, 1, 2, 3, 4].map((i) => (
                <Table.Row key={`user-skeleton-${i}`}>
                  <Table.Cell>
                    <Skeleton variant="text" width="60%" />
                  </Table.Cell>
                  <Table.Cell>
                    <Skeleton variant="rounded" width={96} height={20} />
                  </Table.Cell>
                  <Table.Cell>
                    <Skeleton variant="pill" width={56} height={20} />
                  </Table.Cell>
                  <Table.Cell>
                    <Skeleton variant="text" width={80} />
                  </Table.Cell>
                  <Table.Cell align="right">
                    <div className="flex items-center justify-end gap-2">
                      <Skeleton variant="circular" width={24} height={24} />
                      <Skeleton variant="pill" width={44} height={24} />
                      <Skeleton variant="pill" width={52} height={24} />
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
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
                    {formatDate(user.last_seen, timezone)}
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
                { label: 'Last seen', value: formatDate(detailUser.last_seen, timezone) },
                { label: 'Ban reason', value: detailUser.ban_reason ?? '—' },
              ]
            : []
        }
      />
    </div>
  )
}

// ── Groups tab (Telegram / webchat) ──────────────────────────────────────────
//
// Telegram-style platforms have FLAT groups — there is no server → channel
// hierarchy like Discord/Fluxer, so this tab does NOT use the drill-down
// pattern. Instead it lists every recorded group as a first-class table row
// (type badge, member count, last activity, status) with per-row
// ban/unban/delete actions — the same treatment as the Users tab.

function PlatformGroupsTab({ sessionId, sessionKey }: { sessionId: string; sessionKey?: string }) {
  // Search + filters mirror the Users tab: the raw search string stays in
  // local state for a snappy input, while a debounced copy drives the fetch.
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<BotDatabaseStatusFilter>('all')
  const [type, setType] = useState<BotDatabaseTypeFilter>('all')
  const debouncedSearch = useDebounce(search, 300)

  const {
    groups,
    total,
    isLoading,
    error,
    refetch,
  } = useBotDatabaseGroupSelector(sessionId, sessionKey, debouncedSearch.trim(), status, type)
  // The group a ban/unban/delete dialog is acting on. Telegram-style groups
  // are FLAT entities — there is no server → channel hierarchy to drill into,
  // so the tab lists every group directly and actions target a row.
  const [actionTarget, setActionTarget] = useState<BotDatabaseGroup | null>(null)
  const { snackbar, setPosition } = useSnackbar()
  const { timezone } = useTimezone()

  // Dialogs read the target through this alias so their markup stays uniform
  // with the server-hierarchy tab's dialogs.
  const selectedGroup = actionTarget

  const notify = (message: string, color: 'success' | 'warning') => {
    setPosition('bottom-right')
    snackbar({ message, color, duration: 4000 })
  }

  // ── Ban dialog state (targets the selected group) ──
  const [isBanning, setIsBanning] = useState(false)
  const [banError, setBanError] = useState<string | null>(null)
  const [banOpen, setBanOpen] = useState(false)
  const [banReason, setBanReason] = useState('')

  const handleBanGroup = async () => {
    if (!selectedGroup) return
    setIsBanning(true)
    setBanError(null)
    try {
      await botService.banDatabaseGroup(sessionId, selectedGroup.id, banReason.trim() || undefined)
      notify(`"${selectedGroup.name}" has been banned.`, 'warning')
      setBanOpen(false)
      setBanReason('')
      refetch()
    } catch (err) {
      setBanError(err instanceof Error ? err.message : 'Failed to ban group')
    } finally {
      setIsBanning(false)
    }
  }

  // ── Unban dialog state ──
  const [isUnbanning, setIsUnbanning] = useState(false)
  const [unbanError, setUnbanError] = useState<string | null>(null)
  const [unbanOpen, setUnbanOpen] = useState(false)

  const handleUnbanGroup = async () => {
    if (!selectedGroup) return
    setIsUnbanning(true)
    setUnbanError(null)
    try {
      await botService.unbanDatabaseGroup(sessionId, selectedGroup.id)
      notify(`"${selectedGroup.name}" has been unbanned.`, 'success')
      setUnbanOpen(false)
      refetch()
    } catch (err) {
      setUnbanError(err instanceof Error ? err.message : 'Failed to unban group')
    } finally {
      setIsUnbanning(false)
    }
  }

  // ── Delete dialog state ──
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleDeleteGroup = async () => {
    if (!selectedGroup) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await botService.deleteDatabaseGroup(sessionId, selectedGroup.id)
      notify(`"${selectedGroup.name}" was removed from this session.`, 'success')
      setDeleteOpen(false)
      setActionTarget(null)
      refetch()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete group')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search + filter toolbar — the exact same component as the Users tab,
          with group-specific option labels (chat type + Not banned/Banned). */}
      <DatabaseToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search groups by name or ID…"
        status={status}
        onStatusChange={setStatus}
        type={type}
        onTypeChange={setType}
        total={total}
        matchedLabel={`${total} total`}
        isLoading={isLoading}
        onRefresh={refetch}
        statusOptions={groupStatusFilterOptions}
        typeOptions={typeFilterOptions}
      />

      {error !== null && (
        <div className="rounded-[var(--radius-card)] bg-error-container text-on-error-container px-4 py-3 text-body-md">
          {error}
        </div>
      )}

      {/* Flat group list — Telegram-style platforms have no server hierarchy,
          so every group is a first-class row with its type, member count,
          activity, status, and per-row ban/unban/delete actions. This mirrors
          the Users tab's table treatment instead of the Discord/Fluxer
          server → channels drill-down. */}
      <Table.ScrollArea className="bg-surface">
        <Table.Root variant="glass" fullWidth>
          <Table.Header>
            <Table.Row>
              <Table.Head>Group</Table.Head>
              <Table.Head className="hidden md:table-cell">Group ID</Table.Head>
              <Table.Head>Members</Table.Head>
              <Table.Head>Last Seen</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head align="right">Actions</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {isLoading &&
              // Row skeletons mirror the real rows: name + type badge, mono
              // ID chip, member count, date, status pill, action buttons.
              [0, 1, 2, 3, 4].map((i) => (
                <Table.Row key={`group-skeleton-${i}`}>
                  <Table.Cell>
                    <div className="flex items-center gap-2">
                      <Skeleton variant="text" width="55%" />
                      <Skeleton variant="pill" width={64} height={20} />
                    </div>
                  </Table.Cell>
                  <Table.Cell className="hidden md:table-cell">
                    <Skeleton variant="rounded" width={96} height={20} />
                  </Table.Cell>
                  <Table.Cell>
                    <Skeleton variant="text" width={40} />
                  </Table.Cell>
                  <Table.Cell>
                    <Skeleton variant="text" width={80} />
                  </Table.Cell>
                  <Table.Cell>
                    <Skeleton variant="pill" width={56} height={20} />
                  </Table.Cell>
                  <Table.Cell align="right">
                    <div className="flex items-center justify-end gap-2">
                      <Skeleton variant="pill" width={44} height={24} />
                      <Skeleton variant="pill" width={52} height={24} />
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
            {!isLoading &&
              groups.map((group) => (
                <Table.Row key={group.id}>
                  <Table.Cell>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-on-surface">
                        {group.name}
                      </span>
                      <Badge
                        variant="tonal"
                        color={groupTypeColor(group.type)}
                        size="sm"
                        pill
                      >
                        {groupTypeLabel(group)}
                      </Badge>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="hidden md:table-cell">
                    <code className="text-xs bg-surface-container px-1.5 py-0.5 rounded">
                      {group.id}
                    </code>
                  </Table.Cell>
                  <Table.Cell className="text-on-surface-variant">
                    {group.member_count != null
                      ? group.member_count.toLocaleString()
                      : '—'}
                  </Table.Cell>
                  <Table.Cell className="text-on-surface-variant">
                    {formatDate(group.last_seen, timezone)}
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
                  <Table.Cell align="right">
                    <div className="flex items-center justify-end gap-2">
                      {group.is_banned ? (
                        <Button
                          variant="tonal"
                          color="success"
                          size="xs"
                          onClick={() => {
                            setActionTarget(group)
                            setUnbanError(null)
                            setUnbanOpen(true)
                          }}
                        >
                          Unban
                        </Button>
                      ) : (
                        <Button
                          variant="tonal"
                          color="error"
                          size="xs"
                          onClick={() => {
                            setActionTarget(group)
                            setBanReason('')
                            setBanError(null)
                            setBanOpen(true)
                          }}
                        >
                          Ban
                        </Button>
                      )}
                      <Button
                        variant="tonal"
                        color="error"
                        size="xs"
                        onClick={() => {
                          setActionTarget(group)
                          setDeleteError(null)
                          setDeleteOpen(true)
                        }}
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
                  search.trim() || status !== 'all' || type !== 'all'
                    ? 'No groups match the current search or filters.'
                    : 'No groups recorded yet. Send a message in a group, supergroup, or channel where this bot is present, then reload this page.'
                }
              />
            )}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>

      {/* Ban dialog */}
      <Dialog.Root
        open={banOpen}
        onOpenChange={(open) => {
          if (!open && !isBanning) setBanOpen(false)
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
                  {selectedGroup?.name ?? ''}
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
        open={unbanOpen}
        onOpenChange={(open) => {
          if (!open && !isUnbanning) setUnbanOpen(false)
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
                  {selectedGroup?.name ?? ''}
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
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteOpen(false)
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
                  {selectedGroup?.name ?? ''}
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
    </div>
  )
}

// ── Server-hierarchy Groups tab (Discord + Fluxer) ───────────────────────────
//
// Discord and Fluxer sessions share a server → channel hierarchy. The tab shows
// a server dropdown fed by GET /database/servers; selecting a server loads ONLY
// that server's channels (GET /database/channels?serverId=...) below it. Channels
// can never appear outside their parent server's context because both the
// dropdown and the channel query are scoped by server id and the owning session.
// Server-level actions (ban/unban/delete) apply to the selected server.
// Platform-specific copy (e.g. "Fluxer server" vs "Discord server") is derived
// from the bot's platform so the panel reads correctly on either one.

function ServerHierarchyGroupsTab({
  platform,
  sessionId,
  sessionKey,
}: {
  platform: string
  sessionId: string
  sessionKey?: string
}) {
  const isFluxer = platform === 'fluxer'
  const {
    servers,
    total,
    isLoading,
    error,
    refetch,
  } = useBotDatabaseServers(sessionId, sessionKey)
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null)
  const {
    channels,
    total: channelTotal,
    page,
    isLoading: channelsLoading,
    error: channelsError,
    search,
    setSearch,
    setPage,
    refetch: refetchChannels,
  } = useBotDatabaseChannels(sessionId, selectedServerId, sessionKey)
  const { snackbar, setPosition } = useSnackbar()
  const { timezone } = useTimezone()

  const notify = (message: string, color: 'success' | 'warning') => {
    setPosition('bottom-right')
    snackbar({ message, color, duration: 4000 })
  }

  // Default to the first server once the list loads.
  useEffect(() => {
    if (selectedServerId === null && servers.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- select the first server once the list arrives
      setSelectedServerId(servers[0].id)
    }
  }, [servers, selectedServerId])

  const selectedServer =
    servers.find((s) => s.id === selectedServerId) ?? null

  // ── Ban dialog state (targets the selected server) ──
  const [isBanning, setIsBanning] = useState(false)
  const [banError, setBanError] = useState<string | null>(null)
  const [banOpen, setBanOpen] = useState(false)
  const [banReason, setBanReason] = useState('')

  const handleBanServer = async () => {
    if (!selectedServer) return
    setIsBanning(true)
    setBanError(null)
    try {
      await botService.banDatabaseGroup(sessionId, selectedServer.id, banReason.trim() || undefined)
      notify(`"${selectedServer.name}" has been banned.`, 'warning')
      setBanOpen(false)
      setBanReason('')
      refetch()
      refetchChannels()
    } catch (err) {
      setBanError(err instanceof Error ? err.message : 'Failed to ban server')
    } finally {
      setIsBanning(false)
    }
  }

  // ── Unban dialog state ──
  const [isUnbanning, setIsUnbanning] = useState(false)
  const [unbanError, setUnbanError] = useState<string | null>(null)
  const [unbanOpen, setUnbanOpen] = useState(false)

  const handleUnbanServer = async () => {
    if (!selectedServer) return
    setIsUnbanning(true)
    setUnbanError(null)
    try {
      await botService.unbanDatabaseGroup(sessionId, selectedServer.id)
      notify(`"${selectedServer.name}" has been unbanned.`, 'success')
      setUnbanOpen(false)
      refetch()
      refetchChannels()
    } catch (err) {
      setUnbanError(err instanceof Error ? err.message : 'Failed to unban server')
    } finally {
      setIsUnbanning(false)
    }
  }

  // ── Delete dialog state ──
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const handleDeleteServer = async () => {
    if (!selectedServer) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await botService.deleteDatabaseGroup(sessionId, selectedServer.id)
      notify(`"${selectedServer.name}" was removed from this session.`, 'success')
      setDeleteOpen(false)
      setSelectedServerId(null)
      refetch()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete server')
    } finally {
      setIsDeleting(false)
    }
  }

  const serverOptions = servers.map((s) => ({
    value: s.id,
    label: s.name ?? s.id,
  }))

  return (
    <div className="flex flex-col gap-4">
      {/* Server selector */}
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div className="bg-surface p-2 rounded-full flex-1 min-w-0">
          <Select
            options={serverOptions}
            value={selectedServerId ?? ''}
            onChange={(v) => setSelectedServerId(v as string)}
            placeholder={
              servers.length > 0 ? 'Select a server…' : 'No servers found'
            }
            pill
          />
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="tonal"
            color="secondary"
            size="sm"
            iconOnly
            leftIcon={<RefreshCw className="h-4 w-4" />}
            aria-label="Refresh"
            onClick={() => {
              refetch()
              refetchChannels()
            }}
            isLoading={isLoading}
          />
          <Badge variant="tonal" color="primary" size="md" pill className="shrink-0">
            {total} total
          </Badge>
        </div>
      </div>

      {error !== null && (
        <div className="rounded-[var(--radius-card)] bg-error-container text-on-error-container px-4 py-3 text-body-md">
          {error}
        </div>
      )}

      {/* Selected server header + actions */}
      {selectedServer !== null && (
        <div className="bg-surface rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="text-body-lg font-semibold text-on-surface truncate">
                  {selectedServer.name ?? selectedServer.id}
                </p>
                <Badge variant="tonal" color="secondary" size="sm" pill>
                  Server
                </Badge>
                <Badge
                  variant="tonal"
                  color={selectedServer.is_banned ? 'error' : 'success'}
                  size="sm"
                  pill
                >
                  {selectedServer.is_banned ? 'Banned' : 'Active'}
                </Badge>
              </div>
              <p className="mt-1 text-body-sm text-on-surface-variant">
                {selectedServer.member_count != null
                  ? `${selectedServer.member_count.toLocaleString()} members`
                  : 'Member count unknown'}
                {' · '}
                {formatDate(selectedServer.last_seen, timezone)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {selectedServer.is_banned ? (
              <Button
                variant="tonal"
                color="success"
                size="sm"
                onClick={() => {
                  setUnbanError(null)
                  setUnbanOpen(true)
                }}
              >
                Unban
              </Button>
            ) : (
              <Button
                variant="tonal"
                color="error"
                size="sm"
                onClick={() => {
                  setBanReason('')
                  setBanError(null)
                  setBanOpen(true)
                }}
              >
                Ban
              </Button>
            )}
            <Button
              variant="tonal"
              color="error"
              size="sm"
              onClick={() => {
                setDeleteError(null)
                setDeleteOpen(true)
              }}
            >
              Delete
            </Button>
          </div>
        </div>
      )}

      {/* Channel search */}
      {selectedServer !== null && (
        <div className="bg-surface p-2 rounded-full flex-1 min-w-0">
          <Input
            placeholder="Search channels by name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            leftIcon={<Search className="h-4 w-4 text-on-surface-variant" />}
            pill
          />
        </div>
      )}

      {/* Channels table */}
      {selectedServer !== null && (
        <Table.ScrollArea className="bg-surface">
          <Table.Root variant="glass" fullWidth>
            <Table.Header>
              <Table.Row>
                <Table.Head>Name</Table.Head>
                <Table.Head>Type</Table.Head>
                <Table.Head>ID</Table.Head>
                <Table.Head>Status</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {channelsLoading &&
                // Mirrors the real channel rows: name, type, mono ID chip,
                // status badge pill.
                [0, 1, 2, 3, 4].map((i) => (
                  <Table.Row key={`channel-skeleton-${i}`}>
                    <Table.Cell>
                      <Skeleton variant="text" width="50%" />
                    </Table.Cell>
                    <Table.Cell>
                      <Skeleton variant="text" width={64} />
                    </Table.Cell>
                    <Table.Cell>
                      <Skeleton variant="rounded" width={96} height={20} />
                    </Table.Cell>
                    <Table.Cell>
                      <Skeleton variant="pill" width={56} height={20} />
                    </Table.Cell>
                  </Table.Row>
                ))}
              {!channelsLoading &&
                channels.map((channel) => (
                  <Table.Row key={channel.id}>
                    <Table.Cell className="font-medium">
                      {channel.name ?? 'Untitled channel'}
                    </Table.Cell>
                    <Table.Cell className="text-on-surface-variant">
                      {channelTypeLabel(channel.type)}
                    </Table.Cell>
                    <Table.Cell className="text-on-surface-variant">
                      <code className="text-xs bg-surface-container px-1.5 py-0.5 rounded">
                        {channel.id}
                      </code>
                    </Table.Cell>
                    <Table.Cell>
                      <Badge
                        variant="tonal"
                        color={channel.is_banned ? 'error' : 'success'}
                        size="sm"
                        pill
                      >
                        {channel.is_banned ? 'Banned' : 'Active'}
                      </Badge>
                    </Table.Cell>
                  </Table.Row>
                ))}
              {!channelsLoading && channels.length === 0 && (
                <Table.Empty
                  colSpan={4}
                  icon={<MessageSquare className="h-8 w-8" />}
                  message={
                    search.trim()
                      ? `No channels match "${search.trim()}"`
                      : 'No channels recorded for this server yet.'
                  }
                />
              )}
            </Table.Body>
          </Table.Root>
        </Table.ScrollArea>
      )}

      {selectedServer !== null && channelTotal > 0 && (
        <Table.Pagination
          currentPage={page}
          totalItems={channelTotal}
          itemsPerPage={20}
          onPageChange={setPage}
        />
      )}

      {channelsError !== null && (
        <div className="rounded-[var(--radius-card)] bg-error-container text-on-error-container px-4 py-3 text-body-md">
          {channelsError}
        </div>
      )}

      {selectedServer === null && !isLoading && servers.length === 0 && (
        <div className="bg-surface rounded-2xl p-10 flex flex-col items-center gap-3 text-center">
          <MessageSquare className="h-8 w-8 text-on-surface-variant" />
          <p className="text-body-md text-on-surface-variant">
            {isFluxer
              ? 'No Fluxer servers recorded yet. Send a message in a Fluxer server'
              : 'No Discord servers recorded yet. Send a message in a Discord server'}{' '}
            where this bot is present, then reload this page.
          </p>
        </div>
      )}

      {/* Ban server dialog */}
      <Dialog.Root
        open={banOpen}
        onOpenChange={(open) => {
          if (!open && !isBanning) setBanOpen(false)
        }}
        closeOnEsc={!isBanning}
        closeOnOverlayClick={!isBanning}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Ban Server</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-4">
                Banning{' '}
                <span className="font-semibold text-on-surface">
                  {selectedServer?.name ?? ''}
                </span>{' '}
                will stop the bot from responding in every channel of that
                server.
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
                  placeholder="Describe why this server is being banned…"
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
                onClick={() => void handleBanServer()}
                isLoading={isBanning}
                disabled={isBanning}
              >
                Ban Server
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Unban server dialog */}
      <Dialog.Root
        open={unbanOpen}
        onOpenChange={(open) => {
          if (!open && !isUnbanning) setUnbanOpen(false)
        }}
        closeOnEsc={!isUnbanning}
        closeOnOverlayClick={!isUnbanning}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Unban Server</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-4">
                Are you sure you want to unban{' '}
                <span className="font-semibold text-on-surface">
                  {selectedServer?.name ?? ''}
                </span>
                ? The bot will respond in that server again.
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
                onClick={() => void handleUnbanServer()}
                isLoading={isUnbanning}
                disabled={isUnbanning}
              >
                Unban Server
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Delete server dialog */}
      <Dialog.Root
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteOpen(false)
        }}
        closeOnEsc={!isDeleting}
        closeOnOverlayClick={!isDeleting}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Delete Server Record</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-2">
                This will remove{' '}
                <span className="font-semibold text-on-surface">
                  {selectedServer?.name ?? ''}
                </span>{' '}
                and its channels from this bot session&apos;s database. This
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
                onClick={() => void handleDeleteServer()}
                isLoading={isDeleting}
                disabled={isDeleting}
              >
                Delete Server
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
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
  // Discord and Fluxer both model groups as a server → channel hierarchy, so
  // they share the exact same group panel (server dropdown + scoped channels).
  const isServerHierarchy = bot?.platform === 'discord' || bot?.platform === 'fluxer'

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-headline-md font-semibold text-on-surface md:hidden">
          Database
        </h1>
        <p className="mt-1 text-body-md text-on-surface-variant md:mt-0 md:text-headline-md md:font-semibold md:text-on-surface">
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
      ) : isServerHierarchy ? (
        <ServerHierarchyGroupsTab
          platform={bot.platform}
          sessionId={sessionId}
          sessionKey={sessionKey}
        />
      ) : (
        <PlatformGroupsTab sessionId={sessionId} sessionKey={sessionKey} />
      )}
    </div>
  )
}
