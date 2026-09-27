/**
 * Database Panel — session-scoped user & group management.
 *
 * Shows every user and group this bot session has interacted with.
 * Admins can search, filter, sort, inspect, ban/unban, or remove records.
 *
 * Design: Bot Manager grouped-row language —
 *   • Section header counts, plain h-11 search inputs, Select filters,
 *     raw icon refresh button, mono count text (DatabaseToolbar)
 *   • Users / groups / channels as hairline grouped rows with IconWell
 *     tiles, mono ID chips, mono status chips, and compact raw
 *     Ban / Unban / Delete actions
 *   • Table.Pagination for paging, grouped empty states
 *   • Dialog-scoped loading/error state, closeOnEsc/closeOnOverlayClick
 *     disabled mid-request, Dialog.CloseTrigger asChild Cancel buttons,
 *     Field + Textarea for the optional ban reason
 *   • Alert size="sm" for page-level fetch errors
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
import Alert from '@/components/ui/feedback/Alert'
import Table from '@/components/ui/data-display/Table'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Dialog from '@/components/ui/overlay/Dialog'
import DataList from '@/components/ui/data-display/DataList'
import { cn } from '@/utils/cn.util'
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

// Small presentational pieces matching dashboard settings: IconWell tiles,
// mono status chips, and compact raw action buttons.

function IconWell({
  children,
  tone = 'default',
}: {
  children: React.ReactNode
  tone?: 'default' | 'accent' | 'danger'
}) {
  return (
    <div
      className={cn(
        'w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0',
        tone === 'accent' && 'bg-primary/10 border-primary/30 text-primary',
        tone === 'danger' && 'bg-error/10 border-error/30 text-error',
        tone === 'default' &&
          'bg-surface-container-high border-hairline text-on-surface-variant',
      )}
    >
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

function RowSkeleton() {
  return (
    <div className="p-3.5 flex items-center justify-between" aria-hidden="true">
      <div className="flex items-center space-x-3 min-w-0">
        <Skeleton variant="input" width={36} height={36} />
        <div className="flex flex-col gap-2">
          <Skeleton textSize="body-sm" width="128px" />
          <Skeleton textSize="body-sm" width="64px" />
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <Skeleton variant="pill" width={44} height={24} />
        <Skeleton variant="pill" width={52} height={24} />
      </div>
    </div>
  )
}

// Compact raw action buttons (settings vocabulary).
const ROW_BTN =
  'px-2.5 py-1 text-xs font-semibold rounded border transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex-shrink-0'
const ROW_BTN_ACCENT =
  'bg-primary/10 hover:bg-primary/15 border-primary/30 text-primary'
const ROW_BTN_DANGER =
  'bg-error/10 hover:bg-error/15 border-error/30 text-error'

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
              <MonoChip tone={isBanned ? 'danger' : 'accent'}>
                {isBanned ? 'Banned' : 'Active'}
              </MonoChip>
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
  sortBy,
  sortDir,
  onSortChange,
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
  /** Optional column sort (users tab) — selecting a column re-toggles direction. */
  sortBy?: BotDatabaseSortBy
  sortDir?: 'asc' | 'desc' | null
  onSortChange?: (v: BotDatabaseSortBy) => void
}) {
  const sortArrow = (column: BotDatabaseSortBy) =>
    sortBy === column ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''

  return (
    <div className="flex flex-col gap-3">
      <Input
        placeholder={searchPlaceholder}
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        leftIcon={<Search className="h-4 w-4" />}
        aria-label={searchPlaceholder}
        className="h-11 text-sm"
      />
      <div className="flex items-center gap-2 min-w-0">
        {onTypeChange && type && (
          <Select
            options={typeOptions}
            value={type}
            onChange={(v) => onTypeChange(v as BotDatabaseTypeFilter)}
            size="sm"
            className="min-w-0 flex-1"
          />
        )}
        <Select
          options={statusOptions}
          value={status}
          onChange={(v) => onStatusChange(v as BotDatabaseStatusFilter)}
          size="sm"
          className="min-w-0 flex-1"
        />
        {onSortChange && sortBy && (
          <Select
            options={[
              { value: 'name', label: `Name${sortArrow('name')}` },
              { value: 'last_seen', label: `Seen${sortArrow('last_seen')}` },
            ]}
            value={sortBy}
            onChange={(v) => onSortChange(v as BotDatabaseSortBy)}
            size="sm"
            className="min-w-0 flex-1"
            aria-label="Sort by"
          />
        )}
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh"
          className="p-2 rounded-lg border border-hairline bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex-shrink-0"
        >
          <RefreshCw
            className={cn('h-4 w-4', isLoading && 'animate-spin')}
            strokeWidth={2}
          />
        </button>
        <span className="text-[11px] font-mono font-medium text-surface-variant flex-shrink-0 ml-auto">
          {isLoading
            ? 'Loading…'
            : search.trim() || status !== 'all' || (type && type !== 'all')
              ? `${total} matched`
              : matchedLabel}
        </span>
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

  return (
    <div className="flex flex-col gap-4">
      <DatabaseToolbar
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search users by name, username, or ID…"
        status={status}
        onStatusChange={setStatus}
        sortBy={sortBy}
        sortDir={sortDir}
        onSortChange={toggleSort}
        total={total}
        matchedLabel={`${total} total`}
        isLoading={isLoading}
        onRefresh={refetch}
      />

      {error !== null && (
        <Alert variant="tonal" color="error" title="Error" message={error} size="sm" />
      )}

      {isLoading ? (
        <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={`user-skeleton-${i}`} />
          ))}
        </div>
      ) : users.length === 0 ? (
        <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
          <p className="p-6 text-sm text-on-surface-variant italic text-center">
            {search.trim()
              ? `No users match "${search.trim()}"`
              : status !== 'all'
                ? `No ${status} users found`
                : 'No users found.'}
          </p>
        </div>
      ) : (
        <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
          {users.map((user) => (
            <div
              key={user.id}
              className="p-3.5 flex items-center justify-between space-x-3"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <IconWell>
                  <Users className="h-4 w-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center space-x-2 min-w-0 flex-wrap gap-y-1">
                    <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                      {userDisplayName(user)}
                    </span>
                    <MonoChip tone={user.is_banned ? 'danger' : 'accent'}>
                      {user.is_banned ? 'Banned' : 'Active'}
                    </MonoChip>
                  </div>
                  <span className="text-[11px] font-mono text-on-surface-variant truncate mt-0.5">
                    {user.id} · {formatDate(user.last_seen, timezone)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1.5 flex-shrink-0 flex-wrap">
                <button
                  type="button"
                  aria-label={`View details for ${userDisplayName(user)}`}
                  onClick={() => setDetailUser(user)}
                  className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Eye className="h-3.5 w-3.5" strokeWidth={2} />
                </button>
                {user.is_banned ? (
                  <button
                    type="button"
                    disabled={pending.has(user.id)}
                    onClick={() => openUnbanDialog(user)}
                    className={cn(ROW_BTN, ROW_BTN_ACCENT)}
                  >
                    Unban
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => openBanDialog(user)}
                    className={cn(ROW_BTN, ROW_BTN_DANGER)}
                  >
                    Ban
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => openDeleteDialog(user)}
                  className={cn(ROW_BTN, ROW_BTN_DANGER)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
        <Alert variant="tonal" color="error" title="Error" message={error} size="sm" />
      )}

      {/* Flat group list — Telegram-style platforms have no server hierarchy,
          so every group is a first-class row with its type, member count,
          activity, status, and per-row ban/unban/delete actions. This mirrors
          the Users tab's row treatment instead of the Discord/Fluxer
          server → channels drill-down. */}
      {isLoading ? (
        <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
          {[0, 1, 2, 3, 4].map((i) => (
            <RowSkeleton key={`group-skeleton-${i}`} />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
          <div className="p-6 flex flex-col items-center gap-3 text-center">
            <MessageSquare className="h-8 w-8 text-on-surface-variant" />
            <p className="text-sm text-on-surface-variant italic">
              {search.trim() || status !== 'all' || type !== 'all'
                ? 'No groups match the current search or filters.'
                : 'No groups recorded yet. Send a message in a group, supergroup, or channel where this bot is present, then reload this page.'}
            </p>
          </div>
        </div>
      ) : (
        <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
          {groups.map((group) => (
            <div
              key={group.id}
              className="p-3.5 flex items-center justify-between space-x-3"
            >
              <div className="flex items-center space-x-3 min-w-0">
                <IconWell>
                  <MessageSquare className="h-4 w-4" strokeWidth={2} />
                </IconWell>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center space-x-2 min-w-0 flex-wrap gap-y-1">
                    <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                      {group.name}
                    </span>
                    <MonoChip tone="default">
                      {groupTypeLabel(group)}
                    </MonoChip>
                    <MonoChip tone={group.is_banned ? 'danger' : 'accent'}>
                      {group.is_banned ? 'Banned' : 'Active'}
                    </MonoChip>
                  </div>
                  <span className="text-[11px] font-mono text-on-surface-variant truncate mt-0.5">
                    {group.id} ·{' '}
                    {group.member_count != null
                      ? `${group.member_count.toLocaleString()} members`
                      : 'members unknown'}{' '}
                    · {formatDate(group.last_seen, timezone)}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-end gap-1.5 flex-shrink-0 flex-wrap">
                {group.is_banned ? (
                  <button
                    type="button"
                    onClick={() => {
                      setActionTarget(group)
                      setUnbanError(null)
                      setUnbanOpen(true)
                    }}
                    className={cn(ROW_BTN, ROW_BTN_ACCENT)}
                  >
                    Unban
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActionTarget(group)
                      setBanReason('')
                      setBanError(null)
                      setBanOpen(true)
                    }}
                    className={cn(ROW_BTN, ROW_BTN_DANGER)}
                  >
                    Ban
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setActionTarget(group)
                    setDeleteError(null)
                    setDeleteOpen(true)
                  }}
                  className={cn(ROW_BTN, ROW_BTN_DANGER)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

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
      <div className="flex flex-col gap-3">
        <Select
          options={serverOptions}
          value={selectedServerId ?? ''}
          onChange={(v) => setSelectedServerId(v as string)}
          placeholder={
            servers.length > 0 ? 'Select a server…' : 'No servers found'
          }
          aria-label="Select a server"
        />
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => {
              refetch()
              refetchChannels()
            }}
            disabled={isLoading}
            className="p-2 rounded-lg border border-hairline bg-surface-container-high text-on-surface-variant hover:text-on-surface transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex-shrink-0"
          >
            <RefreshCw
              className={cn('h-4 w-4', isLoading && 'animate-spin')}
              strokeWidth={2}
            />
          </button>
          <span className="text-[11px] font-mono font-medium text-surface-variant flex-shrink-0 ml-auto">
            {isLoading ? 'Loading…' : `${total} total`}
          </span>
        </div>
      </div>

      {error !== null && (
        <Alert variant="tonal" color="error" title="Error" message={error} size="sm" />
      )}

      {/* Selected server header + actions */}
      {selectedServer !== null && (
        <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
          <div className="p-3.5 flex items-center justify-between space-x-3">
            <div className="flex items-center space-x-3 min-w-0">
              <IconWell>
                <MessageSquare className="h-4 w-4" strokeWidth={2} />
              </IconWell>
              <div className="flex flex-col min-w-0">
                <div className="flex items-center space-x-2 min-w-0 flex-wrap gap-y-1">
                  <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                    {selectedServer.name ?? selectedServer.id}
                  </span>
                  <MonoChip tone="default">Server</MonoChip>
                  <MonoChip tone={selectedServer.is_banned ? 'danger' : 'accent'}>
                    {selectedServer.is_banned ? 'Banned' : 'Active'}
                  </MonoChip>
                </div>
                <span className="text-[11px] font-mono text-on-surface-variant truncate mt-0.5">
                  {selectedServer.member_count != null
                    ? `${selectedServer.member_count.toLocaleString()} members`
                    : 'Member count unknown'}{' '}
                  · {formatDate(selectedServer.last_seen, timezone)}
                </span>
              </div>
            </div>
            <div className="flex items-center justify-end gap-1.5 flex-shrink-0 flex-wrap">
              {selectedServer.is_banned ? (
                <button
                  type="button"
                  onClick={() => {
                    setUnbanError(null)
                    setUnbanOpen(true)
                  }}
                  className={cn(ROW_BTN, ROW_BTN_ACCENT)}
                >
                  Unban
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setBanReason('')
                    setBanError(null)
                    setBanOpen(true)
                  }}
                  className={cn(ROW_BTN, ROW_BTN_DANGER)}
                >
                  Ban
                </button>
              )}
              <button
                type="button"
                onClick={() => {
                  setDeleteError(null)
                  setDeleteOpen(true)
                }}
                className={cn(ROW_BTN, ROW_BTN_DANGER)}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Channel search */}
      {selectedServer !== null && (
        <Input
          placeholder="Search channels by name or ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          aria-label="Search channels by name or ID"
          className="h-11 text-sm"
        />
      )}

      {/* Channels table */}
      {selectedServer !== null && (
        <>
          {channelsLoading ? (
            <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
              {[0, 1, 2, 3, 4].map((i) => (
                <RowSkeleton key={`channel-skeleton-${i}`} />
              ))}
            </div>
          ) : channels.length === 0 ? (
            <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
              <div className="p-6 flex flex-col items-center gap-3 text-center">
                <MessageSquare className="h-8 w-8 text-on-surface-variant" />
                <p className="text-sm text-on-surface-variant italic">
                  {search.trim()
                    ? `No channels match "${search.trim()}"`
                    : 'No channels recorded for this server yet.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
              {channels.map((channel) => (
                <div
                  key={channel.id}
                  className="p-3.5 flex items-center justify-between space-x-3"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <IconWell>
                      <MessageSquare className="h-4 w-4" strokeWidth={2} />
                    </IconWell>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center space-x-2 min-w-0 flex-wrap gap-y-1">
                        <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                          {channel.name ?? 'Untitled channel'}
                        </span>
                        <MonoChip tone="default">
                          {channelTypeLabel(channel.type)}
                        </MonoChip>
                        <MonoChip tone={channel.is_banned ? 'danger' : 'accent'}>
                          {channel.is_banned ? 'Banned' : 'Active'}
                        </MonoChip>
                      </div>
                      <span className="text-[11px] font-mono text-on-surface-variant truncate mt-0.5">
                        {channel.id}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
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
        <Alert variant="tonal" color="error" title="Error" message={channelsError} size="sm" />
      )}

      {selectedServer === null && !isLoading && servers.length === 0 && (
        <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
          <div className="p-6 flex flex-col items-center gap-3 text-center">
            <MessageSquare className="h-8 w-8 text-on-surface-variant" />
            <p className="text-sm text-on-surface-variant italic">
              {isFluxer
                ? 'No Fluxer servers recorded yet. Send a message in a Fluxer server'
                : 'No Discord servers recorded yet. Send a message in a Discord server'}{' '}
              where this bot is present, then reload this page.
            </p>
          </div>
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
    <div className="flex flex-col max-w-2xl lg:max-w-4xl w-full mx-auto">
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
