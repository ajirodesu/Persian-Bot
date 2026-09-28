import { Helmet } from '@dr.pogodin/react-helmet'
import { useState } from 'react'
import { PLATFORM_LABELS, Platforms } from '@/constants/platform.constants'
import Table from '@/components/ui/data-display/Table'
import EmptyState from '@/components/ui/data-display/EmptyState'
import Input from '@/components/ui/forms/Input'
import { Bot, Search } from 'lucide-react'
import Skeleton from '@/components/ui/feedback/Skeleton'
import { useAdminBots } from '@/features/admin/hooks/useAdminBots'
import { useDebounce } from '@/hooks/useDebounce'
import Dialog from '@/components/ui/overlay/Dialog'
import Button from '@/components/ui/buttons/Button'
import Alert from '@/components/ui/feedback/Alert'
import adminService from '@/features/admin/services/admin.service'
import type { AdminBotItemDto } from '@/features/admin/services/admin.service'
import { getPlatformIcon } from '@/components/icons/platform-icon.util'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Small presentational pieces matching dashboard settings
// ============================================================================

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
        tone === 'accent' && 'bg-surface-container-high text-primary border-primary/30',
        tone === 'danger' && 'bg-surface-container-high text-error border-error/30',
        tone === 'default' && 'bg-surface-container-high text-on-surface-variant border-hairline',
      )}
    >
      {children}
    </span>
  )
}

function platformTileClasses(platform: string): string {
  switch (platform) {
    case Platforms.Discord:
      return 'bg-[#5865F2]/15 border-[#5865F2]/30 text-[#5865F2]'
    case Platforms.Telegram:
      return 'bg-[#24A1DE]/15 border-[#24A1DE]/30 text-[#24A1DE]'
    default:
      return 'bg-primary/10 border-primary/30 text-primary'
  }
}

function BotRowSkeleton() {
  return (
    <div className="p-3.5 flex items-center justify-between" aria-hidden="true">
      <div className="flex items-center space-x-3 min-w-0">
        <Skeleton variant="input" width={36} height={36} />
        <div className="flex flex-col gap-2">
          <Skeleton textSize="body-sm" width="128px" />
          <Skeleton textSize="body-sm" width="64px" />
        </div>
      </div>
      <Skeleton variant="pill" width={52} height={24} />
    </div>
  )
}

/**
 * AdminBotsPage
 *
 * Displays every bot session across all users — data sourced from /api/v1/admin/bots.
 * Replaces the previous mock data to give operators real platform health visibility.
 */
export default function AdminBotsPage() {
  const [page, setPage] = useState(1)
  const [searchQuery, setSearchQuery] = useState('')
  const debouncedSearch = useDebounce(searchQuery, 300)

  const [prevSearch, setPrevSearch] = useState(debouncedSearch)
  if (debouncedSearch !== prevSearch) {
    setPrevSearch(debouncedSearch)
    setPage(1)
  }

  // refetch drives list refresh after delete without a full page reload
  const { bots, total, stats, isLoading, error, refetch } = useAdminBots(
    page,
    10,
    debouncedSearch,
  )

  const activeBots = stats?.activeBots ?? 0
  const totalBots = stats?.totalBots ?? 0

  const [deleteTarget, setDeleteTarget] = useState<AdminBotItemDto | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const openDeleteDialog = (bot: AdminBotItemDto) => {
    setDeleteTarget(bot)
    setDeleteError(null)
  }

  // Guard against closing mid-request — same pattern as ban dialog in users.tsx
  const closeDeleteDialog = () => {
    if (isDeleting) return
    setDeleteTarget(null)
    setDeleteError(null)
  }

  const handleDeleteBot = async (): Promise<void> => {
    if (!deleteTarget) return
    setIsDeleting(true)
    setDeleteError(null)
    try {
      await adminService.deleteBot(deleteTarget.userId, deleteTarget.sessionId)
      setDeleteTarget(null)
      // Fire-and-forget refresh — dialog already closed, no need to await the re-fetch
      void refetch()
    } catch (err) {
      setDeleteError(
        err instanceof Error ? err.message : 'Failed to delete bot session',
      )
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col max-w-2xl lg:max-w-4xl w-full mx-auto">
      <Helmet>
        <title>Admin Bot Sessions · Cat-Bot</title>
      </Helmet>

      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            Bot Sessions
          </h2>
          {!isLoading && (
            <span className="text-[11px] font-mono font-medium text-surface-variant">
              {searchQuery.trim()
                ? `${total} of ${totalBots} matched`
                : `${activeBots} / ${totalBots} running`}
            </span>
          )}
        </div>

        {error !== null && (
          <Alert variant="tonal" color="error" title="Error" message={error} size="sm" />
        )}

        {/* Per-platform summary — skeleton while loading matches the row
            shape so the list never flashes placeholder zeros */}
        <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
          {isLoading ? (
            [0, 1, 2].map((i) => (
              <div
                key={`plat-skeleton-${i}`}
                className="p-3.5 flex items-center justify-between"
                aria-hidden="true"
              >
                <Skeleton textSize="body-sm" width="45%" />
                <Skeleton textSize="body-sm" width="72px" />
              </div>
            ))
          ) : (
            (['discord', 'fluxer', 'telegram'] as const).map((platform) => {
              // Stat derived from server's global knowledge
              const platTotal = stats?.platformDist?.[platform] ?? 0
              const platRunning = stats?.platformActiveDist?.[platform] ?? 0
              return (
                <div
                  key={platform}
                  className="p-3.5 flex items-center justify-between space-x-3"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <div
                      className={cn(
                        'w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0',
                        platformTileClasses(platform),
                      )}
                    >
                      {getPlatformIcon(platform, 'w-4 h-4')}
                    </div>
                    <span className="text-sm font-semibold text-on-surface truncate">
                      {PLATFORM_LABELS[platform] ?? platform}
                    </span>
                  </div>
                  <span className="text-[11px] font-mono text-on-surface-variant flex-shrink-0">
                    {platTotal} total · {platRunning} running
                  </span>
                </div>
              )
            })
          )}
        </div>

        <Input
          placeholder="Search bot sessions by nickname, owner, or platform…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          aria-label="Search bot sessions"
          className="h-11 text-sm"
        />

        {/* Only show global empty state if there are truly no bots in the system AND no active search */}
        {!isLoading &&
        bots.length === 0 &&
        error === null &&
        totalBots === 0 &&
        !searchQuery.trim() ? (
          <EmptyState
            icon={Bot}
            title="No bot sessions"
            description="There are currently no registered bot sessions across any platform."
          />
        ) : (
          <>
            {isLoading ? (
              <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
                {[0, 1, 2, 3, 4].map((i) => (
                  <BotRowSkeleton key={`skeleton-${i}`} />
                ))}
              </div>
            ) : bots.length === 0 ? (
              <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
                <p className="p-6 text-sm text-on-surface-variant italic text-center">
                  {searchQuery.trim()
                    ? `No bot sessions match "${searchQuery}"`
                    : 'No bot sessions found.'}
                </p>
              </div>
            ) : (
              <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
                {bots.map((session) => (
                  <div
                    key={`${session.userId}:${session.sessionId}`}
                    className="p-3.5 flex items-center justify-between space-x-3 max-sm:flex-col max-sm:items-stretch max-sm:gap-3 max-sm:space-x-0"
                  >
                    <div className="flex items-center space-x-3 min-w-0">
                      <div
                        className={cn(
                          'w-9 h-9 rounded-lg border flex items-center justify-center flex-shrink-0',
                          platformTileClasses(session.platform),
                        )}
                      >
                        {getPlatformIcon(session.platform, 'w-4 h-4')}
                      </div>
                      <div className="flex flex-col min-w-0">
                        <span className="text-sm font-semibold text-on-surface truncate leading-snug">
                          {session.nickname}
                        </span>
                        <span className="text-xs text-on-surface-variant truncate mt-0.5">
                          {session.userName || session.userEmail ? (
                            <>
                              {session.userName || 'Unknown User'}
                              {session.userEmail
                                ? ` · ${session.userEmail}`
                                : ''}
                            </>
                          ) : (
                            // Fall back to raw cuid2 when the user row was deleted from the auth DB.
                            <span className="font-mono">{session.userId}</span>
                          )}
                        </span>
                        <span className="flex items-center space-x-1.5 mt-1 flex-wrap gap-y-1">
                          <MonoChip tone="default">
                            {PLATFORM_LABELS[session.platform] ?? session.platform}
                          </MonoChip>
                          <MonoChip tone="default">{session.prefix}</MonoChip>
                          <MonoChip tone={session.isRunning ? 'accent' : 'default'}>
                            {session.isRunning ? 'Running' : 'Stopped'}
                          </MonoChip>
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => openDeleteDialog(session)}
                      aria-label={`Delete ${session.nickname}`}
                      className="px-2.5 py-1 text-xs font-semibold rounded bg-error/10 hover:bg-error/15 border border-error/30 text-error transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-error/40 flex-shrink-0"
                    >
                      Delete
                    </button>
                  </div>
                ))}
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
          </>
        )}
      </div>

      {/* Delete dialog — controlled by deleteTarget state; no Trigger needed.
          closeOnEsc / closeOnOverlayClick disabled mid-request to prevent abandoning
          an in-flight delete that has already torn down the live transport. */}
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
              <Dialog.Title>Delete Bot Session</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-sm text-on-surface-variant mb-4">
                Are you sure you want to permanently delete{' '}
                <span className="font-semibold text-on-surface">
                  {deleteTarget?.nickname}
                </span>{' '}
                owned by{' '}
                <span className="font-semibold text-on-surface">
                  {deleteTarget?.userName ??
                    deleteTarget?.userEmail ??
                    deleteTarget?.userId}{' '}
                  ({deleteTarget?.userEmail})
                </span>
                ? This action cannot be undone and removes all associated data.
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
              <Button
                color="error"
                size="sm"
                onClick={() => void handleDeleteBot()}
                isLoading={isDeleting}
                disabled={isDeleting}
              >
                Yes, Delete Bot
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </div>
  )
}
