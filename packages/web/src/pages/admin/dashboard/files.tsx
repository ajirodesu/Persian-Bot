import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ComponentType, CSSProperties, Ref, SVGProps } from 'react'
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
  GitBranch,
  Upload,
  Download,
  Undo2,
  History,
  Check,
  GitCommitHorizontal,
  GitBranchPlus,
  RotateCcw,
  UserKey,
  KeyRound,
  LogOut,
  Eye,
  EyeOff,
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
import { highlightToHtml } from '@/lib/syntax-highlight.lib'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { useAdminFileManager } from '@/features/admin/hooks/useAdminFileManager'
import type { UseAdminFileManagerReturn } from '@/features/admin/hooks/useAdminFileManager'
import { useSnackbar } from '@/contexts/SnackbarContext'
import type {
  RepoEntryDto,
  RepoTreeNodeDto,
  GitChangeDto,
  GitStatusDto,
  GitCommitInfoDto,
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

// ── Git working-tree panel ────────────────────────────────────────────────────

const CHANGE_META: Record<
  GitChangeDto['status'],
  {
    label: string
    className: string
    icon: ComponentType<SVGProps<SVGSVGElement>>
  }
> = {
  added: { label: 'Added', className: 'text-success', icon: FilePlus2 },
  modified: { label: 'Modified', className: 'text-warning', icon: Pencil },
  deleted: { label: 'Deleted', className: 'text-error', icon: Trash2 },
  renamed: {
    label: 'Renamed',
    className: 'text-info',
    icon: GitCommitHorizontal,
  },
  untracked: { label: 'Untracked', className: 'text-info', icon: CircleDot },
}

const GitChangeRow = memo(function GitChangeRow({
  change,
  busy,
  onDiff,
  onStage,
  onUnstage,
  onDiscard,
}: {
  change: GitChangeDto
  busy: string | null
  onDiff: (path: string, staged: boolean) => void
  onStage?: (path: string) => void
  onUnstage?: (path: string) => void
  onDiscard?: (path: string) => void
}) {
  const meta = CHANGE_META[change.status]
  const Icon = meta.icon
  return (
    // Roomier rows on phones (44px-friendly) settling back to the compact
    // rhythm from `lg` up.
    <div className="flex w-full items-center gap-2 rounded-[var(--radius-input)] py-2 pr-1 pl-1.5 transition-colors duration-fast hover:bg-on-surface/5 lg:py-1.5">
      <Icon className={cn('h-4 w-4 shrink-0', meta.className)} />
      <button
        type="button"
        onClick={() => onDiff(change.path, change.staged)}
        title={`Show diff for ${change.path}`}
        className="min-w-0 flex-1 truncate text-left font-mono text-label-sm text-on-surface transition-colors duration-fast hover:text-primary"
      >
        {change.path}
      </button>
      {change.hasUnstagedMods && (
        <Badge color="warning" variant="tonal" size="sm">
          also modified
        </Badge>
      )}
      <button
        type="button"
        onClick={() => onDiff(change.path, change.staged)}
        title={`Show diff for ${change.path}`}
        className="flex h-8 shrink-0 items-center gap-1 rounded px-2 text-label-xs font-medium text-on-surface-variant transition-colors duration-fast lg:h-6 lg:px-1.5 hover:bg-on-surface/10 hover:text-on-surface"
      >
        Diff
      </button>
      {onStage && (
        <IconButton
          variant="text"
          size="sm"
          isLoading={busy === change.path}
          disabled={busy !== null}
          icon={<Upload className="h-3.5 w-3.5" />}
          aria-label={`Stage ${change.path}`}
          title="Stage"
          onClick={() => onStage(change.path)}
        />
      )}
      {onUnstage && (
        <IconButton
          variant="text"
          size="sm"
          isLoading={busy === change.path}
          disabled={busy !== null}
          icon={<Undo2 className="h-3.5 w-3.5" />}
          aria-label={`Unstage ${change.path}`}
          title="Unstage"
          onClick={() => onUnstage(change.path)}
        />
      )}
      {onDiscard && (
        <IconButton
          variant="text"
          size="sm"
          isLoading={busy === change.path}
          disabled={busy !== null}
          icon={<RotateCcw className="h-3.5 w-3.5" />}
          aria-label={`Discard changes to ${change.path}`}
          title="Discard changes"
          onClick={() => onDiscard(change.path)}
        />
      )}
    </div>
  )
})

const HistoryRow = memo(function HistoryRow({
  commit,
}: {
  commit: GitCommitInfoDto
}) {
  return (
    <div className="flex items-start gap-2 px-2 py-2 lg:py-1.5">
      <span className="mt-0.5 shrink-0 rounded bg-primary/10 px-1 font-mono text-[10px] font-semibold text-primary">
        {commit.sha}
      </span>
      <div className="min-w-0">
        <p
          className="truncate text-label-sm text-on-surface"
          title={commit.subject}
        >
          {commit.subject}
        </p>
        <p className="text-body-xs text-on-surface-variant">
          {commit.author} · {commit.when}
        </p>
      </div>
    </div>
  )
})

const CommitBox = memo(function CommitBox({
  ref,
  configured,
  connected,
  status,
  busy,
  changesLength,
  canPush,
  canPull,
  onCommitAndPush,
  onPull,
}: {
  ref?: Ref<HTMLDivElement>
  configured: boolean
  connected: boolean
  status: GitStatusDto | null
  busy: string | null
  changesLength: number
  canPush: boolean
  canPull: boolean
  onCommitAndPush: (message: string) => Promise<boolean>
  onPull: () => void
}) {
  const [commitMsg, setCommitMsg] = useState('')

  // Keeps the whole GitPanel from re-rendering on every keystroke — only this
  // box re-renders while typing, so scrolling stays smooth on mobile.
  const handleCommitAndPushSubmit = async () => {
    if (await onCommitAndPush(commitMsg)) setCommitMsg('')
  }

  // One button does both: commit the pending changes (with the message above)
  // and push to GitHub. When there are no changes to commit it acts as a plain
  // push of the unpushed commits — so a push that failed once can always be
  // retried from this same button. Only the current branch name is required:
  // the backend resolves the push target from it, so a checkout without a
  // tracking ref still works.
  const canCommitAndPush =
    !!status?.branch &&
    connected &&
    (changesLength > 0 ? commitMsg.trim() !== '' : canPush)

  const commitAndPushTitle = !status?.branch
    ? 'Check out a branch to commit and push'
    : !connected
      ? 'Connect your GitHub identity above to commit and push'
      : changesLength > 0 && !commitMsg.trim()
        ? 'Type a commit message to commit and push'
        : changesLength > 0
          ? 'Commit the changes and push to GitHub'
          : canPush
            ? `Push ${status.ahead} unpushed commit${status.ahead === 1 ? '' : 's'} to GitHub`
            : 'Nothing to commit or push'

  return (
    <div
      ref={ref}
      data-git-composer=""
      className={cn(
        // Mobile: fixed composer pinned to the bottom of the visual viewport
        // (above the keyboard — the timezone sheet's stability model). It is
        // anchored once and never re-anchors while typing; the translate lifts
        // it by exactly the covered height when the keyboard opens.
        'flex shrink-0 flex-col gap-2 border-t border-hairline bg-surface-container p-3',
        'fixed bottom-[env(safe-area-inset-bottom)] left-0 right-0 z-[var(--z-sticky)] shadow-elevation-2 transition-transform duration-200 ease-out will-change-transform motion-reduce:transition-none',
        // Desktop: normal in-flow box inside the left column.
        'lg:static lg:bottom-auto lg:left-auto lg:right-auto lg:z-auto lg:shadow-none',
      )}
      style={{
        // --git-kb-offset is signed by the GitPanel keyboard effect:
        //  • positive (iOS, composer focused) — lifts the bar above the keyboard
        //  • negative (Android, token/other input focused) — cancels the native
        //    resizes-content lift so the bar stays exactly where it was
        //  • 0 — no keyboard / desktop.
        transform: 'translate3d(0, calc(var(--git-kb-offset, 0px) * -1), 0)',
      }}
    >
      <textarea
        value={commitMsg}
        onChange={(e) => setCommitMsg(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void handleCommitAndPushSubmit()
          }
        }}
        placeholder="Commit message"
        rows={2}
        disabled={!configured || busy !== null}
        autoComplete="off"
        // text-[16px] on mobile — the minimum size iOS Safari renders inputs at
        // without auto-zooming on focus, so the box stays stable while typing.
        className="w-full resize-none rounded-[var(--radius-input)] border border-outline-variant bg-surface-container px-3 py-2 font-mono text-[16px] leading-6 text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 sm:px-2 sm:py-1.5 sm:text-label-sm"
      />
      <div className="flex flex-col gap-1.5">
        <Button
          variant="filled"
          color="secondary"
          size="sm"
          className="w-full"
          leftIcon={<GitBranchPlus className="h-4 w-4" />}
          isLoading={busy === 'Committed & pushed'}
          disabled={!configured || busy !== null || !canCommitAndPush}
          title={commitAndPushTitle}
          onClick={() => void handleCommitAndPushSubmit()}
        >
          Commit &amp; push
          {status?.upstream && status.ahead > 0 && changesLength === 0
            ? ` (${status.ahead} ahead)`
            : ''}
        </Button>
        <Button
          variant="tonal"
          color="secondary"
          size="sm"
          className="w-full"
          leftIcon={<Download className="h-4 w-4" />}
          isLoading={busy === 'Pulled'}
          disabled={!configured || busy !== null || !canPull}
          onClick={onPull}
          title={
            status && status.behind > 0
              ? `Pull ${status.behind} incoming commit${status.behind === 1 ? '' : 's'} from upstream`
              : 'Nothing to pull'
          }
        >
          Pull
          {status?.upstream && status.behind > 0
            ? ` (${status.behind} behind)`
            : ''}
        </Button>
      </div>
    </div>
  )
})

// ── GitHub identity card (commit/push authentication) ─────────────────────────

/** Inline base transform of the token card — lifted by --git-kb-bottom. */
const TOKEN_CARD_BASE_TRANSFORM =
  'translate3d(0, calc(var(--git-kb-bottom, 0px) * -1), 0)'

/**
 * Collects the admin's GitHub personal access token. Commit and push are
 * authenticated with this key, and commits are authored by the GitHub user it
 * belongs to — so the card shows the connected account and blocks commit/push
 * until a valid key is verified.
 */
function GithubIdentityCard({
  files,
  configured,
}: {
  files: UseAdminFileManagerReturn
  configured: boolean
}) {
  const [tokenInput, setTokenInput] = useState(files.githubToken)
  const [verifyBusy, setVerifyBusy] = useState(false)
  const [showToken, setShowToken] = useState(false)
  const { success, error } = useSnackbar()

  const identity = files.githubIdentity

  const handleConnect = async () => {
    const trimmed = tokenInput.trim()
    if (!trimmed) {
      error('Enter your GitHub personal access token to connect.')
      return
    }
    setVerifyBusy(true)
    try {
      const result = await files.verifyGithubIdentity(trimmed)
      if (result) success(`Connected as @${result.login}`)
      else error(files.githubIdentityError ?? 'Failed to connect GitHub account')
    } finally {
      setVerifyBusy(false)
    }
  }

  const handleDisconnect = () => {
    setTokenInput('')
    void files.disconnectGithub()
  }

  return (
    // data-git-token-card routes mobile keyboard handling: when the token
    // input inside this card is focused, the GitPanel's keyboard effect sets
    // data-git-kb-mode="token" on the panel (a named group) and this card
    // becomes a bar PINNED above the on-screen keyboard — the exact model the
    // commit composer uses, guaranteeing the field is visible and typable
    // regardless of scroll position or how the platform treats the keyboard.
    // The long helper paragraph is hidden while pinned so the bar stays
    // compact; the column reserves the card's flow height so nothing jumps.
    <div
      data-git-token-card=""
      style={{
        // Static dock + compositor-only lift — the exact model of the commit
        // box's --git-kb-offset translate. Animating `bottom` would force a
        // layout pass on every keyboard-follow frame; a transform does not,
        // so the ride stays perfectly smooth on phones.
        bottom: 'env(safe-area-inset-bottom)',
        transform: TOKEN_CARD_BASE_TRANSFORM,
      }}
      className={cn(
        'flex shrink-0 flex-col gap-2 border-b border-hairline bg-surface px-3 py-2.5 sm:py-2 lg:bg-transparent',
        // Pinned-token mode (mobile keyboard, token input focused): the card
        // lifts out of flow and docks to the top edge of the keyboard. The
        // variants are scoped with max-lg so pinning is PHYSICALLY impossible
        // above the mobile breakpoint — a stray attribute can never stick
        // the card to the bottom of a desktop viewport.
        'max-lg:group-data-[git-kb-mode=token]/git:fixed max-lg:group-data-[git-kb-mode=token]/git:left-0 max-lg:group-data-[git-kb-mode=token]/git:right-0 max-lg:group-data-[git-kb-mode=token]/git:z-[var(--z-sticky)] max-lg:group-data-[git-kb-mode=token]/git:border-t max-lg:group-data-[git-kb-mode=token]/git:border-b-0 max-lg:group-data-[git-kb-mode=token]/git:shadow-elevation-2',
      )}
    >
      <div className="flex items-center gap-1.5">
        <KeyRound className="h-4 w-4 shrink-0 text-on-surface-variant" />
        <span className="text-label-xs font-semibold tracking-wide text-on-surface-variant uppercase">
          GitHub identity
        </span>
        {identity && (
          <Badge color="success" variant="tonal" size="sm" className="ml-auto">
            connected
          </Badge>
        )}
      </div>

      {identity ? (
        <div className="flex items-center gap-2.5">
          {identity.avatarUrl ? (
            <img
              src={identity.avatarUrl}
              alt=""
              width={28}
              height={28}
              className="h-7 w-7 shrink-0 rounded-full border border-hairline"
            />
          ) : (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-label-sm font-bold text-primary">
              {(identity.name ?? identity.login).slice(0, 1).toUpperCase()}
            </span>
          )}
          <div className="min-w-0">
            <p className="truncate text-label-md font-semibold text-on-surface">
              {identity.name ?? `@${identity.login}`}
            </p>
            <p className="truncate font-mono text-body-xs text-on-surface-variant">
              @{identity.login}
            </p>
          </div>
          <Button
            variant="text"
            color="secondary"
            size="sm"
            className="ml-auto shrink-0"
            leftIcon={<LogOut className="h-4 w-4" />}
            onClick={handleDisconnect}
          >
            Disconnect
          </Button>
        </div>
      ) : (
        <>
          {/* Token entry. Mobile-first: the field and the Connect button stack
              vertically (the button is full-width, a comfortable tap target;
              the shared Input's sm size is only restored from `sm` up, where
              the row goes side-by-side again). text-[16px] on mobile is the
              minimum iOS Safari renders inputs at — anything smaller makes it
              auto-zoom the page on focus and shifts the whole panel under the
              keyboard; the CommitBox textarea uses the same pattern. The eye
              toggle helps paste/type long ghp_… tokens on a phone keyboard. */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="relative min-w-0 flex-1">
              <input
                // An API key, not a password: always rendered as a plain text
                // input so mobile browsers never summon password managers /
                // iCloud Keychain / "use strong password" suggestions over it.
                // Masking is done with -webkit-text-security instead, so the
                // show/hide eye toggle keeps working without password
                // semantics (WebKit/Blink only; other engines show plaintext).
                type="text"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                onBlur={() => {
                  // Leaving the field empty reverts it fully to its original
                  // state — including the mask, so a revealed (empty) input
                  // never stays exposed after dismissal.
                  if (!tokenInput.trim()) setShowToken(false)
                }}
                placeholder="ghp_… personal access token"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={!configured || verifyBusy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleConnect()
                }}
                style={
                  showToken
                    ? undefined
                    : ({ WebkitTextSecurity: 'disc' } as CSSProperties)
                }
                className="w-full rounded-[var(--radius-input)] border border-outline-variant bg-surface-container px-3 py-2.5 pr-11 font-mono text-[16px] leading-6 text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 sm:py-1.5 sm:text-label-sm"
              />
              <button
                type="button"
                // Keep focus (and the on-screen keyboard) on the input while
                // toggling visibility — letting the button take focus blurs
                // the field and slams the keyboard shut mid-edit.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setShowToken((v) => !v)}
                disabled={!configured || verifyBusy}
                aria-label={showToken ? 'Hide token' : 'Show token'}
                title={showToken ? 'Hide token' : 'Show token'}
                tabIndex={!configured || verifyBusy ? -1 : 0}
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-[var(--radius-compact)] text-on-surface-variant transition-colors duration-fast hover:bg-on-surface/5 hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-50"
              >
                {showToken ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <Button
              variant="filled"
              color="secondary"
              size="sm"
              isLoading={verifyBusy}
              disabled={!configured || verifyBusy || tokenInput.trim() === ''}
              leftIcon={<UserKey className="h-4 w-4" />}
              onClick={() => void handleConnect()}
              className="w-full shrink-0 sm:w-auto"
            >
              Connect
            </Button>
          </div>
          {files.githubIdentityError && (
            <Alert
              variant="tonal"
              color="error"
              title="Could not connect GitHub"
              message={files.githubIdentityError}
              className="mt-1"
            />
          )}
          {/* Hidden while the card is pinned above the keyboard so the bar
              stays compact — the full note returns as soon as the keyboard
              closes. */}
          <p className="text-body-xs text-on-surface-variant max-lg:group-data-[git-kb-mode=token]/git:hidden">
            This is the bot&apos;s single GitHub token: it is stored encrypted on
            the server and used by /push, /installer, /update, the agent tools,
            and this File Manager. Commits are attributed to this account.
            Changes are pushed directly to the repository&apos;s default branch.
          </p>
        </>
      )}
    </div>
  )
}

function GitPanel({
  files,
  configured,
}: {
  files: UseAdminFileManagerReturn
  configured: boolean
}) {
  const { success, error } = useSnackbar()
  const [busy, setBusy] = useState<string | null>(null)

  // Per-file "Discard changes" confirm target (path of the unstaged change).
  const [discardTarget, setDiscardTarget] = useState<string | null>(null)

  // Mobile keyboard handling. On phones the commit box renders as a fixed bar
  // pinned to the bottom of the visual viewport — the same stability model as
  // the timezone search's mobile sheet: the composer is anchored once against
  // the VisualViewport and never re-anchors while typing, so the input stays
  // perfectly still and is always above the on-screen keyboard (iOS Safari
  // never resizes the layout viewport for the keyboard, so the exact covered
  // height — never a hardcoded keyboard height — is lifted off via a
  // translate). Android/Chrome with the app's interactive-widget=resizes-content
  // meta already reflows the layout, so the value reads ~0 there and the
  // composer never double-moves.
  //
  // Focus-scoped: ONLY the focused input adjusts for the keyboard. Focusing
  // the commit composer lifts the composer (--git-kb-offset); focusing the
  // GitHub token input shifts just the identity card by exactly the amount it
  // is clipped by the keyboard (--git-token-offset) — the composer and every
  // other element stay put, so nothing else jumps around while typing.
  const panelRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Coarse-pointer mobile gate: `lg` is this panel's mobile breakpoint, and
    // the pointer check keeps desktop (including pinch/ctrl-zoom, where the
    // visual viewport also shrinks) from ever moving the layout.
    const mq = window.matchMedia('(max-width: 1023px) and (pointer: coarse)')
    const vv = window.visualViewport
    let raf = 0
    let mode: 'composer' | 'token' | null = null
    // Token revert bookkeeping: tokenKbSeen — has the keyboard been observed
    // OPEN since the token card took focus (guards against the pre-keyboard
    // frames right after focusin); tokenDirty — has anything been typed into
    // it since. Dismissing the keyboard (back button, dismiss gesture) does
    // NOT blur the field on many browsers, so without this the card would
    // stay pinned above a keyboard that is no longer there.
    let tokenKbSeen = false
    let tokenDirty = false
    // Grace window for the "no keyboard ever appeared" case: right after
    // focusin the soft keyboard has not resized the viewport YET (normal),
    // but on devices with a hardware keyboard it NEVER will — pinning would
    // then leave the card floating at the bottom forever.
    const NO_KB_GRACE_MS = 1500
    let tokenFocusClosedSince = 0
    // Set when focus leaves the token card while its keyboard is still
    // closing: the card STAYS pinned and rides the keyboard down, releasing
    // only once the viewport has settled. Releasing instantly makes the card
    // snap back into flow and the column below jump — visible stutter.
    let tokenReleasePending = false
    // When the deferred release started — the ride-down has a HARD deadline
    // so a misbehaving event stream can never keep it alive indefinitely.
    let tokenPendingSince = 0
    // The token card's flow height, measured ONCE per pin cycle while still
    // in flow (before the fixed class applies). Never re-read while pinned:
    // a forced offsetHeight read on every keyboard-follow frame thrashes
    // layout right when the animation needs to be smooth.
    let tokenCardH = 0
    // Highest innerHeight ever seen this session. On Android/Chrome the app's
    // interactive-widget=resizes-content meta shrinks window.innerHeight when
    // the keyboard opens — the deficit against this high-water mark is the
    // reflow keyboard height. It only ever grows (rotation to a taller
    // viewport), so a keyboard can never pollute it.
    let maxInnerHeight = window.innerHeight

    // Write-coalescing: every setProperty invalidates style for the whole
    // panel subtree, and viewport events arrive in bursts where the values
    // usually have NOT changed (iOS pan frames, keyboard-settle frames).
    // Skip identical writes so follow-up frames are pure no-ops.
    const writtenVars = new Map<string, string>()
    function setVar(name: string, value: string): void {
      if (writtenVars.get(name) === value) return
      writtenVars.set(name, value)
      panelRef.current?.style.setProperty(name, value)
    }

    // The card element is stable across re-renders (React reuses the node),
    // so resolve it once and only re-query if it left the DOM. Saves a
    // querySelector on every keyboard-follow frame.
    let tokenCardEl: HTMLElement | null = null
    const getTokenCard = (): HTMLElement | null => {
      if (!tokenCardEl || !tokenCardEl.isConnected) {
        tokenCardEl =
          panelRef.current?.querySelector<HTMLElement>(
            '[data-git-token-card]',
          ) ?? null
      }
      return tokenCardEl
    }

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)')
    // Teardown for an in-flight release glide — invoked when the card is
    // re-pinned mid-animation so a refocus can never inherit stale inline
    // transition/transform styles.
    let flipCancel: (() => void) | null = null

    // Fully unpin the identity card and reset every pin-cycle flag. The card
    // glides back to its flow slot (FLIP) instead of teleporting: FIRST its
    // docked rect is captured, then unpinning happens, then LAST/INVERT/PLAY
    // animates the short journey home. Surrounding layout needs no animation
    // — the card re-enters the exact space the reserved padding frees, so
    // nothing below ever shifts. Respects prefers-reduced-motion.
    const releaseTokenPin = () => {
      const root = panelRef.current
      if (!root) return
      if (flipCancel) flipCancel()

      const card = getTokenCard()
      const wasPinned = root.dataset.gitKbMode === 'token'
      const firstRect =
        wasPinned && card && mq.matches && !reduceMotion.matches
          ? card.getBoundingClientRect()
          : null

      setVar('--git-kb-bottom', '0px')
      setVar('--git-token-h', '0px')
      if (root.dataset.gitKbMode === 'token') delete root.dataset.gitKbMode
      tokenCardH = 0
      tokenKbSeen = false
      tokenDirty = false
      tokenReleasePending = false
      tokenPendingSince = 0

      if (!firstRect || !card) return
      const lastRect = card.getBoundingClientRect()
      const dx = Math.round(firstRect.left - lastRect.left)
      const dy = Math.round(firstRect.top - lastRect.top)
      if (dx === 0 && dy === 0) return

      const style = card.style
      style.setProperty('transition', 'none')
      style.setProperty('transform', `translate3d(${dx}px, ${dy}px, 0)`)
      // Commit the inverted position before enabling the transition.
      void card.offsetWidth
      style.setProperty(
        'transition',
        'transform 260ms cubic-bezier(0.2, 0, 0, 1)',
      )
      style.setProperty('transform', TOKEN_CARD_BASE_TRANSFORM)

      const onEnd = (e: TransitionEvent) => {
        if (e.propertyName !== 'transform' || e.target !== card) return
        finish()
      }
      let timer = 0
      const finish = () => {
        window.clearTimeout(timer)
        card.removeEventListener('transitionend', onEnd)
        // Drop the transition so later var-driven transforms stay instant.
        style.setProperty('transition', 'none')
        if (flipCancel === cancel) flipCancel = null
      }
      const cancel = () => {
        window.clearTimeout(timer)
        card.removeEventListener('transitionend', onEnd)
        style.setProperty('transition', 'none')
        style.setProperty('transform', TOKEN_CARD_BASE_TRANSFORM)
        if (flipCancel === cancel) flipCancel = null
      }
      timer = window.setTimeout(finish, 320)
      card.addEventListener('transitionend', onEnd)
      flipCancel = cancel
    }

    const update = () => {
      raf = 0
      const root = panelRef.current
      if (!root) return
      if (window.innerHeight > maxInnerHeight) maxInnerHeight = window.innerHeight

      // Off-mobile escape (resized desktop window, touch-laptop, emulation
      // without a coarse pointer): the keyboard choreography below must never
      // run, and any token/composer keyboard state is torn down instantly.
      // The pinned CSS itself is max-lg-scoped — this is the JS mirror.
      if (!mq.matches && (mode !== null || tokenReleasePending)) {
        mode = null
        tokenReleasePending = false
        tokenPendingSince = 0
        tokenKbSeen = false
        tokenDirty = false
        releaseTokenPin()
        setVar('--git-kb-offset', '0px')
        return
      }

      // Two keyboard models, whichever applies:
      //  • kbCovered — iOS Safari: the layout viewport NEVER resizes for the
      //    keyboard; the covered band below the visual viewport is the keyboard.
      //  • kbReflow  — Android/Chrome (resizes-content): the layout viewport
      //    itself shrinks, so the covered band reads ~0 — the deficit against
      //    the high-water mark is the keyboard, and the browser NATIVELY lifts
      //    fixed-position elements (like the commit composer) with it.
      const kbCovered =
        mq.matches && vv
          ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop))
          : 0
      const kbReflow = mq.matches
        ? Math.max(0, maxInnerHeight - window.innerHeight)
        : 0
      const kbOpen = kbCovered > 0 || kbReflow > 0

      // Self-healing revert. Two stuck states are covered here, evaluated on
      // every update() — including the 1 Hz reconcile tick below, so missed
      // transitions (no event ever delivered) still recover within ~1s:
      //  • dismissed untouched: keyboard closed while the empty field kept
      //    focus (back button / dismiss gesture) — deselect + unpin;
      //  • no keyboard at all: focus held but the viewport never resized
      //    beyond the grace window (hardware-keyboard devices) — same.
      if (mq.matches && mode === 'token') {
        if (kbOpen) {
          tokenKbSeen = true
          tokenFocusClosedSince = 0
        } else {
          const dismissedUntouched = tokenKbSeen && !tokenDirty
          const noKeyboardEver =
            !tokenKbSeen &&
            tokenFocusClosedSince > 0 &&
            performance.now() - tokenFocusClosedSince > NO_KB_GRACE_MS
          if (dismissedUntouched || noKeyboardEver) {
            const active = document.activeElement
            if (
              active instanceof HTMLElement &&
              active.closest('[data-git-token-card]')
            ) {
              active.blur()
            }
            mode = null
            tokenReleasePending = true
            tokenPendingSince = performance.now()
          }
        }
      }

      // Mode attribute drives the pinned-token card (group/git variants) and
      // must be cleared whenever no git input owns the keyboard. The card
      // node is cached — React reuses it, so this is not a per-frame query.
      const card = getTokenCard()

      if (mode === 'composer') {
        // Only the commit composer lifts. On iOS that is the covered band
        // (translate); on Android the native reflow already lifted it, so the
        // translate stays 0 — never both, or the bar would double-rise.
        setVar('--git-kb-offset', `${kbCovered}px`)
      } else {
        // The composer must stay EXACTLY where it was. On Android the native
        // reflow lifts the fixed bar with the keyboard, so it is pushed back
        // down by the same amount (behind the keyboard, invisible — but
        // perfectly still). On iOS kbReflow is 0 and nothing moves.
        setVar('--git-kb-offset', `${-kbReflow}px`)
      }

      // Pinned while the card owns the keyboard, or while riding a closing
      // one out after focus moved away. Two hard terminators: the keyboard
      // reading zero, or the ride deadline expiring — either way the pending
      // release completes and nothing can stay pinned indefinitely.
      const RIDE_MAX_MS = 1200
      const riding =
        tokenReleasePending &&
        kbOpen &&
        performance.now() - tokenPendingSince < RIDE_MAX_MS
      const pinned = mode === 'token' || riding

      if (pinned && card) {
        // Re-pinning mid-glide (fast refocus): tear down the release
        // animation first so no stale inline transform fights the dock.
        if (flipCancel) flipCancel()
        // Dock the identity card above the keyboard: reserve its flow height
        // ONCE per pin cycle (measured in flow, before the fixed class
        // applies), then keep following kbCovered each frame without further
        // layout reads. On iOS the dock sits kbCovered above the viewport
        // bottom; on Android the reflowed layout bottom already IS the
        // keyboard's top, so the offset is 0.
        if (tokenCardH === 0) {
          tokenCardH = card.offsetHeight
        }
        setVar('--git-token-h', `${tokenCardH}px`)
        setVar('--git-kb-bottom', `${kbCovered}px`)
        if (root.dataset.gitKbMode !== 'token') root.dataset.gitKbMode = 'token'
      } else {
        releaseTokenPin()
      }
    }

    // The keyboard open/close sequence fires a burst of viewport events —
    // fold them into one layout read per frame.
    const onEvent = () => {
      if (raf) return
      raf = requestAnimationFrame(update)
    }

    // Focus routing: which on-screen input owns the keyboard right now.
    const classify = (target: Element | null): 'composer' | 'token' | null => {
      if (!target) return null
      if (target.closest('[data-git-composer]')) return 'composer'
      if (target.closest('[data-git-token-card]')) return 'token'
      return null
    }
    const onFocusIn = (e: FocusEvent) => {
      const next = classify(e.target as Element | null)
      if (next === 'token') {
        // Fresh entry into the token card starts a clean session: the field
        // is untouched, the keyboard has not been seen yet, and the no-
        // keyboard grace clock starts now. Moving focus within the card
        // (input ⇄ eye toggle) keeps the flags.
        if (mode !== 'token') {
          tokenDirty = false
          tokenKbSeen = false
          tokenFocusClosedSince = performance.now()
        }
        // Re-focused before a pending release completed (quick re-tap while
        // the keyboard is still closing): cancel the release seamlessly.
        tokenReleasePending = false
      } else if (next === 'composer') {
        // Another git input owns the keyboard now — the card must return to
        // flow immediately, not ride this keyboard out.
        tokenReleasePending = false
      }
      mode = next
      onEvent()
    }
    // Any edit inside the token card marks it dirty so a keyboard dismissal
    // after typing keeps the card pinned (the user may be about to connect).
    const onInput = (e: Event) => {
      if ((e.target as Element | null)?.closest?.('[data-git-token-card]')) {
        tokenDirty = true
      }
    }
    // focusout fires before the next focusin — re-check in a microtask so
    // tabbing between the panel's inputs never flashes back to "no mode".
    // When focus leaves the token card to NOTHING (tap-away, keyboard dismiss)
    // while the card is pinned, defer the release: the card stays pinned and
    // follows the closing keyboard down (tokenReleasePending), instead of
    // snapping back into flow mid-animation. The next update() with the
    // keyboard fully closed completes the release.
    const onFocusOut = () => {
      queueMicrotask(() => {
        const next = classify(document.activeElement)
        if (mode === 'token' && next === null) {
          tokenReleasePending = true
          tokenPendingSince = performance.now()
        }
        mode = next
        onEvent()
      })
    }

    // Self-healing tick: the revert logic above only runs inside update(),
    // and mobile browsers sometimes reach "keyboard gone" without delivering
    // any viewport event (app backgrounded mid-edit, dismissal gesture
    // swallowed, final resize coalesced away). A light 1 Hz tick plus the
    // foreground hooks below re-run update() so a stuck pin always recovers;
    // the write-coalescing in setVar makes no-op ticks free.
    const reconcile = () => {
      if (mode === 'token' || tokenReleasePending) onEvent()
    }
    const reconcileTimer = window.setInterval(reconcile, 1_000)

    update()
    vv?.addEventListener('resize', onEvent)
    // Passive: the handler never cancels scrolling — this lets the browser
    // keep visual-viewport panning on the compositor thread while pinned.
    vv?.addEventListener('scroll', onEvent, { passive: true })
    window.addEventListener('resize', onEvent)
    document.addEventListener('visibilitychange', onEvent)
    window.addEventListener('focus', onEvent)
    const root = panelRef.current
    root?.addEventListener('focusin', onFocusIn)
    root?.addEventListener('focusout', onFocusOut)
    root?.addEventListener('input', onInput)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      window.clearInterval(reconcileTimer)
      if (flipCancel) flipCancel()
      vv?.removeEventListener('resize', onEvent)
      vv?.removeEventListener('scroll', onEvent)
      window.removeEventListener('resize', onEvent)
      document.removeEventListener('visibilitychange', onEvent)
      window.removeEventListener('focus', onEvent)
      root?.removeEventListener('focusin', onFocusIn)
      root?.removeEventListener('focusout', onFocusOut)
      root?.removeEventListener('input', onInput)
    }
  }, [])

  // The pinned composer is out of flow on mobile, so its height is reserved as
  // bottom padding inside the column — otherwise the last change/history rows
  // would scroll behind it. Mirrors the composer's height one-to-one via a CSS
  // var (set imperatively, no re-render), keeping the layout identical whether
  // the bar is in-flow (desktop) or pinned (mobile).
  useLayoutEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const root = panelRef.current
    const sync = () => {
      if (!root) return
      root.style.setProperty(
        '--git-composer-h',
        mq.matches && composerRef.current
          ? `${composerRef.current.offsetHeight}px`
          : '0px',
      )
    }
    sync()
    const ro = new ResizeObserver(sync)
    if (composerRef.current) ro.observe(composerRef.current)
    mq.addEventListener('change', sync)
    window.addEventListener('resize', sync)
    return () => {
      ro.disconnect()
      mq.removeEventListener('change', sync)
      window.removeEventListener('resize', sync)
    }
  }, [])

  const run = useCallback(
    async (label: string, fn: () => Promise<unknown>): Promise<boolean> => {
      setBusy(label)
      try {
        await fn()
        success(label)
      } catch (err) {
        error(err instanceof Error ? err.message : `${label} failed`)
        return false
      } finally {
        setBusy(null)
      }
      return true
    },
    [success, error],
  )

  const status = files.gitStatus
  const changes = useMemo(() => status?.changes ?? [], [status])
  const staged = useMemo(() => changes.filter((c) => c.staged), [changes])
  const unstaged = useMemo(() => changes.filter((c) => !c.staged), [changes])
  // Push only when there are actual unpushed commits (status.ahead counts the
  // commits ahead of the tracked upstream; it is 0 when there is no upstream).
  // The Push action goes through the GitHub REST API (like /installer and
  // /push), so it needs a tracked branch to know where to push.
  const canPush = status ? status.ahead > 0 : false

  // Pull only when there are actual incoming commits to fetch + merge
  // (status.behind counts the commits the tracked upstream is ahead of).
  const canPull = status ? status.behind > 0 : false

  // Stable per-action handlers so memoized rows skip re-rendering on keystrokes
  // and while only the busy spinner animates.
  const handleRefresh = useCallback(() => {
    void files.refreshGit()
    void files.loadHistory()
  }, [files])

  const checkout = useCallback(
    (branch: string) => {
      void run(`Checked out ${branch}`, () => files.checkoutBranch(branch))
    },
    [run, files],
  )

  const openDiff = useCallback(
    (path: string, staged2: boolean) => {
      void files.openDiff(path, staged2)
    },
    [files],
  )

  const stagePath = useCallback(
    (path: string) => {
      void run('Staged', () => files.stagePaths([path]))
    },
    [run, files],
  )

  const unstagePath = useCallback(
    (path: string) => {
      void run('Unstaged', () => files.unstagePaths([path]))
    },
    [run, files],
  )

  const stageAll = useCallback(
    () => void run('Staged all changes', () => files.stageAll()),
    [run, files],
  )

  const unstageAll = useCallback(
    () => void run('Unstaged all', () => files.unstagePaths([])),
    [run, files],
  )

  const handlePull = useCallback(
    () => void run('Pulled', () => files.pullChanges()),
    [run, files],
  )

  // The single "Commit & push" action. With pending changes it stages them
  // (if needed), commits, then pushes to GitHub via the REST API. With no
  // changes to commit it acts as a plain push of the unpushed commits, so a
  // push that failed once is always retryable from this same button.
  // Requires a connected GitHub identity — commit/push are authenticated with
  // the admin's GitHub API key.
  const handleCommitAndPush = useCallback(
    (message: string): Promise<boolean> => {
      const msg = message.trim()
      if (busy !== null || !status?.branch) return Promise.resolve(false)
      if (changes.length > 0 && !msg) return Promise.resolve(false)
      if (changes.length === 0 && !canPush) return Promise.resolve(false)
      if (!files.githubIdentity) return Promise.resolve(false)
      return run('Committed & pushed', async () => {
        if (changes.length > 0) {
          if (staged.length === 0) await files.stageAll()
          await files.commitAndPush(msg)
        } else {
          await files.pushChanges()
        }
      })
    },
    [changes.length, staged.length, busy, status?.branch, canPush, run, files],
  )

  const discardPath = useCallback(
    (path: string) => {
      setDiscardTarget(null)
      void run('Discarded changes', () => files.discardPaths([path]))
    },
    [run, files],
  )

  return (
    // group/git — the keyboard effect sets data-git-kb-mode on this root;
    // the token card and the column below style themselves off that state.
    <div
      ref={panelRef}
      className="group/git flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"
    >
      {/* Left column — branch, changes, commit box, history. While the token
          card is pinned above the keyboard its flow slot is empty, so the
          card's measured height is reserved as top padding — nothing below
          shifts. */}
      <div className="flex min-w-0 flex-col border-b border-hairline pt-[var(--git-token-h,0px)] pb-[calc(var(--git-composer-h,0px)+env(safe-area-inset-bottom))] group-data-[git-kb-mode=token]/git:border-b-0 lg:pb-0 lg:w-96 lg:border-r lg:border-b-0 lg:pt-0 xl:w-[26rem]">
        <GithubIdentityCard files={files} configured={configured} />

        {/* Branch + sync actions */}
        <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
          <select
            aria-label="Current branch"
            value={status?.branch ?? ''}
            onChange={(e) => {
              const branch = e.target.value
              if (branch && branch !== status?.branch) checkout(branch)
            }}
            disabled={!configured || busy !== null}
            className="min-w-0 flex-1 truncate rounded-[var(--radius-input)] border border-outline-variant bg-surface-container px-2 py-2.5 text-label-sm text-on-surface focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
          >
            <option value="" disabled>
              {status?.branch ?? 'no branch'}
            </option>
            {files.branches.map((branch) => (
              <option key={branch} value={branch}>
                {branch}
              </option>
            ))}
          </select>
          <IconButton
            variant="text"
            size="sm"
            isLoading={files.gitLoading}
            icon={<RefreshCw className="h-4 w-4" />}
            aria-label="Refresh git status"
            title="Refresh"
            onClick={handleRefresh}
          />
        </div>

        {/* Changes list */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-2">
          {files.gitError && (
            <div className="px-1 pb-2">
              <Alert
                variant="tonal"
                color="error"
                title="Git error"
                message={files.gitError}
              />
            </div>
          )}

          {!configured ? (
            <Alert
              variant="tonal"
              color="warning"
              title="Local git not configured"
              message="Set ADMIN_REPO_PATH (or run the server from a git checkout) to manage this repository."
            />
          ) : !status && files.gitLoading ? (
            <div className="flex flex-col gap-1.5 p-1">
              <Skeleton variant="text" width="80%" />
              <Skeleton variant="text" width="65%" />
              <Skeleton variant="text" width="90%" />
            </div>
          ) : !status ? (
            <EmptyState
              icon={GitBranch}
              title="No status"
              description="Could not load the working-tree status."
            />
          ) : status.clean ? (
            <EmptyState
              icon={Check}
              title="Working tree clean"
              description="Nothing to commit. Edit files to create changes."
            />
          ) : (
            <div className="flex flex-col gap-2.5">
              {/* Staged */}
              <div className="flex items-center gap-1.5 px-1">
                <span className="text-label-xs font-semibold tracking-wide text-on-surface-variant uppercase">
                  Staged · {staged.length}
                </span>
                {staged.length > 0 && (
                  <button
                    type="button"
                    onClick={unstageAll}
                    disabled={busy !== null}
                    className="ml-auto rounded px-2 py-2 text-label-xs font-medium text-on-surface-variant transition-colors duration-fast lg:px-1.5 lg:py-1 hover:bg-on-surface/5 hover:text-on-surface"
                  >
                    Unstage all
                  </button>
                )}
              </div>
              <div className="flex flex-col">
                {staged.map((change) => (
                  <GitChangeRow
                    key={change.path}
                    change={change}
                    busy={busy}
                    onDiff={openDiff}
                    onUnstage={unstagePath}
                  />
                ))}
              </div>

              {/* Unstaged */}
              <div className="mt-1 flex items-center gap-1.5 px-1">
                <span className="text-label-xs font-semibold tracking-wide text-on-surface-variant uppercase">
                  Changes · {unstaged.length}
                </span>
                {unstaged.length > 0 && (
                  <button
                    type="button"
                    onClick={stageAll}
                    disabled={busy !== null}
                    className="ml-auto rounded px-2 py-2 text-label-xs font-medium text-on-surface-variant transition-colors duration-fast lg:px-1.5 lg:py-1 hover:bg-on-surface/5 hover:text-on-surface"
                  >
                    Stage all
                  </button>
                )}
              </div>
              <div className="flex flex-col">
                {unstaged.map((change) => (
                  <GitChangeRow
                    key={change.path}
                    change={change}
                    busy={busy}
                    onDiff={openDiff}
                    onStage={stagePath}
                    onDiscard={discardPath}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Commit + push box. On mobile this is a fixed bar pinned to the
            bottom of the visual viewport (above the keyboard) — the timezone
            sheet's stability model: anchored once, never re-anchoring while
            typing. The column reserves its height via --git-composer-h so the
            surrounding layout stays identical. Desktop uses the normal
            in-flow box. */}
        <CommitBox
          ref={composerRef}
          configured={configured}
          connected={files.githubIdentity !== null}
          status={status}
          busy={busy}
          changesLength={changes.length}
          canPush={canPush}
          canPull={canPull}
          onCommitAndPush={handleCommitAndPush}
          onPull={handlePull}
        />

        {/* History */}
        <div className="shrink-0 border-t border-hairline">
          <div className="flex items-center gap-1.5 px-3 pt-2.5 pb-1">
            <History className="h-3.5 w-3.5 text-on-surface-variant" />
            <span className="text-label-xs font-semibold tracking-wide text-on-surface-variant uppercase">
              History
            </span>
            <IconButton
              variant="text"
              size="sm"
              icon={<RefreshCw className="h-3 w-3" />}
              aria-label="Refresh history"
              title="Refresh history"
              onClick={() => void files.loadHistory()}
            />
          </div>
          {/* Slightly shorter on phones so the change list keeps more of the
              viewport; grows back once width allows. */}
          <div className="max-h-28 overflow-y-auto overscroll-contain px-1 pb-2 sm:max-h-40">
            {files.history.length === 0 ? (
              <p className="px-2 py-1 text-body-xs text-on-surface-variant">
                No commits yet.
              </p>
            ) : (
              files.history.map((commit) => (
                <HistoryRow key={commit.sha} commit={commit} />
              ))
            )}
          </div>
        </div>
      </div>

      {/* Right column — diff viewer (desktop side-by-side) */}
      <div className="hidden min-w-0 min-h-0 flex-1 flex-col lg:flex">
        {files.gitDiffPath ? (
          <>
            <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2">
              <span className="min-w-0 flex-1 truncate font-mono text-label-sm text-on-surface">
                {files.gitDiffPath}
              </span>
              {files.gitDiffStaged && (
                <Badge color="primary" variant="tonal" size="sm">
                  staged
                </Badge>
              )}
              <IconButton
                variant="text"
                size="sm"
                icon={<X className="h-4 w-4" />}
                aria-label="Close diff"
                title="Close diff"
                onClick={files.closeDiff}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto bg-surface-container-lowest">
              {files.gitDiffLoading ? (
                <Skeleton variant="rectangular" className="h-full" />
              ) : files.gitDiffError ? (
                <Alert
                  variant="tonal"
                  color="error"
                  title="Failed to load diff"
                  message={files.gitDiffError}
                />
              ) : (
                <GitDiffView content={files.gitDiff ?? ''} />
              )}
            </div>
          </>
        ) : (
          <div className="flex min-h-0 flex-1 items-center justify-center p-6">
            <EmptyState
              icon={GitCommitHorizontal}
              title="No diff selected"
              description="Select a changed file from the list to view its unified diff."
            />
          </div>
        )}
      </div>

      {/* Full-screen diff sheet — mobile only. It portals to document.body, so
          the lg:hidden responsibility lives on the portal root itself (an
          ancestor wrapper cannot hide it). */}
      {files.gitDiffPath !== null && (
        <MobileDiffSheet
          path={files.gitDiffPath}
          staged={files.gitDiffStaged}
          content={files.gitDiff}
          loading={files.gitDiffLoading}
          error={files.gitDiffError}
          onClose={files.closeDiff}
        />
      )}

      <GitDiscardDialog
        path={discardTarget}
        onConfirm={() => {
          if (discardTarget) discardPath(discardTarget)
        }}
        onCancel={() => setDiscardTarget(null)}
      />
    </div>
  )
}

// ── Mobile diff sheet (full-screen, shown below the lg breakpoint) ────────────

function MobileDiffSheet({
  path,
  staged,
  content,
  loading,
  error,
  onClose,
}: {
  path: string
  staged: boolean
  content: string | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  // Lock page scroll + handle Escape while the sheet is open.
  useEffect(() => {
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
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Diff for ${path}`}
      className="fixed inset-0 z-overlay flex flex-col overflow-hidden bg-surface-container-lowest [height:100dvh] lg:hidden"
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-hairline px-3 py-2 [padding-top:max(0.75rem,env(safe-area-inset-top))]">
        <GitCommitHorizontal className="h-4 w-4 shrink-0 text-on-surface-variant" />
        <span className="min-w-0 flex-1 truncate font-mono text-label-sm text-on-surface">
          {path}
        </span>
        {staged && (
          <Badge color="primary" variant="tonal" size="sm">
            staged
          </Badge>
        )}
        <IconButton
          variant="text"
          size="sm"
          icon={<X className="h-4 w-4" />}
          aria-label="Close diff"
          title="Close diff"
          onClick={onClose}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-surface-container-lowest [padding-bottom:calc(1rem+env(safe-area-inset-bottom))]">
        {loading ? (
          <Skeleton variant="rectangular" className="h-full" />
        ) : error ? (
          <Alert
            variant="tonal"
            color="error"
            title="Failed to load diff"
            message={error}
          />
        ) : (
          <GitDiffView content={content ?? ''} />
        )}
      </div>
    </div>,
    document.body,
  )
}

// ── Git diff viewer (themed, syntax-highlighted, +/− colored) ─────────────────

type DiffLineKind =
  | 'meta' // diff --git, index, mode, rename, binary headers
  | 'file' // --- a/… / +++ b/…
  | 'hunk' // @@ -a,b +c,d @@ heading
  | 'add'
  | 'del'
  | 'context'
  | 'nonewline' // “\ No newline at end of file”

interface DiffLine {
  kind: DiffLineKind
  sign: string
  code: string
  heading?: string
}

const DIFF_META_PREFIXES = [
  'diff --git ',
  'index ',
  'new file mode ',
  'deleted file mode ',
  'old mode ',
  'new mode ',
  'similarity index ',
  'dissimilarity index ',
  'rename from ',
  'rename to ',
  'copy from ',
  'copy to ',
  'Binary files ',
  'GIT binary patch',
]

function parseDiffLines(diff: string): DiffLine[] {
  return diff.split('\n').map((raw) => {
    const line = raw.replace(/\r$/, '')
    const hunk = line.match(/^@@(.*?)@@(.*)$/)
    if (hunk) {
      return {
        kind: 'hunk',
        sign: '',
        code: hunk[1].trim(),
        heading: hunk[2].replace(/^\s+/, ''),
      }
    }
    if (line.startsWith('\\')) return { kind: 'nonewline', sign: '', code: line }
    if (DIFF_META_PREFIXES.some((p) => line.startsWith(p)))
      return { kind: 'meta', sign: '', code: line }
    if (line.startsWith('--- ') || line.startsWith('+++ '))
      return { kind: 'file', sign: line[0], code: line.slice(4) }
    if (line.startsWith('+')) return { kind: 'add', sign: '+', code: line.slice(1) }
    if (line.startsWith('-')) return { kind: 'del', sign: '-', code: line.slice(1) }
    if (line.startsWith(' '))
      return { kind: 'context', sign: ' ', code: line.slice(1) }
    return { kind: 'context', sign: ' ', code: line }
  })
}

/** Maps a repo path to a highlightToHtml-compatible language key. */
function diffLanguageForPath(path: string): string | null {
  const base = path.split('/').pop() ?? ''
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return null
  switch (base.slice(dot + 1).toLowerCase()) {
    case 'ts':
    case 'tsx':
    case 'mts':
    case 'cts':
      return 'typescript'
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript'
    case 'json':
    case 'jsonc':
      return 'json'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'txt':
    case 'text':
      return 'text'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'css':
    case 'scss':
    case 'less':
      return 'css'
    case 'html':
    case 'htm':
    case 'xml':
    case 'svg':
    case 'vue':
      return 'html'
    case 'sh':
    case 'bash':
    case 'zsh':
    case 'shell':
      return 'shell'
    case 'py':
    case 'python':
      return 'python'
    case 'sql':
      return 'sql'
    default:
      return null
  }
}

/** Pulls the changed file path out of the diff headers to pick a language. */
function detectDiffLanguage(diff: string): string | null {
  let path: string | null = null
  for (const raw of diff.split('\n')) {
    const line = raw.replace(/\r$/, '')
    const add = line.match(/^\+\+\+ b\/(.+)$/)
    if (add) {
      path = add[1]
      break
    }
    const del = line.match(/^--- a\/(.+)$/)
    if (del) {
      path = del[1]
      break
    }
    const gitLine = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
    if (gitLine) {
      path = gitLine[2]
      break
    }
  }
  return path ? diffLanguageForPath(path) : null
}

function GitDiffView({ content }: { content: string }) {
  const language = useMemo(() => detectDiffLanguage(content), [content])
  const rows = useMemo(() => parseDiffLines(content), [content])

  return (
    <div className="git-diff-view min-w-max font-mono text-label-sm leading-relaxed text-on-surface">
      {rows.map((row, i) => (
        <div
          key={i}
          className={cn(
            'flex w-max min-w-full items-start whitespace-pre px-4',
            row.kind === 'add' && 'bg-success/10',
            row.kind === 'del' && 'bg-error/10',
            (row.kind === 'hunk' ||
              row.kind === 'meta' ||
              row.kind === 'file') &&
              'bg-primary/[0.05]',
          )}
        >
          <span
            className={cn(
              'w-6 shrink-0 select-none pr-3 text-right',
              row.kind === 'add' && 'text-success',
              row.kind === 'del' && 'text-error',
              row.kind === 'hunk' && 'text-primary',
              row.kind === 'context' && 'text-on-surface-variant/60',
              row.kind === 'nonewline' && 'text-on-surface-variant/50',
              (row.kind === 'meta' || row.kind === 'file') &&
                'text-on-surface-variant/50',
            )}
          >
            {row.sign}
          </span>
          {row.kind === 'hunk' ? (
            <span className="whitespace-pre">
              <span className="text-primary">@@{row.code}@@</span>
              {row.heading && (
                <span className="text-on-surface-variant">{row.heading}</span>
              )}
            </span>
          ) : row.kind === 'add' ||
            row.kind === 'del' ||
            row.kind === 'context' ? (
            <span
              className="whitespace-pre"
              dangerouslySetInnerHTML={{ __html: highlightToHtml(row.code, language) }}
            />
          ) : (
            <span
              className={cn(
                row.kind === 'nonewline' && 'italic',
                row.kind === 'meta' && 'text-on-surface-variant/70',
                (row.kind === 'file' || row.kind === 'meta') &&
                  'font-semibold',
              )}
            >
              {row.code}
            </span>
          )}
        </div>
      ))}
      <style>{`
        .git-diff-view .tok-keyword  { color: rgb(var(--color-primary)); }
        .git-diff-view .tok-string   { color: rgb(var(--color-warning)); }
        .git-diff-view .tok-comment  { color: rgb(var(--color-on-surface-variant)); font-style: italic; }
        .git-diff-view .tok-number   { color: rgb(var(--color-success)); }
        .git-diff-view .tok-function { color: rgb(var(--color-on-surface)); }
        .git-diff-view .tok-type     { color: rgb(var(--color-tertiary)); }
        .git-diff-view .tok-property { color: rgb(var(--color-info)); }
        .git-diff-view .tok-tag      { color: rgb(var(--color-primary)); }
        .git-diff-view .tok-attr     { color: rgb(var(--color-info)); }
        .git-diff-view .tok-punct    { color: rgb(var(--color-outline)); }
      `}</style>
    </div>
  )
}

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
  // Workspace view — the File Manager tree/editor or the Git working-tree panel.
  const [gitView, setGitView] = useState(false)

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
          message="Connect a GitHub personal access token (ghp_…) in the Git tab to enable commits and pushes. The repo (GITHUB_REPO_OWNER / GITHUB_REPO_NAME) is set in the server environment."
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
          {/* Files / Git view toggle */}
          <div className="flex items-center rounded-[var(--radius-input)] bg-surface-container-high p-0.5">
            <button
              type="button"
              onClick={() => setGitView(false)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-[calc(var(--radius-input)-2px)] px-2.5 text-label-sm font-medium transition-colors duration-fast',
                !gitView
                  ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
            >
              <Files className="h-3.5 w-3.5" />
              Files
            </button>
            <button
              type="button"
              onClick={() => setGitView(true)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-[calc(var(--radius-input)-2px)] px-2.5 text-label-sm font-medium transition-colors duration-fast',
                gitView
                  ? 'bg-surface-container-lowest text-on-surface shadow-sm'
                  : 'text-on-surface-variant hover:text-on-surface',
              )}
            >
              <GitBranch className="h-3.5 w-3.5" />
              Git
              {files.gitStatus &&
                files.gitStatus.stagedCount + files.gitStatus.unstagedCount >
                  0 && (
                  <span className="rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                    {files.gitStatus.stagedCount +
                      files.gitStatus.unstagedCount}
                  </span>
                )}
            </button>
          </div>

          <div className="flex min-w-0 items-center gap-1.5">
            {!gitView && (
              <>
                <FolderGit2 className="h-4 w-4 shrink-0 text-on-surface-variant" />
                <button
                  type="button"
                  onClick={() => {
                    setSelectedFolder('')
                    setSelectedPath(null)
                    if (!files.isExpanded('')) files.toggleFolder('')
                  }}
                  className="shrink-0 truncate text-label-md font-semibold text-on-surface hover:text-primary transition-colors duration-fast"
                  title="Go to repository root"
                >
                  Repository
                </button>
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
              </>
            )}

            {/* Current branch badge (Git view) */}
            {gitView && (
              <>
                <GitBranch className="h-4 w-4 shrink-0 text-primary" />
                <span className="truncate text-label-md font-semibold text-on-surface">
                  {files.gitStatus?.branch ?? 'no branch'}
                </span>
                {files.gitStatus?.upstream && (
                  <span className="text-body-xs text-on-surface-variant truncate">
                    {files.gitStatus.upstream}
                    {files.gitStatus.ahead > 0 && ` +${files.gitStatus.ahead}`}
                    {files.gitStatus.behind > 0 &&
                      ` −${files.gitStatus.behind}`}
                  </span>
                )}
              </>
            )}
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 flex-col">
          {gitView ? (
            <GitPanel files={files} configured={configured} />
          ) : (
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
                        variant="primary"
                        size="sm"
                        className="shrink-0"
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
                and committed from the Git tab.
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

// ── Git discard confirm dialog ────────────────────────────────────────────────

function GitDiscardDialog({
  path,
  onConfirm,
  onCancel,
}: {
  path: string | null
  onConfirm: () => void
  onCancel: () => void
}) {
  const open = path !== null

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
              {path ? (
                <>
                  Revert unstaged changes to{' '}
                  <code className="font-mono">{path}</code>? Untracked files
                  are deleted. This cannot be undone.
                </>
              ) : (
                'Discard the unstaged changes? This cannot be undone.'
              )}
            </p>
          </Dialog.Body>
          <Dialog.Footer>
            <Button variant="text" color="neutral" onClick={onCancel}>
              Cancel
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
