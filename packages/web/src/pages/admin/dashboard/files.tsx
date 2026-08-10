import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Helmet } from '@dr.pogodin/react-helmet'
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderPlus,
  FilePlus2,
  FileText,
  Pencil,
  Trash2,
  Save,
  Cloud,
  CloudOff,
  Loader2,
  X,
  CircleDot,
  Files,
  FolderGit2,
  GitBranch,
  RefreshCw,
  Copy,
  Check,
  Maximize,
  Minimize,
} from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import IconButton from '@/components/ui/buttons/IconButton'
import Badge from '@/components/ui/data-display/Badge'
import EmptyState from '@/components/ui/data-display/EmptyState'
import Alert from '@/components/ui/feedback/Alert'
import Input from '@/components/ui/forms/Input'
import Field from '@/components/ui/forms/Field'
import Dialog from '@/components/ui/overlay/Dialog'
import Skeleton from '@/components/ui/feedback/Skeleton'
import CodeEditor from '@/components/editor/CodeEditor'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useAdminFileManager } from '@/features/admin/hooks/useAdminFileManager'
import { useSnackbar } from '@/contexts/SnackbarContext'
import type { RepoEntryDto } from '@/features/admin/services/admin-file-manager.service'
import type { BadgeColor } from '@/components/ui/data-display/Badge'

/** localStorage key remembering the last selected folder across refreshes. */
const FOLDER_STORAGE_KEY = 'admin-file-manager:folder:v1'

// ── Formatting helpers ─────────────────────────────────────────────────────────

const LANGUAGE_COLOR: Record<string, BadgeColor> = {
  typescript: 'primary',
  javascript: 'warning',
  json: 'info',
  markdown: 'secondary',
  yaml: 'tertiary',
  css: 'info',
  html: 'tertiary',
  shell: 'success',
  python: 'success',
  text: 'secondary',
}

function languageColor(language: string | null): BadgeColor {
  return language ? (LANGUAGE_COLOR[language.toLowerCase()] ?? 'secondary') : 'secondary'
}

function formatSize(bytes: number | null): string {
  if (bytes === null) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function relativeTime(iso: string): string {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}

/** First line of a commit message, truncated to a sensible row length. */
function shortMessage(message: string): string {
  const first = message.split('\n')[0] ?? ''
  return first.length > 44 ? `${first.slice(0, 41)}…` : first
}

function parentOf(entryPath: string): string {
  const idx = entryPath.lastIndexOf('/')
  return idx === -1 ? '' : entryPath.slice(0, idx)
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

/** Matches the server's default commit message for an empty message field. */
function defaultMessage(action: string, path: string): string {
  return `chore(file-manager): ${action} ${path}`
}

// ── Discard-confirm request ───────────────────────────────────────────────────

type DiscardRequest =
  | { kind: 'switch'; entry: RepoEntryDto }
  | { kind: 'close' }
  | null

// ── File tree (recursive, lazy, GitHub-style) ─────────────────────────────────

interface FileTreeProps {
  folder: string
  depth: number
  selectedFolder: string
  onSelectFolder: (path: string) => void
  onOpenFile: (entry: RepoEntryDto) => void
  // From the hook
  children: Record<string, RepoEntryDto[]>
  expanded: Set<string>
  loadingPaths: Set<string>
  pending: Set<string>
  isExpanded: (path: string) => boolean
  toggleFolder: (path: string) => void
}

const TreeFolderRow = memo(function TreeFolderRow(props: FileTreeProps) {
  const {
    folder,
    depth,
    selectedFolder,
    onSelectFolder,
    onOpenFile,
    children,
    expanded,
    loadingPaths,
    pending,
    isExpanded,
    toggleFolder,
  } = props

  const name = folder.split('/').pop() ?? folder
  const entryChildren = children[folder]
  const isLoading = loadingPaths.has(folder)
  const isPending = pending.has(folder)
  const isOpen = isExpanded(folder)

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onSelectFolder(folder)}
        onKeyDown={(e) => e.key === 'Enter' && onSelectFolder(folder)}
        className={[
          'group flex w-full items-center gap-1.5 rounded-[var(--radius-input)] py-1.5 pr-2 text-left ' +
            'cursor-pointer transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          selectedFolder === folder
            ? 'bg-primary/10 text-primary'
            : 'text-on-surface hover:bg-on-surface/5',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            toggleFolder(folder)
          }}
          aria-label={isOpen ? `Collapse ${name}` : `Expand ${name}`}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-on-surface-variant hover:text-on-surface"
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : isOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <Folder
          className={`h-4 w-4 shrink-0 ${
            selectedFolder === folder ? 'text-primary' : 'text-on-surface-variant'
          }`}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label-md font-medium">{name}</span>
          {isPending && (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-on-surface-variant" />
          )}
        </span>
      </div>

      {isOpen && (
        <div className="mt-0.5">
          {isLoading && !entryChildren ? (
            <div
              className="flex flex-col gap-1 py-1"
              style={{ paddingLeft: `${depth * 16 + 32}px` }}
            >
              <Skeleton variant="text" width="70%" />
              <Skeleton variant="text" width="55%" />
              <Skeleton variant="text" width="80%" />
            </div>
          ) : (
            entryChildren?.map((entry) =>
              entry.type === 'folder' ? (
                <TreeFolderRow
                  key={entry.path}
                  folder={entry.path}
                  depth={depth + 1}
                  selectedFolder={selectedFolder}
                  onSelectFolder={onSelectFolder}
                  onOpenFile={onOpenFile}
                  children={children}
                  expanded={expanded}
                  loadingPaths={loadingPaths}
                  pending={pending}
                  isExpanded={isExpanded}
                  toggleFolder={toggleFolder}
                />
              ) : (
                <TreeFileRow
                  key={entry.path}
                  entry={entry}
                  depth={depth + 1}
                  onOpenFile={onOpenFile}
                />
              ),
            )
          )}
        </div>
      )}
    </div>
  )
})

const TreeFileRow = memo(function TreeFileRow({
  entry,
  depth,
  onOpenFile,
}: {
  entry: RepoEntryDto
  depth: number
  onOpenFile: (entry: RepoEntryDto) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onOpenFile(entry)}
      className="flex w-full items-center gap-1.5 rounded-[var(--radius-input)] py-1.5 pr-2 text-left transition-colors duration-fast hover:bg-on-surface/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      title={entry.path}
    >
      <FileText className="h-4 w-4 shrink-0 text-on-surface-variant/70" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-label-md text-on-surface-variant">
          {entry.name}
        </span>
        {entry.lastCommit && (
          <span className="mt-0.5 block truncate text-label-xs text-on-surface-variant/60">
            {entry.lastCommit.author || 'unknown'} ·{' '}
            {shortMessage(entry.lastCommit.message)} ·{' '}
            {relativeTime(entry.lastCommit.date)}
          </span>
        )}
      </span>
    </button>
  )
})

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminFilesPage() {
  const { success, error } = useSnackbar()

  const files = useAdminFileManager()

  const [selectedFolder, setSelectedFolder] = useState(() => {
    try {
      return localStorage.getItem(FOLDER_STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [saving, setSaving] = useState(false)
  const [commitMessage, setCommitMessage] = useState('')
  const [discardRequest, setDiscardRequest] = useState<DiscardRequest>(null)

  // Persist the selected folder so a refresh resumes the same directory.
  useEffect(() => {
    try {
      localStorage.setItem(FOLDER_STORAGE_KEY, selectedFolder)
    } catch {
      // Ignore storage failures (private mode / quota).
    }
  }, [selectedFolder])

  // Copy-to-clipboard feedback for the path + code buttons.
  const { copied: dirCopied, copy: copyDir } = useCopyToClipboard()
  const { copied: pathCopied, copy: copyPath } = useCopyToClipboard()
  const { copied: codeCopied, copy: copyCode } = useCopyToClipboard()

  // Fullscreen editor overlay.
  const [fullscreen, setFullscreen] = useState(false)

  // Dialog state
  const [createDialog, setCreateDialog] = useState<'file' | 'folder' | null>(null)
  const [renameTarget, setRenameTarget] = useState<RepoEntryDto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RepoEntryDto | null>(null)

  const openEntry = files.openFileEntry
  const configured = files.meta?.configured ?? true
  const isExpanded = files.isExpanded
  const toggleFolder = files.toggleFolder
  const isDirty = files.isDirty
  const saveFile = files.saveFile

  const notifyMutation = useCallback(
    (label: string, result: { synced: boolean; commitSha?: string }) => {
      if (result.commitSha) {
        success(`${label} — commit ${result.commitSha.slice(0, 7)}`)
      } else {
        success(label)
      }
    },
    [success],
  )

  // files.openFile identity changes when the dirty state flips, so hold the
  // latest reference in a ref to keep handleOpenFile stable for the memoized
  // tree rows (otherwise every keystroke re-renders the whole tree).
  const openFileRef = useRef(files.openFile)
  useEffect(() => {
    openFileRef.current = files.openFile
  }, [files.openFile])

  const handleOpenFile = useCallback(async (entry: RepoEntryDto) => {
    const ok = await openFileRef.current(entry)
    if (!ok) {
      setDiscardRequest({ kind: 'switch', entry })
      return
    }
    setSelectedFolder(parentOf(entry.path))
  }, [])

  const handleSelectFolder = useCallback(
    (path: string) => {
      setSelectedFolder(path)
      if (isExpanded(path)) toggleFolder(path)
    },
    [isExpanded, toggleFolder],
  )

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return
    setSaving(true)
    try {
      const result = await saveFile(commitMessage.trim())
      notifyMutation('Saved', result)
      setCommitMessage('')
    } catch (err) {
      error(err instanceof Error ? err.message : 'Failed to save file')
    } finally {
      setSaving(false)
    }
  }, [isDirty, saveFile, saving, commitMessage, notifyMutation, error])

  const handleCreate = async (name: string, message: string) => {
    if (!createDialog) return
    const path = joinPath(selectedFolder, name)
    try {
      const result = await files.createEntry(path, createDialog, '', message.trim())
      notifyMutation(createDialog === 'folder' ? 'Folder created' : 'File created', result)
      if (createDialog === 'file') {
        // Open the freshly created file for editing.
        await files.forceOpenFile({
          name,
          path,
          type: 'file',
          size: 0,
          sha: '',
          lastCommit: null,
        })
      }
      setCreateDialog(null)
    } catch (err) {
      error(err instanceof Error ? err.message : 'Failed to create entry')
    }
  }

  const handleRename = async (newName: string, message: string) => {
    if (!renameTarget) return
    const from = renameTarget.path
    const to = joinPath(parentOf(from), newName.trim())
    try {
      const result = await files.renameEntry(from, to, message.trim())
      notifyMutation('Renamed', result)
      setRenameTarget(null)
    } catch (err) {
      error(err instanceof Error ? err.message : 'Failed to rename')
    }
  }

  const handleDelete = async (message: string) => {
    if (!deleteTarget) return
    try {
      const result = await files.deleteEntry(deleteTarget.path, message.trim())
      notifyMutation('Deleted', result)
      setDeleteTarget(null)
    } catch (err) {
      error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const handleCloseFile = () => {
    if (files.isDirty) {
      setDiscardRequest({ kind: 'close' })
      return
    }
    files.closeFile()
  }

  const rootEntries = files.rootEntries

  return (
    <div className="flex w-full min-w-0 flex-col gap-3 -mx-4 md:-mx-6">
      <Helmet>
        <title>Files · Admin</title>
      </Helmet>

      <Alert
        variant="tonal"
        color="error"
        title="Unable to load files"
        message={files.directoryError ?? ''}
        className={files.directoryError ? '' : 'hidden'}
      />

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-title-md font-semibold text-on-surface">Files</h3>
          <p className="text-body-sm text-on-surface-variant mt-0.5">
            GitHub-native repository file manager — every change is committed
            straight to the repo.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {files.meta ? (
            <>
              <Badge
                color={configured ? 'success' : 'warning'}
                variant="tonal"
                size="sm"
                leftIcon={
                  configured ? (
                    <Cloud className="h-3.5 w-3.5" />
                  ) : (
                    <CloudOff className="h-3.5 w-3.5" />
                  )
                }
              >
                {configured ? 'GitHub connected' : 'GitHub not configured'}
              </Badge>
              <Badge
                color="secondary"
                variant="tonal"
                size="sm"
                leftIcon={<FolderGit2 className="h-3.5 w-3.5" />}
              >
                {files.meta.owner}/{files.meta.repo}
              </Badge>
              <Badge
                color="secondary"
                variant="tonal"
                size="sm"
                leftIcon={<GitBranch className="h-3.5 w-3.5" />}
              >
                {files.meta.branch}
              </Badge>
            </>
          ) : (
            <Skeleton variant="text" width={160} />
          )}
          <IconButton
            variant="outline"
            size="sm"
            icon={<FolderPlus className="h-4 w-4" />}
            aria-label="New folder"
            title="New folder"
            onClick={() => setCreateDialog('folder')}
            disabled={!configured}
          />
          <IconButton
            variant="primary"
            size="sm"
            icon={<FilePlus2 className="h-4 w-4" />}
            aria-label="New file"
            title="New file"
            onClick={() => setCreateDialog('file')}
            disabled={!configured}
          />
        </div>
      </div>

      {!configured && (
        <Alert
          variant="tonal"
          color="warning"
          title="GitHub not configured"
          message="Set GITHUB_TOKEN (and optionally GITHUB_REPO_OWNER / GITHUB_REPO_NAME) in the server .env to enable the file manager."
        />
      )}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        {/* ── Sidebar: file tree ──────────────────────────────────────────── */}
        <div className="w-full min-w-0 shrink-0 lg:w-72 xl:w-80 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2 px-1">
            <button
              type="button"
              onClick={() => {
                setSelectedFolder('')
                if (!files.isExpanded('')) files.toggleFolder('')
              }}
              className="shrink-0 text-label-md font-medium text-on-surface-variant hover:text-on-surface transition-colors duration-fast"
              title="Go to repository root"
            >
              Repository
            </button>
            <div className="flex min-w-0 items-center gap-1.5">
              <Badge
                color="secondary"
                size="sm"
                variant="tonal"
                className="max-w-[9rem]"
                title={selectedFolder || 'root'}
              >
                {selectedFolder || 'root'}
              </Badge>
              <IconButton
                variant="text"
                size="sm"
                className="shrink-0"
                icon={dirCopied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                aria-label="Copy directory path"
                title="Copy directory path"
                onClick={() => {
                  void copyDir(selectedFolder || '/')
                }}
              />
              <IconButton
                variant="text"
                size="sm"
                className="shrink-0"
                icon={<RefreshCw className="h-4 w-4" />}
                aria-label="Refresh folder"
                title="Refresh folder"
                onClick={() => {
                  void files.refresh(selectedFolder)
                  if (selectedFolder !== '') void files.refresh('')
                }}
              />
            </div>
          </div>

          <div className="rounded-[var(--radius-card)] border border-outline-variant bg-surface-container/40 p-2">
            {rootEntries === undefined && !files.directoryError ? (
              <div className="flex flex-col gap-1.5 p-1">
                <Skeleton variant="text" width="80%" />
                <Skeleton variant="text" width="65%" />
                <Skeleton variant="text" width="90%" />
                <Skeleton variant="text" width="55%" />
              </div>
            ) : rootEntries === undefined ? (
              <p className="px-3 py-4 text-body-sm text-on-surface-variant">
                Could not load the repository.
              </p>
            ) : rootEntries.length === 0 ? (
              <p className="px-3 py-4 text-body-sm text-on-surface-variant">
                This folder is empty.
              </p>
            ) : (
              rootEntries.map((entry) =>
                entry.type === 'folder' ? (
                  <TreeFolderRow
                    key={entry.path}
                    folder={entry.path}
                    depth={0}
                    selectedFolder={selectedFolder}
                    onSelectFolder={handleSelectFolder}
                    onOpenFile={handleOpenFile}
                    children={files.children}
                    expanded={files.expanded}
                    loadingPaths={files.loadingPaths}
                    pending={files.pending}
                    isExpanded={files.isExpanded}
                    toggleFolder={files.toggleFolder}
                  />
                ) : (
                  <TreeFileRow
                    key={entry.path}
                    entry={entry}
                    depth={0}
                    onOpenFile={handleOpenFile}
                  />
                ),
              )
            )}
          </div>

          <p className="px-1 text-body-xs text-on-surface-variant">
            New files are created inside{' '}
            <code className="font-mono">{selectedFolder || 'the repository root'}</code>
          </p>
        </div>

        {/* ── Editor pane ─────────────────────────────────────────────────── */}
        <div className="min-w-0 flex-1 flex flex-col gap-2.5">
          {!openEntry ? (
            <EmptyState
              icon={Files}
              title="No file open"
              description="Select a file from the repository tree on the left to start editing."
            />
          ) : (
            <>
              {/* Editor header */}
              <div className="flex flex-col gap-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-label-lg text-on-surface"
                    title={openEntry.path}
                  >
                    {openEntry.path}
                  </span>
                  <IconButton
                    variant="text"
                    size="sm"
                    className="shrink-0"
                    icon={pathCopied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                    aria-label="Copy file path"
                    title="Copy file path"
                    onClick={() => void copyPath(openEntry.path)}
                  />
                  {files.isDirty && (
                    <Badge
                      color="warning"
                      variant="tonal"
                      size="sm"
                      leftIcon={<CircleDot className="h-3 w-3" />}
                    >
                      Unsaved
                    </Badge>
                  )}
                  <div className="ml-auto flex flex-wrap items-center gap-1.5">
                    <IconButton
                      variant="outline"
                      size="sm"
                      icon={codeCopied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                      aria-label="Copy code"
                      title="Copy code"
                      onClick={() => void copyCode(files.content)}
                    />
                    <IconButton
                      variant="outline"
                      size="sm"
                      icon={<Maximize className="h-4 w-4" />}
                      aria-label="Full screen"
                      title="Full screen"
                      onClick={() => setFullscreen(true)}
                    />
                    <IconButton
                      variant="outline"
                      size="sm"
                      icon={<Pencil className="h-4 w-4" />}
                      aria-label="Rename"
                      title="Rename"
                      onClick={() => setRenameTarget(openEntry)}
                      disabled={!configured}
                    />
                    <IconButton
                      variant="outline"
                      size="sm"
                      icon={<Trash2 className="h-4 w-4" />}
                      aria-label="Delete"
                      title="Delete"
                      onClick={() => setDeleteTarget(openEntry)}
                      disabled={!configured}
                    />
                    <IconButton
                      variant="primary"
                      size="sm"
                      isLoading={saving}
                      icon={<Save className="h-4 w-4" />}
                      aria-label="Commit"
                      title="Commit"
                      disabled={!files.isDirty || !configured}
                      onClick={handleSave}
                    />
                    <IconButton
                      variant="text"
                      size="sm"
                      icon={<X className="h-4 w-4" />}
                      aria-label="Close file"
                      title="Close file"
                      onClick={handleCloseFile}
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge color={languageColor(openEntry.language ?? null)} variant="tonal" size="sm">
                    {openEntry.language ?? 'text'}
                  </Badge>
                  {openEntry.size !== null && (
                    <Badge color="secondary" variant="tonal" size="sm">
                      {formatSize(openEntry.size)}
                    </Badge>
                  )}
                  {openEntry.lastCommit && (
                    <span className="text-body-xs text-on-surface-variant truncate">
                      {shortMessage(openEntry.lastCommit.message)} ·{' '}
                      {relativeTime(openEntry.lastCommit.date)}
                    </span>
                  )}
                </div>

                <Input
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder={defaultMessage('update', openEntry.path)}
                  aria-label="Commit message"
                  className="max-w-2xl"
                />
              </div>

              {files.fileError && (
                <Alert
                  variant="tonal"
                  color="error"
                  title="Failed to read file"
                  message={files.fileError}
                />
              )}

              {files.fileLoading ? (
                <Skeleton variant="rounded" height={420} />
              ) : (
                <CodeEditor
                  value={files.content}
                  onChange={files.setContent}
                  language={openEntry.language}
                  onSave={handleSave}
                  placeholder={`// Editing ${openEntry.path}`}
                  minHeight={360}
                />
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Create file/folder dialog ─────────────────────────────────────── */}
      <CreateEntryDialog
        type={createDialog}
        folder={selectedFolder}
        onConfirm={handleCreate}
        onCancel={() => setCreateDialog(null)}
      />

      {/* ── Rename dialog ─────────────────────────────────────────────────── */}
      <RenameDialog
        target={renameTarget}
        onConfirm={handleRename}
        onCancel={() => setRenameTarget(null)}
      />

      {/* ── Delete dialog ─────────────────────────────────────────────────── */}
      <DeleteDialog
        target={deleteTarget}
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* ── Discard unsaved changes ───────────────────────────────────────── */}
      <DiscardDialog
        request={discardRequest}
        onConfirm={() => {
          if (discardRequest?.kind === 'switch') {
            void files.forceOpenFile(discardRequest.entry)
            setSelectedFolder(parentOf(discardRequest.entry.path))
          } else {
            files.closeFile()
          }
          setDiscardRequest(null)
        }}
        onCancel={() => setDiscardRequest(null)}
      />

      {/* ── Fullscreen editor ─────────────────────────────────────────────── */}
      <FullscreenEditor
        open={fullscreen}
        entry={openEntry}
        content={files.content}
        isDirty={files.isDirty}
        saving={saving}
        commitMessage={commitMessage}
        onCommitMessageChange={setCommitMessage}
        onChange={files.setContent}
        onSave={handleSave}
        onClose={() => setFullscreen(false)}
        copied={codeCopied}
        onCopy={() => void copyCode(files.content)}
      />
    </div>
  )
}

// ── Fullscreen editor overlay ─────────────────────────────────────────────────

function FullscreenEditor({
  open,
  entry,
  content,
  isDirty,
  saving,
  commitMessage,
  onCommitMessageChange,
  onChange,
  onSave,
  onClose,
  copied,
  onCopy,
}: {
  open: boolean
  entry: RepoEntryDto | null
  content: string
  isDirty: boolean
  saving: boolean
  commitMessage: string
  onCommitMessageChange: (value: string) => void
  onChange: (value: string) => void
  onSave: () => void
  onClose: () => void
  copied: boolean
  onCopy: () => void
}) {
  // Lock page scroll + handle Escape while the overlay is open.
  useEffect(() => {
    if (!open) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [open, onClose])

  if (!open || !entry) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Editing ${entry.path}`}
      className="fixed inset-0 z-overlay flex flex-col bg-surface-container-high [height:100dvh]"
    >
      {/* Overlay header */}
      <div className="shrink-0 border-b border-outline-variant/70 bg-surface-container/80 px-4 py-3 [padding-top:max(0.75rem,env(safe-area-inset-top))] backdrop-blur-[var(--surface-blur-sm)]">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="min-w-0 flex-1 truncate font-mono text-label-lg text-on-surface"
            title={entry.path}
          >
            {entry.path}
          </span>
          {isDirty && (
            <Badge
              color="warning"
              variant="tonal"
              size="sm"
              leftIcon={<CircleDot className="h-3 w-3" />}
            >
              Unsaved
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            <IconButton
              variant="outline"
              size="sm"
              icon={copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
              aria-label="Copy code"
              title="Copy code"
              onClick={onCopy}
            />
            <IconButton
              variant="primary"
              size="sm"
              isLoading={saving}
              icon={<Save className="h-4 w-4" />}
              aria-label="Commit"
              title="Commit"
              disabled={!isDirty}
              onClick={onSave}
            />
            <IconButton
              variant="text"
              size="sm"
              icon={<Minimize className="h-4 w-4" />}
              aria-label="Exit fullscreen"
              title="Exit fullscreen (Esc)"
              onClick={onClose}
            />
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Badge color={languageColor(entry.language ?? null)} variant="tonal" size="sm">
            {entry.language ?? 'text'}
          </Badge>
          {entry.size !== null && (
            <Badge color="secondary" variant="tonal" size="sm">
              {formatSize(entry.size)}
            </Badge>
          )}
          {entry.lastCommit && (
            <span className="text-body-xs text-on-surface-variant truncate">
              {shortMessage(entry.lastCommit.message)} · {relativeTime(entry.lastCommit.date)}
            </span>
          )}
        </div>
        <Input
          value={commitMessage}
          onChange={(e) => onCommitMessageChange(e.target.value)}
          placeholder={defaultMessage('update', entry.path)}
          aria-label="Commit message"
          className="mt-2 max-w-2xl"
        />
      </div>

      {/* Editor body */}
      <div className="min-h-0 flex-1 p-4 [padding-bottom:max(1rem,env(safe-area-inset-bottom))]">
        <CodeEditor
          value={content}
          onChange={onChange}
          language={entry.language}
          onSave={onSave}
          placeholder={`// Editing ${entry.path}`}
          fillHeight
          autoFocus
        />
      </div>
    </div>,
    document.body,
  )
}

// ── Create file/folder dialog ─────────────────────────────────────────────────

function CreateEntryDialog({
  type,
  folder,
  onConfirm,
  onCancel,
}: {
  type: 'file' | 'folder' | null
  folder: string
  onConfirm: (name: string, message: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const open = type !== null
  const title = type === 'folder' ? 'New folder' : 'New file'
  const targetPath = folder ? `${folder}/` : ''

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel()
      }}
    >
      <Dialog.Positioner position="center">
        <Dialog.Backdrop />
        <Dialog.Content size="sm">
          <Dialog.Header>
            <Dialog.Title>{title}</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <div className="flex flex-col gap-3">
              <Field.Root>
                <Field.Label>Name</Field.Label>
                <Input
                  placeholder={type === 'folder' ? 'helpers' : 'ping.ts'}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && name.trim()) onConfirm(name.trim(), message)
                  }}
                  autoFocus
                />
                <Field.HelperText>
                  Creates{' '}
                  <code className="font-mono">
                    {targetPath}
                    {name.trim() || '…'}
                  </code>
                </Field.HelperText>
              </Field.Root>
              <Field.Root>
                <Field.Label>Commit message</Field.Label>
                <Input
                  placeholder={defaultMessage(type === 'folder' ? 'create folder' : 'create', `${targetPath}${name.trim() || '…'}`)}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </Field.Root>
            </div>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="text" color="neutral" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="filled"
              color="primary"
              disabled={!name.trim()}
              onClick={() => onConfirm(name.trim(), message)}
            >
              Create
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}

// ── Rename dialog ─────────────────────────────────────────────────────────────

function RenameDialog({
  target,
  onConfirm,
  onCancel,
}: {
  target: RepoEntryDto | null
  onConfirm: (newName: string, message: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const open = target !== null

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel()
      }}
    >
      <Dialog.Positioner position="center">
        <Dialog.Backdrop />
        <Dialog.Content size="sm">
          <Dialog.Header>
            <Dialog.Title>Rename</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            {target && (
              <div className="flex flex-col gap-3">
                <Field.Root>
                  <Field.Label>New name</Field.Label>
                  <Input
                    placeholder={target.name}
                    defaultValue={target.name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && name.trim()) onConfirm(name.trim(), message)
                    }}
                    autoFocus
                  />
                  <Field.HelperText>
                    Current: <code className="font-mono">{target.path}</code>
                  </Field.HelperText>
                </Field.Root>
                <Field.Root>
                  <Field.Label>Commit message</Field.Label>
                  <Input
                    placeholder={defaultMessage('rename', target.path)}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                </Field.Root>
              </div>
            )}
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="text" color="neutral" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              variant="filled"
              color="primary"
              disabled={!name.trim()}
              onClick={() => onConfirm(name.trim(), message)}
            >
              Rename
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}

// ── Delete dialog ─────────────────────────────────────────────────────────────

function DeleteDialog({
  target,
  onConfirm,
  onCancel,
}: {
  target: RepoEntryDto | null
  onConfirm: (message: string) => void
  onCancel: () => void
}) {
  const [message, setMessage] = useState('')
  const open = target !== null

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel()
      }}
    >
      <Dialog.Positioner position="center">
        <Dialog.Backdrop />
        <Dialog.Content size="sm">
          <Dialog.Header>
            <Dialog.Title>Delete {target?.type}</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <div className="flex flex-col gap-3">
              <p className="text-body-md text-on-surface">
                Delete <code className="font-mono">{target?.path}</code>? This
                commits the deletion to the repository and cannot be undone.
              </p>
              <Field.Root>
                <Field.Label>Commit message</Field.Label>
                <Input
                  placeholder={defaultMessage('delete', target?.path ?? '…')}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') onConfirm(message)
                  }}
                />
              </Field.Root>
            </div>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="text" color="neutral" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="filled" color="error" onClick={() => onConfirm(message)}>
              Delete
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}

// ── Discard unsaved dialog ────────────────────────────────────────────────────

function DiscardDialog({
  request,
  onConfirm,
  onCancel,
}: {
  request: DiscardRequest
  onConfirm: () => void
  onCancel: () => void
}) {
  const open = request !== null
  const isSwitch = request?.kind === 'switch'

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(v) => {
        if (!v) onCancel()
      }}
    >
      <Dialog.Positioner position="center">
        <Dialog.Backdrop />
        <Dialog.Content size="sm">
          <Dialog.Header>
            <Dialog.Title>Discard changes?</Dialog.Title>
            <Dialog.CloseTrigger />
          </Dialog.Header>
          <Dialog.Body>
            <p className="text-body-md text-on-surface">
              {isSwitch
                ? 'The open file has unsaved changes. Switching files will discard them.'
                : 'The open file has unsaved changes. Closing will discard them.'}
            </p>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="text" color="neutral" onClick={onCancel}>
              Keep editing
            </Button>
            <Button variant="filled" color="error" onClick={onConfirm}>
              Discard
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}
