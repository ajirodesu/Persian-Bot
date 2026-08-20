import { Helmet } from '@dr.pogodin/react-helmet'
import { useState, useMemo } from 'react'
import { Plus, Server, Trash2, Pencil, RefreshCcw } from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import Dialog from '@/components/ui/overlay/Dialog'
import Table from '@/components/ui/data-display/Table'
import Badge from '@/components/ui/data-display/Badge'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Textarea from '@/components/ui/forms/Textarea'
import Switch from '@/components/ui/forms/Switch'
import Alert from '@/components/ui/feedback/Alert'
import { useMcpServers } from '@/features/admin/hooks/useMcpServers'
import { mcpServersService } from '@/features/admin/services/mcp-servers.service'
import type { AdminMcpServerDto } from '@/features/admin/services/mcp-servers.service'
import { useSnackbar } from '@/contexts/SnackbarContext'

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

interface ServerForm {
  name: string
  url: string
  enabled: boolean
  headersText: string
}

const EMPTY_FORM: ServerForm = { name: '', url: '', enabled: true, headersText: '' }

// ── Page ───────────────────────────────────────────────────────────────────────

export default function AdminMcpServersPage() {
  const { servers, isLoading, error, refetch } = useMcpServers()
  const { success, error: snackbarError, show } = useSnackbar()

  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [editing, setEditing] = useState<AdminMcpServerDto | null>(null)
  const [form, setForm] = useState<ServerForm>(EMPTY_FORM)
  const [formError, setFormError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AdminMcpServerDto | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const [testingId, setTestingId] = useState<string | null>(null)

  const sortedServers = useMemo(
    () => [...servers].sort((a, b) => a.name.localeCompare(b.name)),
    [servers],
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
      headersText: headersToText(server.headerKeys),
    })
    setFormError(null)
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
          headers,
        })
        success('MCP server updated')
      } else {
        await mcpServersService.createServer({
          name,
          url,
          enabled: form.enabled,
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

  async function handleDelete() {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await mcpServersService.removeServer(deleteTarget.id)
      success('MCP server removed')
      setDeleteTarget(null)
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
            Header values are encrypted at rest.
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

      <Table.ScrollArea className="bg-surface">
        <Table.Root variant="glass" fullWidth>
          <Table.Header>
            <Table.Row>
              <Table.Head>Name</Table.Head>
              <Table.Head className="hidden md:table-cell">URL</Table.Head>
              <Table.Head>Status</Table.Head>
              <Table.Head className="hidden sm:table-cell">Headers</Table.Head>
              <Table.Head align="right">Actions</Table.Head>
            </Table.Row>
          </Table.Header>
          <Table.Body>
            {isLoading && <Table.Loading colSpan={5} rows={4} />}
            {!isLoading &&
              sortedServers.length === 0 && (
                <Table.Empty
                  colSpan={5}
                  message="No MCP servers configured yet. Add one to extend the agent's tools."
                />
              )}
            {!isLoading &&
              sortedServers.map((server) => (
                <Table.Row key={server.id}>
                  <Table.Cell>
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-on-surface-variant shrink-0">
                        <Server size={18} />
                      </span>
                      <span className="font-medium text-on-surface truncate min-w-0">
                        {server.name}
                      </span>
                    </div>
                  </Table.Cell>
                  <Table.Cell className="hidden md:table-cell text-body-sm text-on-surface-variant break-all">
                    {server.url}
                  </Table.Cell>
                  <Table.Cell>
                    <Switch
                      checked={server.enabled}
                      onChange={(checked) => {
                        void handleToggle(server, checked)
                      }}
                      size="sm"
                    />
                  </Table.Cell>
                  <Table.Cell className="hidden sm:table-cell">
                    {server.headerKeys.length === 0 ? (
                      <span className="text-body-sm text-on-surface-variant">
                        —
                      </span>
                    ) : (
                      <Badge variant="tonal" color="primary" size="sm">
                        {server.headerKeys.length}{' '}
                        header{server.headerKeys.length === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </Table.Cell>
                  <Table.Cell align="right">
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="tonal"
                        color="primary"
                        size="sm"
                        isLoading={testingId === server.id}
                        disabled={testingId !== null}
                        onClick={() => {
                          void handleTest(server)
                        }}
                        leftIcon={<RefreshCcw size={14} />}
                        aria-label={`Test ${server.name}`}
                      >
                        <span className="hidden sm:inline">Test</span>
                      </Button>
                      <Button
                        variant="tonal"
                        color="neutral"
                        size="sm"
                        iconOnly
                        aria-label={`Edit ${server.name}`}
                        onClick={() => {
                          openEditDialog(server)
                        }}
                      >
                        <Pencil size={14} />
                      </Button>
                      <Button
                        variant="tonal"
                        color="error"
                        size="sm"
                        iconOnly
                        aria-label={`Delete ${server.name}`}
                        onClick={() => {
                          setDeleteTarget(server)
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </Table.Cell>
                </Table.Row>
              ))}
          </Table.Body>
        </Table.Root>
      </Table.ScrollArea>

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
          <Dialog.Content size="md">
            <Dialog.Header>
              <Dialog.Title>
                {editing ? 'Edit MCP Server' : 'Add MCP Server'}
              </Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body className="flex flex-col gap-5">
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
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button
                  variant="text"
                  color="neutral"
                  size="sm"
                  disabled={isSaving}
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
                variant="filled"
                color="error"
                size="sm"
                onClick={() => {
                  void handleDelete()
                }}
                isLoading={isDeleting}
                disabled={isDeleting}
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