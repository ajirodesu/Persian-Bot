import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ComponentType, SVGProps } from 'react'
import { createPortal } from 'react-dom'
import { Helmet } from '@dr.pogodin/react-helmet'
import {
  Folder,
  FolderPlus,
  FilePlus2,
  FileText,
  FileCode2,
  FileJson,
  FileTerminal,
  FileArchive,
  FileImage,
  FileType2,
  Palette,
  Hash,
  Pencil,
  Trash2,
  Save,
  Loader2,
  X,
  CircleDot,
  Files,
  FolderGit2,
  RefreshCw,
  Copy,
  Maximize,
  Minimize,
  Search,
  MoreVertical,
} from 'lucide-react'
import Button from '@/components/ui/buttons/Button'
import { cn } from '@/utils/cn.util'
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
import type {
  RepoEntryDto,
  RepoTreeNodeDto,
} from '@/features/admin/services/admin-file-manager.service'

/** localStorage key remembering the last selected folder across refreshes. */
const FOLDER_STORAGE_KEY = 'admin-file-manager:folder:v1'

// ── Formatting helpers ─────────────────────────────────────────────────────────

/** Extension → icon + tint used for Replit-style typed file rows. */
const FILE_TYPE_MAP: Record<
  string,
  { icon: ComponentType<SVGProps<SVGSVGElement>>; className: string }
> = {
  ts: { icon: FileCode2, className: 'text-primary' },
  tsx: { icon: FileCode2, className: 'text-primary' },
  js: { icon: FileCode2, className: 'text-warning' },
  jsx: { icon: FileCode2, className: 'text-warning' },
  json: { icon: FileJson, className: 'text-warning' },
  md: { icon: FileText, className: 'text-info' },
  mdx: { icon: FileText, className: 'text-info' },
  css: { icon: Palette, className: 'text-info' },
  scss: { icon: Palette, className: 'text-info' },
  sass: { icon: Palette, className: 'text-info' },
  html: { icon: FileCode2, className: 'text-tertiary' },
  yml: { icon: Hash, className: 'text-tertiary' },
  yaml: { icon: Hash, className: 'text-tertiary' },
  toml: { icon: Hash, className: 'text-tertiary' },
  sh: { icon: FileTerminal, className: 'text-success' },
  bash: { icon: FileTerminal, className: 'text-success' },
  zsh: { icon: FileTerminal, className: 'text-success' },
  py: { icon: FileTerminal, className: 'text-success' },
  python: { icon: FileTerminal, className: 'text-success' },
  tsconfig: { icon: FileJson, className: 'text-warning' },
  env: { icon: FileType2, className: 'text-secondary' },
  lock: { icon: FileArchive, className: 'text-secondary' },
  go: { icon: FileCode2, className: 'text-info' },
  rs: { icon: FileCode2, className: 'text-tertiary' },
  java: { icon: FileCode2, className: 'text-tertiary' },
  php: { icon: FileCode2, className: 'text-primary' },
  rb: { icon: FileCode2, className: 'text-error' },
  c: { icon: FileCode2, className: 'text-info' },
  h: { icon: FileCode2, className: 'text-info' },
  cpp: { icon: FileCode2, className: 'text-info' },
  svg: { icon: FileImage, className: 'text-warning' },
  png: { icon: FileImage, className: 'text-warning' },
  jpg: { icon: FileImage, className: 'text-warning' },
  jpeg: { icon: FileImage, className: 'text-warning' },
  gif: { icon: FileImage, className: 'text-warning' },
  ico: { icon: FileImage, className: 'text-warning' },
  webp: { icon: FileImage, className: 'text-warning' },
}

/** Returns the typed icon+tint for a file (defaults to a neutral document). */
function fileTypeStyle(name: string) {
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : ''
  const fallback: (typeof FILE_TYPE_MAP)[string] = {
    icon: FileText,
    className: 'text-on-surface-variant/70',
  }
  return ext ? (FILE_TYPE_MAP[ext] ?? fallback) : fallback
}

/** Renders the Replit-style typed icon for a filename with its tint applied. */
function FileTypeIcon({
  name,
  className,
}: {
  name: string
  className?: string
}) {
  const { icon: Icon, className: tint } = fileTypeStyle(name)
  return <Icon className={cn(tint, className)} />
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

// ── Discard-confirm request ───────────────────────────────────────────────────

type DiscardRequest = { kind: 'close'; path?: string } | null

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
          'group flex w-full items-center gap-1.5 rounded-[var(--radius-input)] py-1.5 pr-1 text-left ' +
            'cursor-pointer transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
          isSelected
            ? 'bg-primary/10 text-primary'
            : 'text-on-surface hover:bg-on-surface/5',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isLoading && !entryChildren ? (
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-on-surface-variant" />
        ) : (
          <Folder
            className={cn(
              'h-4 w-4 shrink-0',
              isSelected || isOpen
                ? 'fill-[rgb(var(--color-primary)/0.15)] text-primary'
                : 'text-on-surface-variant',
            )}
          />
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-label-md font-medium">
            {name}
          </span>
        </span>
        {isPending && (
          <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-on-surface-variant" />
        )}
        <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100">
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
                  selectedPath={selectedPath}
                  onSelectFolder={onSelectFolder}
                  onOpenFile={onOpenFile}
                  onCreateFile={onCreateFile}
                  onCreateFolder={onCreateFolder}
                  onRename={onRename}
                  onDelete={onDelete}
                  onCopyPath={onCopyPath}
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
  selectedPath,
  onOpenFile,
  onRename,
  onDelete,
  onCopyPath,
}: {
  entry: RepoEntryDto
  depth: number
  selectedPath: string | null
  onOpenFile: (entry: RepoEntryDto) => void
  onRename: (entry: RepoEntryDto) => void
  onDelete: (entry: RepoEntryDto) => void
  onCopyPath: (path: string) => void
}) {
  const { icon: FileIcon, className: iconClass } = fileTypeStyle(entry.name)
  const selected = selectedPath === entry.path

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpenFile(entry)}
      onKeyDown={(e) => e.key === 'Enter' && onOpenFile(entry)}
      className={cn(
        'group flex w-full items-center gap-1.5 rounded-[var(--radius-input)] py-1.5 pr-1 text-left ' +
          'cursor-pointer transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        selected
          ? 'bg-primary/10 text-primary'
          : 'text-on-surface-variant hover:bg-on-surface/5',
      )}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
      title={entry.path}
    >
      <FileIcon
        className={cn(
          'h-4 w-4 shrink-0',
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
      <span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-fast group-hover:opacity-100 group-focus-within:opacity-100">
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
  // may be selected at a time. Restored open files win over the persisted
  // folder so a refreshed session never shows two highlights.
  const [selectedPath, setSelectedPath] = useState<string | null>(() => {
    if (files.openFileEntry) return files.openFileEntry.path
    try {
      return localStorage.getItem(FOLDER_STORAGE_KEY) ?? null
    } catch {
      return null
    }
  })
  const [saving, setSaving] = useState(false)
  const [discardRequest, setDiscardRequest] = useState<DiscardRequest>(null)
  const [treeQuery, setTreeQuery] = useState('')

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

  // Fullscreen editor overlay.
  const [fullscreen, setFullscreen] = useState(false)

  // Mobile file-explorer drawer.
  const [mobileFilesOpen, setMobileFilesOpen] = useState(false)

  // Lock page scroll + handle Escape while the mobile file drawer is open.
  const closeFilesDrawer = useCallback(() => setMobileFilesOpen(false), [])
  useEffect(() => {
    if (!mobileFilesOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeFilesDrawer()
    }
    document.addEventListener('keydown', onKeyDown)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [mobileFilesOpen, closeFilesDrawer])

  // Dialog state
  const [createDialog, setCreateDialog] = useState<'file' | 'folder' | null>(
    null,
  )
  const [renameTarget, setRenameTarget] = useState<RepoEntryDto | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<RepoEntryDto | null>(null)

  const openEntry = files.openFileEntry
  const configured = files.meta?.configured ?? true
  const isDirty = files.isDirty
  const saveFile = files.saveFile

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

  // files.openFile identity changes when the dirty state flips, so hold the
  // latest reference in a ref to keep handleOpenFile stable for the memoized
  // tree rows (otherwise every keystroke re-renders the whole tree).
  const openFileRef = useRef(files.openFile)
  useEffect(() => {
    openFileRef.current = files.openFile
  }, [files.openFile])

  const handleOpenFile = useCallback(async (entry: RepoEntryDto) => {
    await openFileRef.current(entry)
    setSelectedFolder(parentOf(entry.path))
    setSelectedPath(entry.path)
    setMobileFilesOpen(false)
  }, [])

  const handleSelectFolder = useCallback((path: string) => {
    setSelectedFolder(path)
    setSelectedPath(path)
  }, [])

  const handleSearchResultOpen = useCallback(
    (node: { path: string; type: 'file' | 'folder' }) => {
      if (node.type === 'folder') {
        handleSelectFolder(node.path)
        if (!files.isExpanded(node.path)) files.toggleFolder(node.path)
        setMobileFilesOpen(false)
      } else {
        void handleOpenFile({
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

  const handleSave = useCallback(async () => {
    if (!isDirty || saving) return
    setSaving(true)
    try {
      const result = await saveFile()
      notifyMutation('Saved to working tree', result)
    } catch (err) {
      error(err instanceof Error ? err.message : 'Failed to save file')
    } finally {
      setSaving(false)
    }
  }, [isDirty, saveFile, saving, notifyMutation, error])

  const handleCreate = async (name: string) => {
    if (!createDialog) return
    const path = joinPath(selectedFolder, name)
    try {
      const result = await files.createEntry(path, createDialog, '')
      notifyMutation(
        createDialog === 'folder' ? 'Folder created' : 'File created',
        result,
      )
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
        setSelectedPath(path)
        // On mobile, dismiss the file drawer so the new file is immediately
        // visible in the editor (no-op on desktop, where the panel is static).
        setMobileFilesOpen(false)
      }
      setCreateDialog(null)
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

  const handleCloseTab = (path: string) => {
    const tab = files.tabs.find((t) => t.entry.path === path)
    const dirty = tab ? tab.content !== tab.savedContent : false
    if (dirty) {
      setDiscardRequest({ kind: 'close', path })
      return
    }
    files.closeTab(path)
  }

  const rootEntries = files.rootEntries
  const treeQueryActive = treeQuery.trim().length > 0
  const searchResults = useMemo(
    () => searchTreeIndex(files.treeIndex, treeQuery),
    [files.treeIndex, treeQuery],
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
          message="Connect a GitHub personal access token (ghp_…) on the Git page to enable commits and pushes. The repo (GITHUB_REPO_OWNER / GITHUB_REPO_NAME) is set in the server environment."
        />
      )}

      <Alert
        variant="tonal"
        color="error"
        title="Unable to load files"
        message={files.directoryError ?? ''}
        className={files.directoryError ? '' : 'hidden'}
      />

      {/* ── Workspace ──────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Workspace toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-hairline bg-surface-container/70 px-3 py-2">
          <div className="flex min-w-0 items-center gap-1.5">
            {selectedFolder && (
              <Badge
                color="secondary"
                size="sm"
                variant="tonal"
                className="max-w-[10rem]"
                title={selectedFolder}
              >
                {selectedFolder}
              </Badge>
            )}
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1 flex-col lg:flex-row lg:items-stretch">
              {/* Mobile backdrop for the file drawer */}
              <div
                className={cn(
                  'fixed inset-0 z-[var(--z-fixed)] bg-black/40 lg:hidden',
                  'transition-opacity duration-200',
                  mobileFilesOpen
                    ? 'opacity-100'
                    : 'pointer-events-none opacity-0',
                )}
                onClick={() => setMobileFilesOpen(false)}
              />

              {/* ── Files panel (drawer on mobile, static column on desktop) ────── */}
              <div
                className={cn(
                  'flex min-w-0 shrink-0 flex-col bg-surface-container',
                  // Mobile drawer behaviour
                  'fixed inset-y-0 left-0 z-[var(--z-drawer)] w-80 max-w-[86vw] transform border-r border-hairline shadow-elevation-3',
                  'transition-transform duration-200 ease-out lg:transition-none',
                  mobileFilesOpen ? 'translate-x-0' : '-translate-x-full',
                  // Desktop static column
                  'lg:static lg:z-auto lg:w-72 lg:max-w-none lg:translate-x-0 lg:shadow-none lg:border-r xl:w-80',
                )}
              >
                <div className="flex items-center gap-2 px-3 pt-3">
                  <Files className="h-4 w-4 text-primary" />
                  <span className="text-label-md font-semibold text-on-surface">
                    Files
                  </span>
                  <div className="ml-auto flex items-center">
                    <RowMenu
                      label="Files panel actions"
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
                    <button
                      type="button"
                      aria-label="Close files"
                      title="Close files"
                      onClick={() => setMobileFilesOpen(false)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-on-surface-variant/70 transition-colors duration-fast hover:bg-on-surface/10 hover:text-on-surface lg:hidden"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="px-3 pb-2 pt-2">
                  <Input
                    value={treeQuery}
                    onChange={(e) => setTreeQuery(e.target.value)}
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
                    inputSize="sm"
                  />
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-2 [padding-bottom:max(0.5rem,env(safe-area-inset-bottom))]">
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
                        />
                      ),
                    )
                  )}
                </div>
              </div>

              {/* ── Editor pane ─────────────────────────────────────────────────── */}
              <div className="flex min-w-0 min-h-0 flex-1 flex-col">
                {/* Tab bar */}
                <div className="flex min-h-[2.5rem] items-center gap-1 overflow-x-auto border-b border-hairline bg-surface-container/70 px-2 py-1 scrollbar-hidden">
                  {/* Mobile-only: open the file explorer drawer */}
                  <IconButton
                    variant="text"
                    size="sm"
                    className="shrink-0 lg:hidden"
                    icon={<FolderGit2 className="h-4 w-4" />}
                    aria-label="Browse files"
                    title="Browse files"
                    onClick={() => setMobileFilesOpen(true)}
                  />
                  {files.tabs.length > 0 ? (
                    files.tabs.map((tab) => {
                      const active = tab.entry.path === openEntry?.path
                      const tabDirty = tab.content !== tab.savedContent
                      return (
                        <button
                          key={tab.entry.path}
                          type="button"
                          onClick={() => {
                            setSelectedFolder(parentOf(tab.entry.path))
                            setSelectedPath(tab.entry.path)
                            void files.activateTab(tab.entry.path)
                          }}
                          title={tab.entry.path}
                          className={cn(
                            'group/tab flex h-8 min-w-0 shrink-0 items-center gap-1.5 rounded-md px-2 text-left transition-colors duration-fast focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                            active
                              ? 'bg-surface-container-high text-on-surface'
                              : 'text-on-surface-variant hover:bg-on-surface/5 hover:text-on-surface',
                          )}
                        >
                          <FileTypeIcon
                            name={tab.entry.name}
                            className="h-3.5 w-3.5 shrink-0"
                          />
                          <span className="max-w-[12rem] truncate font-mono text-label-sm">
                            {tab.entry.name}
                          </span>
                          <span
                            role="button"
                            tabIndex={-1}
                            aria-label={`Close ${tab.entry.name}`}
                            title={`Close ${tab.entry.name}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              handleCloseTab(tab.entry.path)
                            }}
                            className={cn(
                              'flex h-5 w-5 items-center justify-center rounded text-on-surface-variant/60 transition-colors duration-fast',
                              active
                                ? 'opacity-80 hover:bg-on-surface/10 hover:text-on-surface hover:opacity-100'
                                : 'opacity-0 group-hover/tab:opacity-100 hover:bg-on-surface/10 hover:text-on-surface',
                            )}
                          >
                            {tabDirty ? (
                              <CircleDot className="h-3 w-3 text-warning" />
                            ) : (
                              <X className="h-3.5 w-3.5" />
                            )}
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <span className="px-1 text-body-sm text-on-surface-variant">
                      No file open
                    </span>
                  )}

                  <span className="hidden min-w-0 flex-1 truncate text-body-xs text-on-surface-variant lg:block">
                    {openEntry?.path ?? ''}
                  </span>

                  {openEntry && (
                    <div className="ml-auto flex shrink-0 items-center gap-0.5 pl-1">
                      <IconButton
                        variant="text"
                        size="sm"
                        className="shrink-0 [&>svg]:text-primary"
                        isLoading={saving}
                        icon={<Save className="h-4 w-4" />}
                        aria-label="Save to working tree"
                        title="Save to working tree"
                        disabled={!files.isDirty || !configured}
                        onClick={handleSave}
                      />
                      <IconButton
                        variant="text"
                        size="sm"
                        className="shrink-0"
                        icon={<Maximize className="h-4 w-4" />}
                        aria-label="Full screen"
                        title="Full screen"
                        onClick={() => setFullscreen(true)}
                      />
                    </div>
                  )}
                </div>

                {/* Editor body */}
                <div className="flex min-h-0 flex-1 flex-col">
                  {!openEntry ? (
                    <div className="p-3">
                      <EmptyState
                        icon={Files}
                        title="No file open"
                        description="Select a file from the repository tree to start editing."
                      />
                      <p className="mt-3 px-1 text-body-xs text-on-surface-variant">
                        New files are created inside{' '}
                        <code className="font-mono">
                          {selectedFolder || 'the repository root'}
                        </code>
                        .
                      </p>
                    </div>
                  ) : (
                    <>
                      {files.fileError && (
                        <div className="px-3 pt-2">
                          <Alert
                            variant="tonal"
                            color="error"
                            title="Failed to read file"
                            message={files.fileError}
                          />
                        </div>
                      )}

                      <div className="min-h-0 flex-1">
                        {files.fileLoading ? (
                          <Skeleton variant="rectangular" className="h-full" />
                        ) : (
                          <CodeEditor
                            value={files.content}
                            onChange={files.setContent}
                            language={openEntry.language}
                            onSave={handleSave}
                            placeholder={`// Editing ${openEntry.path}`}
                            fillHeight
                          />
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>
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

      {/* ── Discard unsaved changes ───────────────────────────────────────── */}
      <DiscardDialog
        request={discardRequest}
        onConfirm={() => {
          if (discardRequest?.path) {
            files.closeTab(discardRequest.path)
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
        onChange={files.setContent}
        onSave={handleSave}
        onClose={() => setFullscreen(false)}
      />
    </div>
  )
}

// ── Fullscreen editor overlay ─────────────────────────────────────────────────

function FullscreenEditor({
  open,
  entry,
  content,
  onChange,
  onSave,
  onClose,
}: {
  open: boolean
  entry: RepoEntryDto | null
  content: string
  onChange: (value: string) => void
  onSave: () => void
  onClose: () => void
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
      className="fixed inset-0 z-overlay overflow-hidden bg-surface-container-lowest [height:100dvh]"
    >
      {/* Edge-to-edge editor — no chrome, padding, border, or surrounding UI. */}
      <CodeEditor
        value={content}
        onChange={onChange}
        language={entry.language}
        onSave={onSave}
        placeholder={`// Editing ${entry.path}`}
        fillHeight
        autoFocus
        borderless
      />
      {/* Floating exit control — the only affordance; keeps mobile usable
          (no Escape key) without taking any space away from the editor. */}
      <div className="absolute right-3 z-[2] [top:max(0.75rem,env(safe-area-inset-top))]">
        <IconButton
          variant="text"
          size="sm"
          icon={<Minimize className="h-4 w-4" />}
          aria-label="Exit fullscreen"
          title="Exit fullscreen (Esc)"
          onClick={onClose}
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
                and committed from the Git page.
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
              {request?.path
                ? 'This file has unsaved changes. Closing the tab will discard them.'
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

