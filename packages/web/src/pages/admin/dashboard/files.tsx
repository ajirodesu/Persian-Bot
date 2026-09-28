import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ComponentType, PointerEvent as ReactPointerEvent, SVGProps } from 'react'
import { createPortal } from 'react-dom'
import { Helmet } from '@dr.pogodin/react-helmet'
import { useNavigate } from 'react-router-dom'
import {
  Folder,
  FolderOpen,
  FolderPlus,
  FilePlus2,
  Pencil,
  Trash2,
  Loader2,
  X,
  RefreshCw,
  Copy,
  Search,
  MoreVertical,
  ChevronRight,
} from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import { cn } from '@/utils/cn.util'
import { FileTypeIcon, fileTypeStyle } from '@/components/icons/FileTypeIcons'
import Alert from '@/components/ui/feedback/Alert'
import Input from '@/components/ui/forms/Input'
import Field from '@/components/ui/forms/Field'
import Dialog from '@/components/ui/overlay/Dialog'
import Skeleton from '@/components/ui/feedback/Skeleton'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useAdminFileManager } from '@/features/admin/hooks/useAdminFileManager'
import { adminFileManagerService } from '@/features/admin/services/admin-file-manager.service'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { ROUTES } from '@/constants/routes.constants'
import type {
  RepoEntryDto,
  RepoTreeNodeDto,
} from '@/features/admin/services/admin-file-manager.service'

/** localStorage key remembering the last selected folder across refreshes. */
const FOLDER_STORAGE_KEY = 'admin-file-manager:folder:v1'

// ── Formatting helpers ─────────────────────────────────────────────────────────

/** Git working-tree status → single-letter row marker (reference M/A/D badges). */
const GIT_MARKERS: Record<
  string,
  { text: string; className: string }
> = {
  modified: { text: 'M', className: 'text-primary' },
  added: { text: 'A', className: 'text-success' },
  deleted: { text: 'D', className: 'text-error' },
  renamed: { text: 'R', className: 'text-secondary' },
  untracked: { text: 'U', className: 'text-secondary' },
}

function GitMarker({ marker }: { marker: { text: string; className: string } | null }) {
  if (!marker) return null
  return (
    <span className={cn('font-mono text-[12px] font-semibold', marker.className)}>
      {marker.text}
    </span>
  )
}

function CountChip({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-mono font-medium bg-surface-container-high text-on-surface-variant border border-hairline">
      {count}
    </span>
  )
}

interface RowMenuAction {
  icon: ComponentType<SVGProps<SVGSVGElement>>
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/**
 * Replit-style "⋮" row menu. Renders a small popover (portal-anchored to the
 * trigger) so it never clips inside the scrolling tree, and closes on Escape
 * or any outside tap.
 */
const RowMenu = memo(function RowMenu({
  label,
  actions,
  compact = false,
}: {
  label: string
  actions: RowMenuAction[]
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  const toggle = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation()
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect()
      setPos({
        top: rect.bottom + 4,
        left: Math.max(8, Math.min(window.innerWidth - 224, rect.right - 216)),
      })
    }
    setOpen((o) => !o)
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        title={label}
        onClick={toggle}
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-on-surface-variant/70 hover:bg-on-surface/10 hover:text-on-surface"
      >
        <MoreVertical className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            className="fixed inset-0 z-[var(--z-popover)]"
            onClick={() => setOpen(false)}
          >
            <div
              role="menu"
              className="absolute w-56 overflow-hidden rounded-[var(--radius-card)] border border-hairline bg-surface-container-high shadow-elevation-3"
              style={{ top: pos.top, left: pos.left }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="py-1.5">
                {actions.map((action) => (
                  <button
                    key={action.label}
                    type="button"
                    role="menuitem"
                    disabled={action.disabled}
                    onClick={() => {
                      setOpen(false)
                      action.onClick()
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 px-3 py-2 text-left text-label-md transition-colors duration-fast',
                      action.danger
                        ? 'text-error hover:bg-error/10'
                        : 'text-on-surface hover:bg-on-surface/8',
                      action.disabled && 'pointer-events-none opacity-40',
                    )}
                  >
                    <action.icon
                      className={cn(
                        'h-4 w-4 shrink-0',
                        action.danger
                          ? 'text-error'
                          : 'text-on-surface-variant',
                      )}
                    />
                    {action.label}
                  </button>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
})

function parentOf(entryPath: string): string {
  const idx = entryPath.lastIndexOf('/')
  return idx === -1 ? '' : entryPath.slice(0, idx)
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

/**
 * Full-repository search — matches file AND folder names case-insensitively
 * anywhere in the repo (backed by the recursive tree index, not just the
 * folders that have been expanded). Folders sort ahead of files.
 */
function searchTreeIndex(
  treeIndex: RepoTreeNodeDto[] | undefined,
  query: string,
): Array<RepoTreeNodeDto & { name: string }> | undefined {
  const q = query.trim().toLowerCase()
  if (!q) return undefined
  if (!treeIndex) return undefined
  const matches = treeIndex
    .map((node) => ({
      path: node.path,
      type: node.type,
      name: node.path.split('/').pop() ?? node.path,
    }))
    .filter((node) => node.name.toLowerCase().includes(q))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  return matches
}


// ── File tree (recursive, lazy, GitHub-style) ─────────────────────────────────

interface FileTreeProps {
  folder: string
  depth: number
  selectedPath: string | null
  onSelectFolder: (path: string) => void
  onOpenFile: (entry: RepoEntryDto) => void
  onCreateFile: (folder: string) => void
  onCreateFolder: (folder: string) => void
  onRename: (entry: RepoEntryDto) => void
  onDelete: (entry: RepoEntryDto) => void
  onCopyPath: (path: string) => void
  // Reference file-browser markers — maps a repo path to its git marker.
  getGitMarker: (path: string) => { text: string; className: string } | null
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
    selectedPath,
    onSelectFolder,
    onOpenFile,
    onCreateFile,
    onCreateFolder,
    onRename,
    onDelete,
    onCopyPath,
    getGitMarker,
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
  const isSelected = selectedPath === folder
  // Render children after the first expand and keep them mounted so the
  // open/close height animation can play in both directions.
  const [hasOpened, setHasOpened] = useState(isOpen)
  if (isOpen && !hasOpened) {
    setHasOpened(true)
  }
  const folderEntry: RepoEntryDto = {
    name,
    path: folder,
    type: 'folder',
    size: null,
    sha: '',
    lastCommit: null,
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          onSelectFolder(folder)
          toggleFolder(folder)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            onSelectFolder(folder)
            toggleFolder(folder)
          }
        }}
        className={[
          'group flex w-full items-center gap-1.5 rounded-[var(--radius-input)] py-2 pr-1 text-left ' +
            'cursor-pointer transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          isSelected
            ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/40'
            : 'text-on-surface hover:bg-on-surface/5',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isLoading && !entryChildren ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-on-surface-variant" />
        ) : (
          <span className="relative h-5 w-5 shrink-0" aria-hidden="true">
            <Folder
              className={cn(
                'absolute inset-0 h-5 w-5 transition-all duration-200',
                isOpen
                  ? 'opacity-0 scale-75 -rotate-12'
                  : 'opacity-100 scale-100 rotate-0',
                isSelected
                  ? 'fill-[rgb(var(--color-primary)/0.15)] text-primary'
                  : 'text-on-surface-variant',
              )}
            />
            <FolderOpen
              className={cn(
                'absolute inset-0 h-5 w-5 transition-all duration-200',
                isOpen
                  ? 'opacity-100 scale-100 rotate-0'
                  : 'opacity-0 scale-75 rotate-12',
                isSelected || isOpen
                  ? 'fill-[rgb(var(--color-primary)/0.15)] text-primary'
                  : 'text-on-surface-variant',
              )}
            />
          </span>
        )}
        <ChevronRight
          className={cn(
            'h-4 w-4 shrink-0 transition-transform duration-200 text-on-surface-variant/70',
            isOpen && 'rotate-90',
          )}
          aria-hidden="true"
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label-md font-medium">
            {name}
          </span>
        </span>
        {isPending && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-on-surface-variant" />
        )}
        {entryChildren !== undefined && (
          <CountChip count={entryChildren.length} />
        )}
        <span className="flex shrink-0 items-center gap-0.5">
          <RowMenu
            label={`Actions for ${name}`}
            compact
            actions={[
              {
                icon: FilePlus2,
                label: 'New file',
                onClick: () => onCreateFile(folder),
              },
              {
                icon: FolderPlus,
                label: 'New folder',
                onClick: () => onCreateFolder(folder),
              },
              {
                icon: Copy,
                label: 'Copy path',
                onClick: () => onCopyPath(folder),
              },
              {
                icon: Pencil,
                label: 'Rename',
                onClick: () => onRename(folderEntry),
              },
              {
                icon: Trash2,
                label: 'Delete',
                danger: true,
                onClick: () => onDelete(folderEntry),
              },
            ]}
          />
        </span>
      </div>

      {hasOpened && (
        <div
          className={cn(
            'grid transition-all duration-200 ease-out',
            isOpen
              ? '[grid-template-rows:1fr] opacity-100'
              : '[grid-template-rows:0fr] opacity-0',
          )}
        >
          <div className="overflow-hidden min-h-0">
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
                  selectedPath={selectedPath}
                  onSelectFolder={onSelectFolder}
                  onOpenFile={onOpenFile}
                  onCreateFile={onCreateFile}
                  onCreateFolder={onCreateFolder}
                  onRename={onRename}
                  onDelete={onDelete}
                  onCopyPath={onCopyPath}
                  getGitMarker={getGitMarker}
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
                  selectedPath={selectedPath}
                  onOpenFile={onOpenFile}
                  onRename={onRename}
                  onDelete={onDelete}
                  onCopyPath={onCopyPath}
                  getGitMarker={getGitMarker}
                />
              ),
            )
          )}
          </div>
          </div>
        </div>
      )}
    </div>
  )
})

const TreeFileRow = memo(function TreeFileRow({
  entry,
  depth,
  selectedPath,
  onOpenFile,
  onRename,
  onDelete,
  onCopyPath,
  getGitMarker,
}: {
  entry: RepoEntryDto
  depth: number
  selectedPath: string | null
  onOpenFile: (entry: RepoEntryDto) => void
  onRename: (entry: RepoEntryDto) => void
  onDelete: (entry: RepoEntryDto) => void
  onCopyPath: (path: string) => void
  getGitMarker: (path: string) => { text: string; className: string } | null
}) {
  const { icon: FileIcon, className: iconClass } = fileTypeStyle(entry.name)
  const selected = selectedPath === entry.path
  const marker = getGitMarker(entry.path)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenFile(entry)}
      onKeyDown={(e) => e.key === 'Enter' && onOpenFile(entry)}
      // Hover/focus intent prefetches the content so the editor opens
      // instantly on tap (best-effort, never throws).
      onPointerEnter={() => adminFileManagerService.prefetchFileContent(entry.path)}
      onFocus={() => adminFileManagerService.prefetchFileContent(entry.path)}
      className={cn(
        'group flex w-full items-center gap-1.5 rounded-[var(--radius-input)] py-2 pr-1 text-left ' +
          'cursor-pointer transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        selected
          ? 'bg-primary/10 text-primary ring-1 ring-inset ring-primary/40'
          : 'text-on-surface-variant hover:bg-on-surface/5',
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      title={entry.path}
    >
      <FileIcon
        className={cn(
          'h-5 w-5 shrink-0',
          selected ? 'text-primary' : iconClass,
        )}
      />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-label-md',
          selected ? 'font-medium text-primary' : 'text-on-surface-variant',
        )}
      >
        {entry.name}
      </span>
      <GitMarker marker={marker} />
      <span className="flex shrink-0 items-center gap-0.5">
        <RowMenu
          label={`Actions for ${entry.name}`}
          compact
          actions={[
            {
              icon: Copy,
              label: 'Copy path',
              onClick: () => onCopyPath(entry.path),
            },
            { icon: Pencil, label: 'Rename', onClick: () => onRename(entry) },
            {
              icon: Trash2,
              label: 'Delete',
              danger: true,
              onClick: () => onDelete(entry),
            },
          ]}
        />
      </span>
    </div>
  )
})

/**
 * A single hit from the full-repository search. Selecting a result highlights
 * exactly that one file or folder (single-selection rule) before opening it.
 */
const SearchResultRow = memo(function SearchResultRow({
  node,
  selected,
  onOpen,
}: {
  node: RepoTreeNodeDto & { name: string }
  selected: boolean
  onOpen: (node: { path: string; type: 'file' | 'folder' }) => void
}) {
  const isFolder = node.type === 'folder'
  const parentDir = node.path.includes('/')
    ? node.path.slice(0, node.path.lastIndexOf('/'))
    : '/'

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(node)}
      onKeyDown={(e) => e.key === 'Enter' && onOpen(node)}
      className={cn(
        'group flex w-full items-center gap-1.5 rounded-[var(--radius-input)] py-1.5 pr-1 pl-2 ' +
          'cursor-pointer text-left transition-colors duration-fast focus:outline-none ' +
          'focus-visible:ring-2 focus-visible:ring-primary',
        selected
          ? 'bg-primary/10 text-primary'
          : 'text-on-surface-variant hover:bg-on-surface/5',
      )}
      title={node.path}
    >
      {isFolder ? (
        <Folder
          className={cn(
            'h-4 w-4 shrink-0',
            selected
              ? 'fill-[rgb(var(--color-primary)/0.15)] text-primary'
              : 'text-on-surface-variant',
          )}
        />
      ) : (
        <FileTypeIcon
          name={node.name}
          className={cn('h-4 w-4 shrink-0', selected && 'text-primary')}
        />
      )}
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-label-md',
          selected && 'font-medium text-primary',
        )}
      >
        {node.name}
      </span>
      <span className="hidden shrink-0 max-w-[40%] truncate pl-1 pr-1 font-mono text-[10px] text-on-surface-variant/60 sm:block">
        {parentDir}
      </span>
    </div>
  )
})

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminFilesPage() {
  const navigate = useNavigate()
  const { success, error } = useSnackbar()

  const files = useAdminFileManager()

  const [selectedFolder, setSelectedFolder] = useState(() => {
    try {
      return localStorage.getItem(FOLDER_STORAGE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  // Single source of truth for the highlighted row — exactly ONE file OR folder
  // may be selected at a time.
  const [selectedPath, setSelectedPath] = useState<string | null>(() => {
    try {
      return localStorage.getItem(FOLDER_STORAGE_KEY) ?? null
    } catch {
      return null
    }
  })
  const [treeQuery, setTreeQuery] = useState('')

  // Empty-space dismissal: a tap/click on the tree background (not a row,
  // control, menu, or dialog) clears the single-row selection. Pointer
  // coordinates gate out scrolls/drags on both touch and mouse.
  const tapStart = useRef<{ x: number; y: number } | null>(null)

  const isBackgroundTarget = (target: EventTarget | null): boolean =>
    target instanceof HTMLElement &&
    target.closest(
      'button, a, input, textarea, select, [role="button"], [role="menu"], [role="dialog"], [role="listbox"]',
    ) === null

  const handleTreePointerDown = (e: ReactPointerEvent) => {
    tapStart.current =
      selectedPath !== null && isBackgroundTarget(e.target)
        ? { x: e.clientX, y: e.clientY }
        : null
  }

  const handleTreePointerUp = (e: ReactPointerEvent) => {
    const start = tapStart.current
    tapStart.current = null
    if (!start || selectedPath === null) return
    if (!isBackgroundTarget(e.target)) return
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (moved < 10) setSelectedPath(null)
  }

  const handleTreePointerCancel = () => {
    tapStart.current = null
  }

  // Persist the selected folder so a refresh resumes the same directory.
  useEffect(() => {
    try {
      localStorage.setItem(FOLDER_STORAGE_KEY, selectedFolder)
    } catch {
      // Ignore storage failures (private mode / quota).
    }
  }, [selectedFolder])

  // Copy-to-clipboard feedback for tree rows + the folder path actions.
  const { copy: copyPath } = useCopyToClipboard()

  // Dialog state
  const [createDialog, setCreateDialog] = useState<'file' | 'folder' | null>(
    null,
  )
  const [renameTarget, setRenameTarget] = useState<RepoEntryDto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RepoEntryDto | null>(null)

  const configured = files.meta?.configured ?? true

  const notifyMutation = useCallback(
    (label: string, result: { synced: boolean; commitSha?: string }) => {
      if (result.commitSha) {
        success(`${label} — commit ${result.commitSha.slice(0, 7)}`)
      } else {
        success(`${label} (working tree — not yet committed)`)
      }
    },
    [success],
  )

  // File taps open the dedicated editor route. Selection state is still
  // updated so a back-navigation lands on the highlighted row.
  const handleOpenFile = useCallback(
    (entry: RepoEntryDto) => {
      setSelectedFolder(parentOf(entry.path))
      setSelectedPath(entry.path)
      navigate(
        `${ROUTES.ADMIN.FILES_EDIT}?path=${encodeURIComponent(entry.path)}`,
      )
    },
    [navigate],
  )

  const handleSelectFolder = useCallback((path: string) => {
    setSelectedFolder(path)
    setSelectedPath(path)
  }, [])

  const handleSearchResultOpen = useCallback(
    (node: { path: string; type: 'file' | 'folder' }) => {
      if (node.type === 'folder') {
        handleSelectFolder(node.path)
        if (!files.isExpanded(node.path)) files.toggleFolder(node.path)
      } else {
        handleOpenFile({
          name: node.path.split('/').pop() ?? node.path,
          path: node.path,
          type: 'file',
          size: null,
          sha: '',
          lastCommit: null,
        })
      }
    },
    [files, handleOpenFile, handleSelectFolder],
  )

  const handleCreate = async (name: string) => {
    if (!createDialog) return
    const path = joinPath(selectedFolder, name)
    try {
      const result = await files.createEntry(path, createDialog, '')
      notifyMutation(
        createDialog === 'folder' ? 'Folder created' : 'File created',
        result,
      )
      const createdKind = createDialog
      setCreateDialog(null)
      if (createdKind === 'file') {
        // Open the freshly created file in the editor.
        setSelectedPath(path)
        navigate(
          `${ROUTES.ADMIN.FILES_EDIT}?path=${encodeURIComponent(path)}`,
        )
      }
    } catch (err) {
      error(err instanceof Error ? err.message : 'Failed to create entry')
    }
  }

  const handleRename = async (newName: string) => {
    if (!renameTarget) return
    const from = renameTarget.path
    const to = joinPath(parentOf(from), newName.trim())
    try {
      const result = await files.renameEntry(from, to)
      notifyMutation('Renamed', result)
      setRenameTarget(null)
    } catch (err) {
      error(err instanceof Error ? err.message : 'Failed to rename')
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    try {
      const result = await files.deleteEntry(deleteTarget.path)
      notifyMutation('Deleted', result)
      setDeleteTarget(null)
    } catch (err) {
      error(err instanceof Error ? err.message : 'Failed to delete')
    }
  }

  const rootEntries = files.rootEntries
  const treeQueryActive = treeQuery.trim().length > 0
  const searchResults = useMemo(
    () => searchTreeIndex(files.treeIndex, treeQuery),
    [files.treeIndex, treeQuery],
  )

  // Reference file-browser git markers — refresh working-tree status once
  // on mount (best-effort; rows simply show no marker until it arrives).
  // `files` is a fresh object identity every render, so it must stay out of
  // deps (refreshGit itself is a stable useCallback).
  useEffect(() => {
    void files.refreshGit()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const changedMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const change of files.gitStatus?.changes ?? []) {
      if (!map.has(change.path)) map.set(change.path, change.status)
    }
    return map
  }, [files.gitStatus])

  const getGitMarker = useCallback(
    (path: string) => {
      const status = changedMap.get(path)
      return status ? (GIT_MARKERS[status] ?? null) : null
    },
    [changedMap],
  )

  const openCreateDialog = useCallback(
    (kind: 'file' | 'folder', folder?: string) => {
      if (folder !== undefined) setSelectedFolder(folder)
      setCreateDialog(kind)
    },
    [],
  )

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <Helmet>
        <title>Files · Admin</title>
      </Helmet>

      {!configured && (
        <Alert
          variant="tonal"
          color="warning"
          title="GitHub not configured"
          message="Connect a GitHub personal access token (ghp_…) to enable commits and pushes. The repo (GITHUB_REPO_OWNER / GITHUB_REPO_NAME) is set in the server environment."
        />
      )}

      <Alert
        variant="tonal"
        color="error"
        title="Unable to load files"
        message={files.directoryError ?? ''}
        className={files.directoryError ? '' : 'hidden'}
      />

      {/* ── File browser (full page — tapping a file opens the editor) ── */}
      <div className="flex flex-col max-w-2xl lg:max-w-4xl w-full mx-auto">
        <div className="space-y-2 pt-1">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
              Files
            </h2>
            <div className="flex items-center gap-2">
              {rootEntries && (
                <span className="text-[11px] font-mono font-medium text-surface-variant">
                  {rootEntries.length} items
                </span>
              )}
              <RowMenu
                label="Files actions"
                actions={[
                  {
                    icon: FilePlus2,
                    label: 'New file',
                    onClick: () => openCreateDialog('file'),
                    disabled: !configured,
                  },
                  {
                    icon: FolderPlus,
                    label: 'New folder',
                    onClick: () => openCreateDialog('folder'),
                    disabled: !configured,
                  },
                  {
                    icon: Copy,
                    label: 'Copy directory path',
                    onClick: () => void copyPath(selectedFolder || '/'),
                  },
                  {
                    icon: RefreshCw,
                    label: 'Refresh folder',
                    onClick: () => {
                      void files.refresh(selectedFolder)
                      if (selectedFolder !== '') void files.refresh('')
                    },
                  },
                ]}
              />
            </div>
          </div>
                <div className="px-3 pb-2 pt-2">
                  <Input
                    value={treeQuery}
                    onChange={(e) => {
                      setTreeQuery(e.target.value)
                      // Lazy-load the full-repo index on first search
                      // interaction — never on page mount.
                      if (files.treeIndex === undefined && !files.treeLoading) {
                        void files.refreshTree()
                      }
                    }}
                    onFocus={() => {
                      if (files.treeIndex === undefined && !files.treeLoading) {
                        void files.refreshTree()
                      }
                    }}
                    leftIcon={<Search className="h-4 w-4" />}
                    rightIcon={
                      treeQuery ? (
                        <button
                          type="button"
                          aria-label="Clear file search"
                          onClick={() => setTreeQuery('')}
                          className="flex h-5 w-5 items-center justify-center rounded text-on-surface-variant hover:text-on-surface"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : undefined
                    }
                    placeholder="Search files…"
                    aria-label="Search files"
                    className="h-11 text-sm"
                  />
                </div>

          <div
            onPointerDown={handleTreePointerDown}
            onPointerUp={handleTreePointerUp}
            onPointerCancel={handleTreePointerCancel}
          >
                  {treeQueryActive ? (
                    searchResults === undefined ? (
                      files.treeError ? (
                        <p className="px-3 py-4 text-body-sm text-on-surface-variant">
                          {files.treeError}
                        </p>
                      ) : (
                        <div className="flex flex-col gap-1.5 p-1">
                          <Skeleton variant="text" width="80%" />
                          <Skeleton variant="text" width="65%" />
                          <Skeleton variant="text" width="90%" />
                        </div>
                      )
                    ) : searchResults.length === 0 ? (
                      <p className="px-3 py-4 text-body-sm text-on-surface-variant">
                        No files match your search.
                      </p>
                    ) : (
                      <div className="flex flex-col">
                        {searchResults.map((node) => (
                          <SearchResultRow
                            key={node.path}
                            node={node}
                            selected={selectedPath === node.path}
                            onOpen={handleSearchResultOpen}
                          />
                        ))}
                      </div>
                    )
                  ) : rootEntries === undefined && !files.directoryError ? (
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
                          selectedPath={selectedPath}
                          onSelectFolder={handleSelectFolder}
                          onOpenFile={handleOpenFile}
                          onCreateFile={(folder) =>
                            openCreateDialog('file', folder)
                          }
                          onCreateFolder={(folder) =>
                            openCreateDialog('folder', folder)
                          }
                          onRename={(entry) => setRenameTarget(entry)}
                          onDelete={(entry) => setDeleteTarget(entry)}
                          onCopyPath={(path) => void copyPath(path)}
                          getGitMarker={getGitMarker}
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
                          selectedPath={selectedPath}
                          onOpenFile={handleOpenFile}
                          onRename={(entry) => setRenameTarget(entry)}
                          onDelete={(entry) => setDeleteTarget(entry)}
                          onCopyPath={(path) => void copyPath(path)}
                          getGitMarker={getGitMarker}
                        />
                      ),
                    )
                  )}
                </div>
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
    </div>
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
  onConfirm: (name: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
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
                    if (e.key === 'Enter' && name.trim()) onConfirm(name.trim())
                  }}
                  autoFocus
                />
                <Field.HelperText>
                  Creates{' '}
                  <code className="font-mono">
                    {targetPath}
                    {name.trim() || '…'}
                  </code>{' '}
                  in the working tree — not committed yet.
                </Field.HelperText>
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
              onClick={() => onConfirm(name.trim())}
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
  onConfirm: (newName: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
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
                      if (e.key === 'Enter' && name.trim())
                        onConfirm(name.trim())
                    }}
                    autoFocus
                  />
                  <Field.HelperText>
                    Current: <code className="font-mono">{target.path}</code>
                    {' — applied to the working tree only.'}
                  </Field.HelperText>
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
              onClick={() => onConfirm(name.trim())}
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
  onConfirm: () => void
  onCancel: () => void
}) {
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
                Delete <code className="font-mono">{target?.path}</code> from
                the working tree? It will still show as a deletion until staged
                and committed.
              </p>
            </div>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="text" color="neutral" onClick={onCancel}>
              Cancel
            </Button>
            <Button variant="filled" color="error" onClick={onConfirm}>
              Delete
            </Button>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Positioner>
    </Dialog.Root>
  )
}
