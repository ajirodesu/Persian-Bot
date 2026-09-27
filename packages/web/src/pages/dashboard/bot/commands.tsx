import { useState, useCallback } from 'react'
import { Search, ShieldOff, Terminal, ChevronRight } from 'lucide-react'
import Alert from '@/components/ui/feedback/Alert'
import Switch from '@/components/ui/forms/Switch'
import Input from '@/components/ui/forms/Input'
import Dialog from '@/components/ui/overlay/Dialog'
import DataList from '@/components/ui/data-display/DataList'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'
import { useBotCommands } from '@/features/users/hooks/useBotCommands'
import type { BotCommandItemDto } from '@/features/users/dtos/bot.dto'
import Pagination from '@/components/ui/navigation/Pagination'
import { useDebounce } from '@/hooks/useDebounce'
import Skeleton from '@/components/ui/feedback/Skeleton'
import { cn } from '@/utils/cn.util'

const ROLE_LABEL: Record<number, string> = {
  0: 'Anyone',
  1: 'Group Admin',
  2: 'Bot Admin',
  3: 'Premium',
  4: 'System Admin',
}

// ============================================================================
// Small presentational pieces matching dashboard settings
// ============================================================================

function RowChevron({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center pl-3 flex-shrink-0',
        className ?? 'text-surface-variant',
      )}
    >
      <ChevronRight className="w-4 h-4" strokeWidth={2} />
    </div>
  )
}

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
        tone === 'accent' &&
          'bg-primary/10 border-primary/30 text-primary',
        tone === 'danger' &&
          'bg-error/10 border-error/30 text-error',
        tone === 'default' && 'bg-surface-container-high border-hairline text-on-surface-variant',
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
  tone?: 'default' | 'accent' | 'danger' | 'warning'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border',
        tone === 'accent' && 'bg-surface-container-high text-primary border-primary/30',
        tone === 'danger' && 'bg-surface-container-high text-error border-error/30',
        tone === 'warning' && 'bg-surface-container-high text-warning border-warning/30',
        tone === 'default' && 'bg-surface-container-high text-on-surface-variant border-hairline',
      )}
    >
      {children}
    </span>
  )
}

// ── Command Detail Popup ─────────────────────────────────────────────────────
//
// Every command's full detail (description, usage, aliases, cooldown, author)
// plus both of its live switches now live here, behind a click, instead of
// being crammed onto the row. Keeps the list scannable while still surfacing
// everything one click away — consistent with the Database panel's DetailDialog.

interface CommandDetailDialogProps {
  command: BotCommandItemDto | null
  prefix: string
  onClose: () => void
  onToggleEnabled: (name: string, isEnable: boolean) => void
  onToggleIgnoreAdminOnly: (name: string, ignored: boolean) => void
}

function CommandDetailDialog({
  command,
  prefix,
  onClose,
  onToggleEnabled,
  onToggleIgnoreAdminOnly,
}: CommandDetailDialogProps) {
  const open = command !== null

  const hasMetadata =
    command !== null &&
    (command.usage ||
      (command.aliases && command.aliases.length > 0) ||
      (command.cooldown !== undefined && command.cooldown > 0) ||
      command.author ||
      command.version)

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Positioner position="center">
        <Dialog.Backdrop />
        <Dialog.Content size="sm" className="flex flex-col max-h-[90dvh]">
          {command && (
            <>
              {/* ── Header ──────────────────────────────────────────────── */}
              <Dialog.Header className="items-start gap-3 pb-3 shrink-0">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <IconWell tone={command.isEnable ? 'accent' : 'default'}>
                    <Terminal className="w-4 h-4" strokeWidth={2} />
                  </IconWell>
                  <div className="min-w-0">
                    <Dialog.Title className="font-mono text-base leading-tight truncate">
                      {prefix}
                      {command.commandName}
                    </Dialog.Title>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      <MonoChip tone={command.isEnable ? 'accent' : 'default'}>
                        {command.isEnable ? 'Enabled' : 'Disabled'}
                      </MonoChip>
                      {command.role !== undefined && (
                        <MonoChip tone="accent">
                          {ROLE_LABEL[command.role] ?? 'Unknown'}
                        </MonoChip>
                      )}
                      {command.ignoresAdminOnly && (
                        <MonoChip tone="warning">Admin-Only Exempt</MonoChip>
                      )}
                    </div>
                  </div>
                </div>
                <Dialog.CloseTrigger />
              </Dialog.Header>

              <Dialog.Body className="flex flex-col gap-0 pt-0 pb-2 flex-1 !max-h-none overflow-y-auto">
                {/* Description */}
                {command.description && (
                  <p className="text-sm text-on-surface-variant leading-relaxed mb-4">
                    {command.description}
                  </p>
                )}

                {/* Metadata table */}
                {hasMetadata && (
                  <div className="mb-4">
                    <DataList.Root size="sm" divideY>
                      {command.usage && (
                        <DataList.Item>
                          <DataList.ItemLabel>Usage</DataList.ItemLabel>
                          <DataList.ItemValue>
                            <span className="font-mono break-all">
                              {prefix}
                              {command.commandName} {command.usage}
                            </span>
                          </DataList.ItemValue>
                        </DataList.Item>
                      )}
                      {command.aliases && command.aliases.length > 0 && (
                        <DataList.Item>
                          <DataList.ItemLabel>Aliases</DataList.ItemLabel>
                          <DataList.ItemValue>
                            {command.aliases.map((a) => prefix + a).join(', ')}
                          </DataList.ItemValue>
                        </DataList.Item>
                      )}
                      {command.cooldown !== undefined && command.cooldown > 0 && (
                        <DataList.Item>
                          <DataList.ItemLabel>Cooldown</DataList.ItemLabel>
                          <DataList.ItemValue>
                            {command.cooldown}s
                          </DataList.ItemValue>
                        </DataList.Item>
                      )}
                      {command.author && (
                        <DataList.Item>
                          <DataList.ItemLabel>Author</DataList.ItemLabel>
                          <DataList.ItemValue>{command.author}</DataList.ItemValue>
                        </DataList.Item>
                      )}
                      {command.version && (
                        <DataList.Item>
                          <DataList.ItemLabel>Version</DataList.ItemLabel>
                          <DataList.ItemValue>
                            v{command.version}
                          </DataList.ItemValue>
                        </DataList.Item>
                      )}
                    </DataList.Root>
                  </div>
                )}

                {/* ── Settings section ──────────────────────────────────── */}
                <div className="pt-4 pb-1">
                  <p className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider mb-3 px-0.5">
                    Settings
                  </p>

                  {/* Switch row 1 — Commands */}
                  <div className="p-3.5 flex items-center justify-between space-x-3 bg-surface-container-low border border-hairline rounded-xl mb-2.5">
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold text-on-surface leading-snug">
                        Commands
                      </span>
                      <span className="text-xs text-on-surface-variant mt-0.5">
                        Enable or disable this command during dispatch.
                      </span>
                    </div>
                    <div className="flex-shrink-0">
                      <Switch
                        checked={command.isEnable}
                        onChange={() =>
                          onToggleEnabled(command.commandName, !command.isEnable)
                        }
                      />
                    </div>
                  </div>

                  {/* Switch row 2 — Bot Admin Only */}
                  <div className="p-3.5 flex items-center justify-between space-x-3 bg-surface-container-low border border-hairline rounded-xl">
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-semibold text-on-surface leading-snug">
                        Bot Admin Only
                      </span>
                      <span className="text-xs text-on-surface-variant mt-0.5">
                        Exempt this command from session-wide admin-only mode.
                      </span>
                    </div>
                    <div className="flex-shrink-0">
                      <Switch
                        checked={command.ignoresAdminOnly}
                        onChange={() =>
                          onToggleIgnoreAdminOnly(
                            command.commandName,
                            !command.ignoresAdminOnly,
                          )
                        }
                      />
                    </div>
                  </div>
                </div>
              </Dialog.Body>
            </>
          )}
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}

// Memoized so list re-renders don't repaint a closed dialog.
const CommandDetailDialogMemo = CommandDetailDialog

function CommandRowSkeleton() {
  return (
    <div className="p-3.5 flex items-center justify-between" aria-hidden="true">
      <div className="flex items-center space-x-3 min-w-0">
        <Skeleton variant="input" width={36} height={36} />
        <div className="flex flex-col gap-2">
          <Skeleton textSize="body-sm" width="128px" />
          <Skeleton textSize="body-sm" width="64px" />
        </div>
      </div>
      <Skeleton variant="pill" width={16} height={16} />
    </div>
  )
}

/**
 * Commands Page — /dashboard/bot/commands?id=xxx
 * Decouples the command fetching so the layout does not re-render.
 */
export default function BotCommandsPage() {
  const { bot, id } = useBotContext()

  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const debouncedQuery = useDebounce(query, 300)

  const [prevQuery, setPrevQuery] = useState(debouncedQuery)
  if (debouncedQuery !== prevQuery) {
    setPrevQuery(debouncedQuery)
    setPage(1)
  }

  const {
    commands,
    total,
    isLoading,
    error,
    toggleCommand,
    toggleIgnoreAdminOnly,
  } = useBotCommands(id, page, 12, debouncedQuery)

  // Track the open popup by name (not the object itself) so it stays in sync
  // with `commands` after an optimistic toggle re-renders the list.
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const selectedCommand =
    commands.find((c) => c.commandName === selectedName) ?? null

  // Stable callback refs — prevent CommandDetailDialog re-rendering on every
  // list keystroke or pagination update when the dialog is open.
  const handleClose = useCallback(() => setSelectedName(null), [])
  const handleToggleEnabled = useCallback(
    (name: string, isEnable: boolean) => void toggleCommand(name, isEnable),
    [toggleCommand],
  )
  const handleToggleIgnoreAdminOnly = useCallback(
    (name: string, ignored: boolean) =>
      void toggleIgnoreAdminOnly(name, ignored),
    [toggleIgnoreAdminOnly],
  )

  return (
    <div className="flex flex-col max-w-[400px] md:max-w-2xl w-full mx-auto">
      <div className="space-y-2 pt-1">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            Commands
          </h2>
          <span className="text-[11px] font-mono font-medium text-surface-variant">
            {isLoading
              ? 'Loading…'
              : query.trim()
                ? `${total} matched`
                : `${total} total`}
          </span>
        </div>

        {error && (
          <Alert variant="tonal" color="error" title="Error" message={error} size="sm" />
        )}

        <Input
          placeholder="Search commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4" />}
          aria-label="Search commands"
          className="h-11 text-sm"
        />

        {/* Keep the search bar visible; swap only the list for skeletons while fetching */}
        {isLoading ? (
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {Array.from({ length: 6 }).map((_, i) => (
              <CommandRowSkeleton key={i} />
            ))}
          </div>
        ) : commands.length === 0 ? (
          <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
            <p className="p-6 text-sm text-on-surface-variant italic text-center">
              {query.trim()
                ? `No commands match "${query}"`
                : 'No commands synced yet — start the bot to populate this list.'}
            </p>
          </div>
        ) : (
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {commands.map((cmd) => (
              <article
                key={cmd.commandName}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedName(cmd.commandName)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    setSelectedName(cmd.commandName)
                  }
                }}
                className="p-3.5 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest tactile-press cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
              >
                <div className="flex items-center space-x-3 min-w-0">
                  <IconWell tone={cmd.isEnable ? 'accent' : 'default'}>
                    <Terminal className="w-4 h-4" strokeWidth={2} />
                  </IconWell>
                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-semibold text-on-surface truncate leading-snug font-mono">
                      {bot.prefix}
                      {cmd.commandName}
                    </span>
                    <span className="flex items-center space-x-1.5 mt-1 flex-wrap gap-y-1">
                      <MonoChip tone={cmd.isEnable ? 'accent' : 'default'}>
                        {cmd.isEnable ? 'ON' : 'OFF'}
                      </MonoChip>
                      {cmd.role !== undefined && (
                        <MonoChip tone="accent">
                          {ROLE_LABEL[cmd.role] ?? 'Unknown'}
                        </MonoChip>
                      )}
                      {cmd.ignoresAdminOnly && (
                        <MonoChip tone="warning">
                          <ShieldOff className="h-3 w-3 mr-0.5" />
                          Exempt
                        </MonoChip>
                      )}
                    </span>
                    {cmd.description && (
                      <span className="text-xs text-on-surface-variant truncate mt-0.5">
                        {cmd.description}
                      </span>
                    )}
                  </div>
                </div>
                <RowChevron />
              </article>
            ))}
          </div>
        )}

        {/* Hide pagination while loading to prevent stale total counts from rendering */}
        {!isLoading && total > 0 && (
          <div className="pt-2 flex justify-center">
            <Pagination
              currentPage={page}
              totalItems={total}
              itemsPerPage={12}
              onPageChange={setPage}
            />
          </div>
        )}
      </div>

      <CommandDetailDialogMemo
        command={selectedCommand}
        prefix={bot.prefix}
        onClose={handleClose}
        onToggleEnabled={handleToggleEnabled}
        onToggleIgnoreAdminOnly={handleToggleIgnoreAdminOnly}
      />
    </div>
  )
}
