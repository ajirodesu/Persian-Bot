import { Helmet } from '@dr.pogodin/react-helmet'
import { useState, useMemo, memo } from 'react'
import {
  Plus,
  Server,
  Trash2,
  Pencil,
  RefreshCcw,
  ChevronRight,
  KeyRound,
} from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import Card from '@/components/ui/data-display/Card'
import Dialog from '@/components/ui/overlay/Dialog'
import Badge from '@/components/ui/data-display/Badge'
import Skeleton from '@/components/ui/feedback/Skeleton'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Textarea from '@/components/ui/forms/Textarea'
import Switch from '@/components/ui/forms/Switch'
import Alert from '@/components/ui/feedback/Alert'
import { useMcpServers } from '@/features/admin/hooks/useMcpServers'
import {
  mcpServersService,
  MCP_ROLE_OPTIONS,
} from '@/features/admin/services/mcp-servers.service'
import type { AdminMcpServerDto } from '@/features/admin/services/mcp-servers.service'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { cn } from '@/utils/cn.util'

// ── Helpers ────────────────────────────────────────────────────────────────────

/** Accepts "Header: value" lines; returns the parsed header map or null if malformed. */
function parseHeadersText(text: string): Record<string, string> | null {
  const headers: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const separatorIndex = line.indexOf(':')
    if (separatorIndex <= 0) return null
    const key = line.slice(0, separatorIndex).trim()
    const value = line.slice(separatorIndex + 1).trim()
    if (!key || !value) return null
    headers[key] = value
  }
  return headers
}

function headersToText(headerKeys: string[]): string {
  return headerKeys.map((key) => `${key}: `).join('\n')
}

function roleLabel(role: number | undefined): string {
  return MCP_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? 'Anyone'
}

function roleBadgeColor(role: number | undefined) {
  switch (role) {
    case 4:
      return 'error' as const
    case 3:
      return 'warning' as const
    case 2:
      return 'secondary' as const
    case 1:
      return 'info' as const
    default:
      return 'primary' as const
  }
}

interface ServerForm {
  name: string
  url: string
  enabled: boolean
  role: number
  headersText: string
}

const EMPTY_FORM: ServerForm = {
  name: '',
  url: '',
  enabled: true,
  role: 0,
  headersText: '',
}

// ── Role selector (shared by editor + detail dialog) ───────────────────────────

/**
 * Chip-style minimum-role selector. Chips wrap on every viewport so the five
 * options stay tappable on phones (min 44px via py) and sit inline on desktop.
 */
const RoleSelector = memo(function RoleSelector({
  value,
  onChange,
  disabled,
}: {
  value: number
  onChange: (role: number) => void
  disabled?: boolean
}) {
  return (
    <div
      role="radiogroup"
      aria-label="Minimum role required"
      className="flex flex-wrap gap-1.5"
    >
      {MCP_ROLE_OPTIONS.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              'rounded-full border px-3 py-2 text-label-sm font-medium transition-colors duration-fast sm:py-1.5',
              'disabled:cursor-not-allowed disabled:opacity-50',
              active
                ? 'border-primary bg-primary/15 text-primary'
                : 'border-outline-variant bg-surface-container text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
})

// ── Detail dialog (tap a server card to open — commands-page pattern) ─────────

interface ServerDetailDialogProps {
  server: AdminMcpServerDto | null
  testing: boolean
  onClose: () => void
  onToggle: (server: AdminMcpServerDto, enabled: boolean) => void
  onRoleChange: (server: AdminMcpServerDto, role: number) => void
  onTest: (server: AdminMcpServerDto) => void
  onEdit: (server: AdminMcpServerDto) => void
  onDelete: (server: AdminMcpServerDto) => void
}

/**
 * Pop-up card for one MCP server — the same centered-modal pattern as the bot
 * section's CommandDetailDialog: capped at max-h-[90dvh] with a scrollable
 * body, so it fits any phone screen; footer action buttons go full-width and
 * stack on mobile, sit inline from `sm` up.
 */
const ServerDetailDialog = memo(function ServerDetailDialog({
  server,
  testing,
  onClose,
  onToggle,
  onRoleChange,
  onTest,
  onEdit,
  onDelete,
}: ServerDetailDialogProps) {
  const open = server !== null

  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Positioner position="center">
        <Dialog.Backdrop />
        <Dialog.Content
          size="sm"
          className="flex max-h-[90dvh] flex-col"
        >
          <Dialog.Header>
            <Dialog.Title className="flex min-w-0 items-center gap-2">
              <Server className="h-4 w-4 shrink-0 text-on-surface-variant" />
              <span className="truncate">{server?.name}</span>
            </Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body className="flex flex-1 flex-col gap-4 !max-h-none overflow-y-auto pb-2 pt-0">
            {server && (
              <>
                {/* Status + role badges */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge
                    color={server.enabled ? 'success' : 'secondary'}
                    size="sm"
                    variant="tonal"
                    pill
                  >
                    {server.enabled ? 'Enabled' : 'Disabled'}
                  </Badge>
                  <Badge
                    color={roleBadgeColor(server.role)}
                    size="sm"
                    variant="outlined"
                    pill
                  >
                    {roleLabel(server.role)}
                  </Badge>
                  {server.headerKeys.length > 0 && (
                    <Badge color="primary" size="sm" variant="tonal" pill>
                      {server.headerKeys.length}{' '}
                      header{server.headerKeys.length === 1 ? '' : 's'}
                    </Badge>
                  )}
                </div>

                {/* URL */}
                <div className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-low p-3">
                  <p className="mb-0.5 text-label-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                    URL
                  </p>
                  <p className="break-all font-mono text-body-sm text-on-surface">
                    {server.url}
                  </p>
                </div>

                {/* Enable toggle */}
                <div className="flex items-center justify-between gap-3 rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-low p-3">
                  <div className="min-w-0">
                    <p className="text-label-md font-medium text-on-surface">
                      Enabled
                    </p>
                    <p className="text-body-xs text-on-surface-variant">
                      When on, the AI agent can use this server&apos;s tools.
                    </p>
                  </div>
                  <Switch
                    checked={server.enabled}
                    onChange={(checked) => onToggle(server, checked)}
                    size="sm"
                    className="shrink-0"
                  />
                </div>

                {/* Role gate */}
                <div className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container-low p-3">
                  <p className="mb-0.5 text-label-md font-medium text-on-surface">
                    Minimum role
                  </p>
                  <p className="mb-2.5 text-body-xs text-on-surface-variant">
                    Only chats whose sender meets this role see this
                    server&apos;s tools.
                  </p>
                  <RoleSelector
                    value={server.role}
                    onChange={(role) => onRoleChange(server, role)}
                  />
                </div>
              </>
            )}
          </Dialog.Body>
          <Dialog.Footer className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="tonal"
              color="error"
              size="sm"
              onClick={() => server && onDelete(server)}
              leftIcon={<Trash2 size={14} />}
              className="w-full sm:w-auto"
            >
              Delete
            </Button>
            <Button
              variant="tonal"
              color="neutral"
              size="sm"
              onClick={() => server && onEdit(server)}
              leftIcon={<Pencil size={14} />}
              className="w-full sm:w-auto"
            >
              Edit
            </Button>
            <Button
              variant="tonal"
              color="primary"
              size="sm"
              isLoading={testing}
              onClick={() => server && onTest(server)}
              leftIcon={<RefreshCcw size={14} />}
              className="w-full sm:w-auto"
            >
              Test
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
})

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminMcpServersPage() {
  const { servers, isLoading, error, refetch } = useMcpServers()
  const { success, error: snackbarError, show } = useSnackbar()

  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminMcpServerDto | null>(null)
  const [form, setForm] = useState<ServerForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminMcpServerDto | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const [testingId, setTestingId] = useState<string | null>(null)

  const sortedServers = useMemo(
    () => [...servers].sort((a, b) => a.name.localeCompare(b.name)),
    [servers],
  )

  // Re-resolve the detail target from the list so it stays fresh after toggles
  // and role changes (same pattern as the commands page's selected command).
  const detailServer = useMemo(
    () => sortedServers.find((s) => s.id === detailId) ?? null,
    [sortedServers, detailId],
  )

  function openCreateDialog() {
    setEditing(null)
    setForm(EMPTY_FORM)
    setFormError(null)
    setIsEditorOpen(true)
  }

  function openEditDialog(server: AdminMcpServerDto) {
    setEditing(server)
    setForm({
      name: server.name,
      url: server.url,
      enabled: server.enabled,
      role: server.role,
      headersText: headersToText(server.headerKeys),
    })
    setFormError(null)
    setDetailId(null)
    setIsEditorOpen(true)
  }

  function closeEditor() {
    if (isSaving) return
    setIsEditorOpen(false)
    setEditing(null)
    setFormError(null)
  }

  async function handleSave() {
    const name = form.name.trim()
    const url = form.url.trim()
    if (!name) {
      setFormError('Please provide a name for this MCP server.')
      return
    }
    if (!/^https?:\/\/\S+$/i.test(url)) {
      setFormError('URL must be an absolute http(s) URL.')
      return
    }
    const headers = parseHeadersText(form.headersText)
    if (headers === null) {
      setFormError('Each header must be one "Key: Value" per line.')
      return
    }

    setIsSaving(true)
    setFormError(null)
    try {
      if (editing) {
        await mcpServersService.updateServer(editing.id, {
          name,
          url,
          enabled: form.enabled,
          role: form.role,
          headers,
        })
        success('MCP server updated')
      } else {
        await mcpServersService.createServer({
          name,
          url,
          enabled: form.enabled,
          role: form.role,
          headers,
        })
        success('MCP server added')
      }
      setIsEditorOpen(false)
      setEditing(null)
      await refetch()
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : 'Failed to save MCP server',
      )
    } finally {
      setIsSaving(false)
    }
  }

  async function handleToggle(server: AdminMcpServerDto, enabled: boolean) {
    try {
      await mcpServersService.updateServer(server.id, { enabled })
      await refetch()
    } catch (err) {
      snackbarError(err instanceof Error ? err.message : 'Failed to update server')
    }
  }

  async function handleRoleChange(server: AdminMcpServerDto, role: number) {
    try {
      await mcpServersService.updateServer(server.id, { role })
      success(`Role gate set to ${roleLabel(role)}`)
      await refetch()
    } catch (err) {
      snackbarError(err instanceof Error ? err.message : 'Failed to update role')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await mcpServersService.removeServer(deleteTarget.id)
      success('MCP server removed')
      setDeleteTarget(null)
      setDetailId(null)
      await refetch()
    } catch (err) {
      snackbarError(err instanceof Error ? err.message : 'Failed to remove server')
    } finally {
      setIsDeleting(false)
    }
  }

  async function handleTest(server: AdminMcpServerDto) {
    setTestingId(server.id)
    try {
      const result = await mcpServersService.testServer({ url: server.url })
      if (result.ok) {
        const toolSummary =
          result.toolNames.length > 0
            ? ` Exposed ${result.toolCount} tool${result.toolCount === 1 ? '' : 's'}: ${result.toolNames.slice(0, 8).join(', ')}${result.toolNames.length > 8 ? '…' : ''}`
            : ' Connected, but no tools exposed.'
        show(`Connection to "${server.name}" OK.${toolSummary}`)
      } else {
        snackbarError(
          `Connection to "${server.name}" failed${result.error ? `: ${result.error}` : ''}`,
        )
      }
    } catch (err) {
      snackbarError(err instanceof Error ? err.message : 'Test connection failed')
    } finally {
      setTestingId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Helmet>
        <title>MCP Servers · Admin · Cat-Bot</title>
      </Helmet>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-headline-md font-semibold text-on-surface md:hidden">
            MCP Servers
          </h1>
          <p className="mt-1 text-body-md text-on-surface-variant md:mt-0 md:text-headline-md md:font-semibold md:text-on-surface">
            Connect external MCP servers so the AI agent can use their tools.
            Tap a server to manage its role gate. Header values are encrypted
            at rest.
          </p>
        </div>
        <Button
          variant="filled"
          color="primary"
          size="md"
          onClick={openCreateDialog}
          leftIcon={<Plus size={18} />}
          className="w-full shrink-0 sm:w-auto"
        >
          Add Server
        </Button>
      </div>

      {error !== null && (
        <div className="rounded-[var(--radius-card)] bg-error-container text-on-error-container px-4 py-3 text-body-md">
          {error}
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} variant="rectangular" className="h-28" />
          ))}
        </div>
      ) : sortedServers.length === 0 ? (
        <Card.Root padding="md" bordered className="text-center">
          <Server className="mx-auto mb-2 h-8 w-8 text-on-surface-variant" />
          <p className="text-body-md text-on-surface-variant">
            No MCP servers configured yet. Add one to extend the agent&apos;s
            tools.
          </p>
        </Card.Root>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sortedServers.map((server) => (
            <Card.Root
              key={server.id}
              padding="sm"
              bordered
              interactive
              onClick={() => setDetailId(server.id)}
              className={cn(
                'group flex flex-col gap-2 text-left transition-all duration-fast',
                !server.enabled && 'opacity-60',
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Server className="h-4 w-4 shrink-0 text-on-surface-variant" />
                  <span className="truncate text-label-lg font-semibold text-on-surface">
                    {server.name}
                  </span>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-on-surface-variant transition-transform duration-fast group-hover:translate-x-0.5" />
              </div>

              <p className="truncate font-mono text-body-xs text-on-surface-variant">
                {server.url}
              </p>

              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <Badge
                  color={server.enabled ? 'success' : 'secondary'}
                  size="sm"
                  variant="tonal"
                  pill
                >
                  {server.enabled ? 'ON' : 'OFF'}
                </Badge>
                <Badge
                  color={roleBadgeColor(server.role)}
                  size="sm"
                  variant="outlined"
                  pill
                >
                  {roleLabel(server.role)}
                </Badge>
                {server.headerKeys.length > 0 && (
                  <Badge color="primary" size="sm" variant="tonal" pill>
                    <KeyRound className="h-3 w-3" />
                    {server.headerKeys.length}
                  </Badge>
                )}
              </div>
            </Card.Root>
          ))}
        </div>
      )}

      {/* Tap-to-open detail card */}
      <ServerDetailDialog
        server={detailServer}
        testing={testingId !== null && testingId === detailId}
        onClose={() => setDetailId(null)}
        onToggle={handleToggle}
        onRoleChange={handleRoleChange}
        onTest={handleTest}
        onEdit={openEditDialog}
        onDelete={(server) => setDeleteTarget(server)}
      />

      {/* Add / Edit dialog */}
      <Dialog.Root
        open={isEditorOpen}
        onOpenChange={(open) => {
          if (!open) closeEditor()
        }}
        closeOnEsc={!isSaving}
        closeOnOverlayClick={!isSaving}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="md" className="flex max-h-[90dvh] flex-col">
            <Dialog.Header>
              <Dialog.Title>
                {editing ? 'Edit MCP Server' : 'Add MCP Server'}
              </Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body className="flex flex-1 flex-col gap-5 !max-h-none overflow-y-auto pb-2">
              <Field.Root>
                <Field.Label>Name</Field.Label>
                <Input
                  value={form.name}
                  onChange={(e) => {
                    setForm({ ...form, name: e.target.value })
                    setFormError(null)
                  }}
                  placeholder="e.g. GitHub MCP"
                  disabled={isSaving}
                />
              </Field.Root>

              <Field.Root>
                <Field.Label>URL</Field.Label>
                <Input
                  type="url"
                  value={form.url}
                  onChange={(e) => {
                    setForm({ ...form, url: e.target.value })
                    setFormError(null)
                  }}
                  placeholder="https://mcp.example.com/sse"
                  disabled={isSaving}
                />
              </Field.Root>

              <Field.Root>
                <Field.Label>Minimum role</Field.Label>
                <RoleSelector
                  value={form.role}
                  onChange={(role) => {
                    setForm({ ...form, role })
                    setFormError(null)
                  }}
                  disabled={isSaving}
                />
                <Field.HelperText>
                  Only chats whose sender meets this role (e.g. group admin,
                  premium) will see this server&apos;s tools.
                </Field.HelperText>
              </Field.Root>

              <Field.Root>
                <Field.Label>Headers</Field.Label>
                <Textarea
                  value={form.headersText}
                  onChange={(e) => {
                    setForm({ ...form, headersText: e.target.value })
                    setFormError(null)
                  }}
                  placeholder={'Authorization: Bearer …\nX-API-Key: …'}
                  disabled={isSaving}
                  rows={4}
                />
                <Field.HelperText>
                  Optional request headers, one &ldquo;Key: Value&rdquo; per
                  line. Values are encrypted and never returned to this page.
                </Field.HelperText>
              </Field.Root>

              <div className="flex items-center gap-3">
                <Switch
                  checked={form.enabled}
                  onChange={(checked) => {
                    setForm({ ...form, enabled: checked })
                  }}
                  disabled={isSaving}
                />
                <span className="text-body-md text-on-surface">
                  Enabled (agent can use this server&apos;s tools)
                </span>
              </div>

              {formError !== null && (
                <Alert
                  variant="tonal"
                  color="error"
                  title={formError}
                  size="sm"
                />
              )}
            </Dialog.Body>
            <Dialog.Footer className="flex-col gap-2 sm:flex-row sm:justify-end">
              <Dialog.CloseTrigger asChild>
                <Button
                  variant="text"
                  color="neutral"
                  size="sm"
                  disabled={isSaving}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="primary"
                size="sm"
                onClick={() => {
                  void handleSave()
                }}
                isLoading={isSaving}
                disabled={isSaving}
                className="w-full sm:w-auto"
              >
                {editing ? 'Save Changes' : 'Add Server'}
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Delete confirm dialog */}
      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        closeOnEsc={!isDeleting}
        closeOnOverlayClick={!isDeleting}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Delete MCP Server</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant mb-4">
                Are you sure you want to remove{' '}
                <span className="font-semibold text-on-surface">
                  {deleteTarget?.name}
                </span>
                ? The agent will stop receiving this server&apos;s tools.
              </p>
            </Dialog.Body>
            <Dialog.Footer className="flex-col gap-2 sm:flex-row sm:justify-end">
              <Dialog.CloseTrigger asChild>
                <Button
                  variant="text"
                  color="neutral"
                  size="sm"
                  disabled={isDeleting}
                  className="w-full sm:w-auto"
                >
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                variant="filled"
                color="error"
                size="sm"
                onClick={() => {
                  void handleDelete()
                }}
                isLoading={isDeleting}
                disabled={isDeleting}
                className="w-full sm:w-auto"
              >
                Delete
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </div>
  )
}
