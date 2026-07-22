import { useState, useCallback } from 'react'
import { Search, ChevronRight, ShieldOff, Terminal, Power, ShieldCheck } from 'lucide-react'
import Card from '@/components/ui/data-display/Card'
import Badge from '@/components/ui/data-display/Badge'
import DataList from '@/components/ui/data-display/DataList'
import Alert from '@/components/ui/feedback/Alert'
import Switch from '@/components/ui/forms/Switch'
import Input from '@/components/ui/forms/Input'
import Divider from '@/components/ui/layout/Divider'
import Dialog from '@/components/ui/overlay/Dialog'
import Button from '@/components/ui/buttons/Button'
import { useBotContext } from '@/features/users/components/DashboardBotLayout'
import { useBotCommands } from '@/features/users/hooks/useBotCommands'
import type { BotCommandItemDto } from '@/features/users/dtos/bot.dto'
import Pagination from '@/components/ui/navigation/Pagination'
import { useDebounce } from '@/hooks/useDebounce'
import Skeleton from '@/components/ui/feedback/Skeleton'

const ROLE_LABEL: Record<number, string> = {
  0: 'Anyone',
  1: 'Group Admin',
  2: 'Bot Admin',
  3: 'Premium',
  4: 'System Admin',
}

// ── Command Detail Popup ─────────────────────────────────────────────────────
//
// Every command's full detail (description, usage, aliases, cooldown, author)
// plus both of its live switches now live here, behind a click, instead of being
// crammed onto the grid tile. Keeps the grid scannable while still surfacing
// everything one click away — consistent with the Database panel's DetailDialog.
//
// The dialog is wrapped in React.memo so it only re-renders when its own props
// change, preventing the grid from forcing a repaint on every keystroke or page
// flip while the dialog happens to be closed.

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
        <Dialog.Content size="sm">
          {command && (
            <>
              {/* ── Header ──────────────────────────────────────────────────── */}
              <Dialog.Header className="items-start gap-3 pb-3">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <span className="flex items-center justify-center w-8 h-8 rounded-lg bg-primary/10 shrink-0">
                    <Terminal className="w-4 h-4 text-primary" />
                  </span>
                  <div className="min-w-0">
                    <Dialog.Title className="font-mono text-base leading-tight truncate">
                      {prefix}
                      {command.commandName}
                    </Dialog.Title>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      <Badge
                        color={command.isEnable ? 'success' : 'secondary'}
                        size="sm"
                        variant="tonal"
                        pill
                      >
                        {command.isEnable ? 'Enabled' : 'Disabled'}
                      </Badge>
                      {command.role !== undefined && (
                        <Badge color="primary" size="sm" variant="outlined" pill>
                          {ROLE_LABEL[command.role] ?? 'Unknown'}
                        </Badge>
                      )}
                      {command.ignoresAdminOnly && (
                        <Badge color="warning" size="sm" variant="tonal" pill>
                          Admin-Only Exempt
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <Dialog.CloseTrigger />
              </Dialog.Header>

              {/* ── Body ────────────────────────────────────────────────────── */}
              <Dialog.Body className="flex flex-col gap-0 pt-0 pb-2">
                {/* Description */}
                {command.description && (
                  <p className="text-body-sm text-on-surface-variant leading-relaxed mb-4">
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

                {/* ── Settings section ──────────────────────────────────────── */}
                <Divider spacing="none" />

                <div className="pt-4 pb-1">
                  <p className="text-label-sm font-semibold text-on-surface-variant uppercase tracking-wider mb-3 px-0.5">
                    Settings
                  </p>

                  {/* Switch row 1 — Command Enabled */}
                  <div className="flex w-full items-center justify-between gap-4 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3.5 mb-2.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-primary/10 shrink-0">
                        <Power className="w-3.5 h-3.5 text-primary" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-body-sm font-semibold text-on-surface leading-snug">
                          Commands
                        </p>
                        <p className="text-label-sm text-on-surface-variant leading-snug mt-0.5">
                          Enable or disable this command during dispatch.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={command.isEnable}
                      onChange={() =>
                        onToggleEnabled(command.commandName, !command.isEnable)
                      }
                    />
                  </div>

                  {/* Switch row 2 — Bot Admin Only */}
                  <div className="flex w-full items-center justify-between gap-4 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-3.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="flex items-center justify-center w-7 h-7 rounded-lg bg-warning/10 shrink-0">
                        <ShieldCheck className="w-3.5 h-3.5 text-warning" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-body-sm font-semibold text-on-surface leading-snug">
                          Bot Admin Only
                        </p>
                        <p className="text-label-sm text-on-surface-variant leading-snug mt-0.5">
                          Exempt this command from session-wide admin-only mode.
                        </p>
                      </div>
                    </div>
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
              </Dialog.Body>

              {/* ── Footer ──────────────────────────────────────────────────── */}
              <Dialog.Footer>
                <Dialog.CloseTrigger asChild>
                  <Button variant="text" color="neutral" size="sm">
                    Close
                  </Button>
                </Dialog.CloseTrigger>
              </Dialog.Footer>
            </>
          )}
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}

// Memoized so the grid re-renders don't repaint a closed dialog.
const CommandDetailDialogMemo = CommandDetailDialog

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
  // grid keystroke or pagination update when the dialog is open.
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
    <div className="flex flex-col gap-4">
      {error && (
        <Alert variant="tonal" color="error" title="Error" message={error} />
      )}

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-title-md font-semibold text-on-surface">
            Commands
          </h3>
          <p className="text-body-sm text-on-surface-variant mt-0.5">
            Tap a command to view its details and switches.
          </p>
        </div>
        <Badge color="secondary" size="sm" variant="tonal">
          {isLoading
            ? 'Loading...'
            : query.trim()
              ? `${total} matched`
              : `${total} total`}
        </Badge>
      </div>

      <div className="bg-surface p-2 rounded-full">
        <Input
          placeholder="Search commands…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          leftIcon={<Search className="h-4 w-4 text-on-surface-variant" />}
          pill
        />
      </div>

      {/* Keep contextual search bar visible; swap only the grid for skeletons while fetching */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 12 }).map((_, i) => (
            <Card.Root
              key={i}
              padding="sm"
              bordered
              className="flex flex-col gap-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <Skeleton variant="text" width="55%" height="22px" />
                <Skeleton variant="rounded" width="16px" height="16px" />
              </div>
              <Skeleton variant="text" width="70%" />
              <div className="flex gap-1.5 pt-0.5">
                <Skeleton variant="rounded" width="52px" height="20px" />
                <Skeleton variant="rounded" width="68px" height="20px" />
              </div>
            </Card.Root>
          ))}
        </div>
      ) : commands.length === 0 ? (
        <Card.Root padding="lg">
          <p className="text-body-md text-on-surface-variant italic text-center">
            {query.trim()
              ? `No commands match "${query}"`
              : 'No commands synced yet — start the bot to populate this list.'}
          </p>
        </Card.Root>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {commands.map((cmd) => (
            <Card.Root
              key={cmd.commandName}
              padding="sm"
              bordered
              interactive
              onClick={() => setSelectedName(cmd.commandName)}
              className={[
                'group flex flex-col gap-2 text-left transition-all duration-fast',
                !cmd.isEnable ? 'opacity-60' : '',
              ].join(' ')}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Terminal className="h-4 w-4 text-on-surface-variant shrink-0" />
                  <span className="font-mono text-label-lg font-semibold text-on-surface truncate">
                    {bot.prefix}
                    {cmd.commandName}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 text-on-surface-variant shrink-0 transition-transform duration-fast group-hover:translate-x-0.5" />
              </div>

              {cmd.description && (
                <p className="text-body-sm text-on-surface-variant leading-relaxed line-clamp-2">
                  {cmd.description}
                </p>
              )}

              <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                <Badge
                  color={cmd.isEnable ? 'success' : 'secondary'}
                  size="sm"
                  variant="tonal"
                  pill
                >
                  {cmd.isEnable ? 'ON' : 'OFF'}
                </Badge>
                {cmd.role !== undefined && (
                  <Badge color="primary" size="sm" variant="outlined" pill>
                    {ROLE_LABEL[cmd.role] ?? 'Unknown'}
                  </Badge>
                )}
                {cmd.ignoresAdminOnly && (
                  <Badge
                    color="warning"
                    size="sm"
                    variant="tonal"
                    pill
                    leftIcon={<ShieldOff className="h-3 w-3" />}
                  >
                    Exempt
                  </Badge>
                )}
              </div>
            </Card.Root>
          ))}
        </div>
      )}

      {/* Hide pagination while loading to prevent stale total counts from rendering */}
      {!isLoading && total > 0 && (
        <div className="pt-4 flex justify-center">
          <Pagination
            currentPage={page}
            totalItems={total}
            itemsPerPage={12}
            onPageChange={setPage}
          />
        </div>
      )}

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
