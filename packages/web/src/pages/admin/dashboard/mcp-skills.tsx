import { Helmet } from '@dr.pogodin/react-helmet'
import { useMemo, useState } from 'react'
import { Search, Puzzle } from 'lucide-react'
import Dialog from '@/components/ui/overlay/Dialog'
import Button from '@/components/ui/buttons/Button'
import { Field } from '@/components/ui/forms/Field'
import Input from '@/components/ui/forms/Input'
import Textarea from '@/components/ui/forms/Textarea'
import Select from '@/components/ui/forms/Select'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import { useAdminMcpSkills } from '@/features/admin/hooks/useAdminMcpSkills'
import adminService, {
  type AdminMcpSkillDto,
} from '@/features/admin/services/admin.service'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Small presentational pieces matching the admin users page
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
  tone?: 'default' | 'accent' | 'danger' | 'warning'
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border',
        tone === 'accent' && 'bg-surface-container-high text-primary border-primary/30',
        tone === 'danger' && 'bg-surface-container-high text-error border-error/30',
        tone === 'warning' &&
          'bg-surface-container-high text-amber-600 dark:text-amber-400 border-amber-500/30',
        tone === 'default' && 'bg-surface-container-high text-on-surface-variant border-hairline',
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

const STATUS_LABEL: Record<AdminMcpSkillDto['status'], string> = {
  active: 'Active',
  pending_review: 'Needs review',
  restricted: 'Admin only',
  disabled: 'Disabled',
}

const ROLE_LABEL: Record<number, string> = {
  0: 'Anyone',
  1: 'Thread admin',
  2: 'Premium',
  3: 'Bot admin',
  4: 'System admin',
}

export default function AdminMcpSkillsPage() {
  const { success, error: notifyError } = useSnackbar()
  const { items, isLoading, error, invalidate } = useAdminMcpSkills()
  const [searchQuery, setSearchQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [editTarget, setEditTarget] = useState<AdminMcpSkillDto | null>(null)
  const [editForm, setEditForm] = useState({ name: '', url: '', instructions: '', status: '', minRole: '', risk: '' })
  const [editError, setEditError] = useState<string | null>(null)
  const [isEditSaving, setIsEditSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AdminMcpSkillDto | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return items
    return items.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        (i.userEmail ?? '').toLowerCase().includes(q) ||
        (i.userName ?? '').toLowerCase().includes(q),
    )
  }, [items, searchQuery])

  const flagged = useMemo(
    () => items.filter((i) => i.status === 'pending_review' || i.status === 'restricted').length,
    [items],
  )

  const mutate = async (id: string, dto: Record<string, unknown>, okMessage: string): Promise<void> => {
    setBusyId(id)
    try {
      await adminService.updateMcpSkill(id, dto)
      await invalidate()
      success(okMessage)
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setBusyId(null)
    }
  }

  const openEditDialog = (item: AdminMcpSkillDto): void => {
    const cfg = item.config as { url?: string; instructions?: string }
    setEditForm({
      name: item.name,
      url: typeof cfg.url === 'string' ? cfg.url : '',
      instructions: typeof cfg.instructions === 'string' ? cfg.instructions : '',
      status: item.status,
      minRole: String(item.minRole),
      risk: String(item.risk),
    })
    setEditError(null)
    setEditTarget(item)
  }

  const handleEditSave = async (): Promise<void> => {
    if (!editTarget) return
    setEditError(null)
    setIsEditSaving(true)
    try {
      const cfg = editTarget.config as { url?: string; mode?: string }
      const dto: Record<string, unknown> = { name: editForm.name.trim() }
      if (typeof cfg.url === 'string') {
        dto.config = { url: editForm.url.trim() }
      } else if (cfg.mode === 'prompt') {
        dto.config = { mode: 'prompt', instructions: editForm.instructions.trim() }
      }
      dto.status = editForm.status
      dto.minRole = Number(editForm.minRole)
      dto.risk = Number(editForm.risk)
      await adminService.updateMcpSkill(editTarget.id, dto)
      await invalidate()
      setEditTarget(null)
      success('Integration updated')
    } catch (err) {
      setEditError(err instanceof Error ? err.message : 'Update failed')
    } finally {
      setIsEditSaving(false)
    }
  }

  const handleDelete = async (): Promise<void> => {
    if (!deleteTarget) return
    setIsDeleting(true)
    try {
      await adminService.deleteMcpSkill(deleteTarget.id)
      await invalidate()
      setDeleteTarget(null)
      success('Integration deleted')
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Delete failed')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="flex flex-col gap-0 max-w-[720px] w-full mx-auto pb-8">
      <Helmet>
        <title>MCP & Skills · Admin · Cat-Bot</title>
      </Helmet>

      <div className="pt-4 space-y-4">
        <div className="flex items-center justify-between px-1">
          <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
            MCP & Skills {items.length > 0 && `· ${items.length}`}
          </h2>
          {flagged > 0 && (
            <MonoChip tone="warning">
              {flagged} need{flagged === 1 ? 's' : ''} review
            </MonoChip>
          )}
        </div>

        {flagged > 0 && (
          <Alert
            variant="tonal"
            color="warning"
            title="Restricted integrations need review"
            message="Dangerous entries are locked to system admins until you approve, restrict, or delete them."
            size="sm"
          />
        )}

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-variant pointer-events-none" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, user, or email…"
            aria-label="Search integrations"
            className="h-11 text-sm pl-9"
          />
        </div>

        {error && <Alert variant="tonal" color="error" title={error} size="sm" />}

        {isLoading ? (
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {[0, 1, 2].map((i) => (
              <RowSkeleton key={i} />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
            <p className="p-6 text-sm text-on-surface-variant italic text-center">
              {searchQuery.trim() ? `No integrations match "${searchQuery}"` : 'No user integrations yet.'}
            </p>
          </div>
        ) : (
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {filtered.map((item) => {
              const cfg = item.config as { url?: string; mode?: string }
              const busy = busyId === item.id
              return (
                <div
                  key={item.id}
                  className="p-3.5 flex items-center justify-between space-x-3 max-sm:flex-col max-sm:items-stretch max-sm:gap-3 max-sm:space-x-0"
                >
                  <div className="flex items-center space-x-3 min-w-0">
                    <IconWell>
                      <Puzzle className="h-4 w-4" strokeWidth={2} />
                    </IconWell>
                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center space-x-2 min-w-0 flex-wrap gap-y-1">
                        <span className="text-sm font-semibold text-on-surface truncate leading-snug font-mono">
                          {item.name}
                        </span>
                        <MonoChip tone="default">{item.kind}</MonoChip>
                        <MonoChip
                          tone={
                            item.status === 'active'
                              ? 'accent'
                              : item.status === 'disabled'
                                ? 'default'
                                : item.status === 'restricted'
                                  ? 'danger'
                                  : 'warning'
                          }
                        >
                          {STATUS_LABEL[item.status]}
                        </MonoChip>
                        <MonoChip tone={item.risk >= 2 ? 'danger' : 'default'}>
                          {item.risk >= 2 ? 'Destructive' : item.risk === 1 ? 'Action' : 'Read'}
                        </MonoChip>
                      </div>
                      <span className="text-[11px] font-mono text-on-surface-variant truncate mt-0.5">
                        {item.userName ?? item.userEmail ?? item.userId}
                        {item.userEmail && item.userName ? ` · ${item.userEmail}` : ''}
                        {' · '}
                        {cfg.mode === 'prompt' ? 'prompt skill' : (cfg.url ?? '—')}
                        {' · min role '}
                        {ROLE_LABEL[item.minRole] ?? item.minRole}
                      </span>
                      {item.dangerReasons.length > 0 && (
                        <span className="text-[11px] text-error/90 mt-0.5 line-clamp-2">
                          {item.dangerReasons.slice(0, 2).join(' · ')}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end max-sm:justify-start">
                    {item.status !== 'active' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void mutate(item.id, { status: 'active' }, `"${item.name}" approved`)}
                        className={cn(ROW_BTN, ROW_BTN_ACCENT)}
                      >
                        Approve
                      </button>
                    )}
                    {item.status === 'active' && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void mutate(item.id, { status: 'restricted' }, `"${item.name}" restricted to admins`)}
                        className={cn(ROW_BTN, ROW_BTN_SECONDARY)}
                      >
                        Restrict
                      </button>
                    )}
                    {item.status !== 'disabled' ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void mutate(item.id, { status: 'disabled' }, `"${item.name}" disabled`)}
                        className={cn(ROW_BTN, ROW_BTN_SECONDARY)}
                      >
                        Disable
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void mutate(item.id, { status: 'active' }, `"${item.name}" enabled`)}
                        className={cn(ROW_BTN, ROW_BTN_ACCENT)}
                      >
                        Enable
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditDialog(item)}
                      className={cn(ROW_BTN, ROW_BTN_SECONDARY)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(item)}
                      className={cn(ROW_BTN, ROW_BTN_DANGER)}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog.Root
        open={editTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isEditSaving) setEditTarget(null)
        }}
        closeOnEsc={!isEditSaving}
        closeOnOverlayClick={!isEditSaving}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Edit {editTarget?.kind === 'skill' ? 'Skill' : 'MCP server'}</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <div className="space-y-3">
                <p className="text-xs text-on-surface-variant">
                  Owner: <span className="font-mono">{editTarget?.userEmail ?? editTarget?.userId}</span>
                </p>
                <Field.Root>
                  <Field.Label>Name</Field.Label>
                  <Input
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    aria-label="Integration name"
                    className="h-11 text-sm"
                  />
                </Field.Root>
                {(editTarget?.config as { url?: string } | undefined)?.url !== undefined && (
                  <Field.Root>
                    <Field.Label>Server URL</Field.Label>
                    <Input
                      value={editForm.url}
                      onChange={(e) => setEditForm((f) => ({ ...f, url: e.target.value }))}
                      aria-label="Server URL"
                      spellCheck={false}
                      className="h-11 text-sm font-mono"
                    />
                  </Field.Root>
                )}
                {(editTarget?.config as { mode?: string } | undefined)?.mode === 'prompt' && (
                  <Field.Root>
                    <Field.Label>Instructions</Field.Label>
                    <Textarea
                      value={editForm.instructions}
                      onChange={(e) => setEditForm((f) => ({ ...f, instructions: e.target.value }))}
                      aria-label="Skill instructions"
                      rows={4}
                    />
                  </Field.Root>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <Field.Root>
                    <Field.Label>Status</Field.Label>
                    <Select
                      options={[
                        { value: 'active', label: 'Active' },
                        { value: 'pending_review', label: 'Needs review' },
                        { value: 'restricted', label: 'Admin only' },
                        { value: 'disabled', label: 'Disabled' },
                      ]}
                      value={editForm.status}
                      onChange={(v) => setEditForm((f) => ({ ...f, status: v }))}
                      fullWidth
                    />
                  </Field.Root>
                  <Field.Root>
                    <Field.Label>Minimum role</Field.Label>
                    <Select
                      options={[
                        { value: '0', label: 'Anyone' },
                        { value: '1', label: 'Thread admin' },
                        { value: '2', label: 'Premium' },
                        { value: '3', label: 'Bot admin' },
                        { value: '4', label: 'System admin' },
                      ]}
                      value={editForm.minRole}
                      onChange={(v) => setEditForm((f) => ({ ...f, minRole: v }))}
                      fullWidth
                    />
                  </Field.Root>
                </div>
                <Field.Root>
                  <Field.Label>Risk level</Field.Label>
                  <Select
                    options={[
                      { value: '0', label: 'Read (0)' },
                      { value: '1', label: 'Action (1)' },
                      { value: '2', label: 'Destructive (2)' },
                    ]}
                    value={editForm.risk}
                    onChange={(v) => setEditForm((f) => ({ ...f, risk: v }))}
                    fullWidth
                  />
                </Field.Root>
                {editError && <Alert variant="tonal" color="error" title={editError} size="sm" />}
              </div>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="text" color="neutral" size="sm" disabled={isEditSaving}>
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                color="primary"
                size="sm"
                onClick={() => void handleEditSave()}
                isLoading={isEditSaving}
                disabled={isEditSaving}
              >
                Save changes
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Delete confirmation dialog */}
      <Dialog.Root
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !isDeleting) setDeleteTarget(null)
        }}
        closeOnEsc={!isDeleting}
        closeOnOverlayClick={!isDeleting}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Delete integration?</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-sm text-on-surface-variant">
                This removes <span className="font-mono text-on-surface">{deleteTarget?.name}</span> owned
                by <span className="font-mono text-on-surface">{deleteTarget?.userEmail ?? deleteTarget?.userId}</span>.
                This action cannot be undone.
              </p>
            </Dialog.Body>
            <Dialog.Footer>
              <Dialog.CloseTrigger asChild>
                <Button variant="text" color="neutral" size="sm" disabled={isDeleting}>
                  Cancel
                </Button>
              </Dialog.CloseTrigger>
              <Button
                color="error"
                size="sm"
                onClick={() => void handleDelete()}
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
