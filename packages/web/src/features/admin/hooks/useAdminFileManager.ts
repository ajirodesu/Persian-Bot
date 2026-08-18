/**
 * useAdminFileManager — data fetching + mutations for the Admin local File
 * Manager + Git panel.
 *
 * The File Manager edits a REAL git checkout on the server: reads come from
 * disk, mutations write to the working tree, and nothing is committed until the
 * operator explicitly stages/commits from the Git tab. This hook manages the
 * lazily-expanded folder tree, multiple editor tabs, file mutations, and the
 * git working-tree status/diff/stage/commit/push state.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { adminFileManagerService } from '@/features/admin/services/admin-file-manager.service'
import type {
  GitCommitInfoDto,
  GitStatusDto,
  RepoEntryDto,
  RepoMetaDto,
  RepoMutationResultDto,
  RepoTreeNodeDto,
} from '@/features/admin/services/admin-file-manager.service'

export interface OpenTab {
  entry: RepoEntryDto
  content: string
  savedContent: string
  loading: boolean
  error: string | null
}

export interface UseAdminFileManagerReturn {
  // Repository + tree
  meta: RepoMetaDto | null
  rootEntries: RepoEntryDto[] | undefined
  children: Record<string, RepoEntryDto[]>
  expanded: Set<string>
  loadingPaths: Set<string>
  directoryError: string | null
  isExpanded: (path: string) => boolean
  toggleFolder: (path: string) => void
  refresh: (path: string) => Promise<void>
  // Full-repository index — powers search across every directory
  treeIndex: RepoTreeNodeDto[] | undefined
  treeError: string | null
  refreshTree: () => Promise<void>

  // Open files / editor — `openFileEntry`/`content`/… reflect the ACTIVE tab
  tabs: OpenTab[]
  activePath: string | null
  activateTab: (path: string) => void
  closeTab: (path: string) => void
  openFileEntry: RepoEntryDto | null
  content: string
  savedContent: string
  isDirty: boolean
  fileLoading: boolean
  fileError: string | null
  openFile: (entry: RepoEntryDto) => Promise<boolean>
  forceOpenFile: (entry: RepoEntryDto) => Promise<void>
  setContent: (value: string) => void
  closeFile: () => void

  // Mutations
  pending: Set<string>
  lastMutation: RepoMutationResultDto | null
  saveFile: () => Promise<RepoMutationResultDto>
  createEntry: (
    path: string,
    type: 'file' | 'folder',
    content: string,
  ) => Promise<RepoMutationResultDto>
  renameEntry: (from: string, to: string) => Promise<RepoMutationResultDto>
  deleteEntry: (path: string) => Promise<RepoMutationResultDto>

  // Git working-tree panel
  gitStatus: GitStatusDto | null
  gitError: string | null
  gitLoading: boolean
  refreshGit: () => Promise<void>
  gitDiff: string | null
  gitDiffPath: string | null
  gitDiffStaged: boolean
  gitDiffLoading: boolean
  gitDiffError: string | null
  openDiff: (path: string, staged: boolean) => Promise<void>
  closeDiff: () => void
  stagePaths: (paths: string[]) => Promise<void>
  stageAll: () => Promise<void>
  unstagePaths: (paths: string[]) => Promise<void>
  commitAndPush: (message: string) => Promise<{ sha?: string } | null>
  pushChanges: () => Promise<{ message?: string } | null>
  pullChanges: () => Promise<{ message?: string } | null>
  discardPaths: (paths: string[]) => Promise<void>
  history: GitCommitInfoDto[]
  loadHistory: () => Promise<void>
  branches: string[]
  checkoutBranch: (name: string) => Promise<void>
  createBranch: (name: string) => Promise<void>
}

/** Parent folder path for a repo path ('packages/a.ts' → 'packages'). */
function parentOf(entryPath: string): string {
  const idx = entryPath.lastIndexOf('/')
  return idx === -1 ? '' : entryPath.slice(0, idx)
}

/** localStorage key for the editor's persisted session state. */
const STORAGE_KEY = 'admin-file-manager:state:v1'

interface PersistedState {
  expanded: string[]
  tabs: OpenTab[]
  activePath: string | null
}

/** Reads a persisted session snapshot; returns null when absent/corrupt. */
function readPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    const tabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter((t) => t && typeof t === 'object' && t.entry)
      : []
    return {
      expanded: Array.isArray(parsed.expanded) ? parsed.expanded : [],
      tabs,
      activePath:
        typeof parsed.activePath === 'string' &&
        tabs.some((t) => t.entry.path === parsed.activePath)
          ? parsed.activePath
          : (tabs[0]?.entry.path ?? null),
    }
  } catch {
    return null
  }
}

export function useAdminFileManager(): UseAdminFileManagerReturn {
  // Restore a persisted session on mount so a refreshed tab resumes where it
  // left off (open tabs + content + expanded folders). Lazy initializers avoid
  // setState-in-effect entirely.
  const [initialState] = useState<PersistedState | null>(() => readPersisted())

  const [meta, setMeta] = useState<RepoMetaDto | null>(null)
  const [children, setChildren] = useState<Record<string, RepoEntryDto[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initialState?.expanded ?? []),
  )
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [directoryError, setDirectoryError] = useState<string | null>(null)

  const [treeIndex, setTreeIndex] = useState<RepoTreeNodeDto[] | undefined>(undefined)
  const [treeError, setTreeError] = useState<string | null>(null)

  const [tabs, setTabs] = useState<OpenTab[]>(initialState?.tabs ?? [])
  const [activePath, setActivePath] = useState<string | null>(
    initialState?.activePath ?? null,
  )
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [lastMutation, setLastMutation] = useState<RepoMutationResultDto | null>(null)

  // Git working-tree panel state
  const [gitStatus, setGitStatus] = useState<GitStatusDto | null>(null)
  const [gitError, setGitError] = useState<string | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitDiff, setGitDiff] = useState<string | null>(null)
  const [gitDiffPath, setGitDiffPath] = useState<string | null>(null)
  const [gitDiffStaged, setGitDiffStaged] = useState(false)
  const [gitDiffLoading, setGitDiffLoading] = useState(false)
  const [gitDiffError, setGitDiffError] = useState<string | null>(null)
  const [history, setHistory] = useState<GitCommitInfoDto[]>([])
  const [branches, setBranches] = useState<string[]>([])

  // Stable snapshot of the folders that were expanded in the restored session,
  // used exactly once to re-fetch their children after mount.
  const restoredExpandedRef = useRef<string[]>(initialState?.expanded ?? [])

  // Per-path request counters. Only a newer request for the SAME path may
  // discard an older one — parallel refreshes of different folders must never
  // invalidate each other (that previously left the root stuck on the loader).
  const fetchRef = useRef<Record<string, number>>({})
  // Guards the full-repo tree index reads (search).
  const treeFetchRef = useRef(0)
  // Guards the per-tab content reads so a slow response for an older file can
  // never overwrite a newer one for the same path.
  const readRef = useRef<Record<string, number>>({})

  // The active tab derives from `activePath`; all public editor state is the
  // projection of that single tab so the rest of the page can keep reading
  // `openFileEntry`/`content`/`isDirty` as before.
  const activeTab = useMemo(
    () => tabs.find((t) => t.entry.path === activePath) ?? null,
    [tabs, activePath],
  )
  const openFileEntry = activeTab?.entry ?? null
  const content = activeTab?.content ?? ''
  const savedContent = activeTab?.savedContent ?? ''
  const isDirty = openFileEntry ? content !== savedContent : false
  const fileLoading = activeTab?.loading ?? false
  const fileError = activeTab?.error ?? null

  // Load repository metadata once on mount. When the checkout is not configured
  // the meta request 503s — surface a stub so the page can show the setup hint.
  useEffect(() => {
    let cancelled = false
    adminFileManagerService
      .getMeta()
      .then((data) => {
        if (!cancelled) setMeta(data)
      })
      .catch(() => {
        if (!cancelled) {
          setMeta({ owner: '', repo: '', branch: null, configured: false, root: null })
        }
      })
    return () => {
      cancelled = true
    }
  }, [])

  // ── Tree helpers ────────────────────────────────────────────────────────────

  /** Fetches a folder's listing and caches it; safe to call repeatedly. */
  const refresh = useCallback(async (path: string): Promise<void> => {
    const id = (fetchRef.current[path] ?? 0) + 1
    fetchRef.current[path] = id
    setLoadingPaths((prev) => new Set(prev).add(path))
    setDirectoryError(null)
    try {
      const data = await adminFileManagerService.listFiles(path)
      if (id !== fetchRef.current[path]) return
      setChildren((prev) => ({ ...prev, [path]: data.entries }))
    } catch (err) {
      if (id !== fetchRef.current[path]) return
      // A subfolder that failed to load (e.g. a vanished folder restored from
      // the persisted session) must not take down the whole file manager with
      // a global error banner. Collapse it and drop its cached children so the
      // user can navigate elsewhere; only a repository-root failure is fatal.
      if (path !== '') {
        setExpanded((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
        setChildren((prev) => {
          const next = { ...prev }
          delete next[path]
          return next
        })
        return
      }
      setDirectoryError(
        err instanceof Error ? err.message : 'Failed to load files',
      )
    } finally {
      if (id === fetchRef.current[path]) {
        setLoadingPaths((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
      }
    }
  }, [])

  const isExpanded = useCallback((path: string) => expanded.has(path), [expanded])

  /** Re-fetches the full-repo index used by search (files + folders, any dir). */
  const refreshTree = useCallback(async (): Promise<void> => {
    const id = (treeFetchRef.current += 1)
    setTreeError(null)
    try {
      const data = await adminFileManagerService.getTree()
      if (id !== treeFetchRef.current) return
      setTreeIndex(data.entries)
    } catch (err) {
      if (id !== treeFetchRef.current) return
      setTreeError(err instanceof Error ? err.message : 'Failed to load repository tree')
    }
  }, [])

  const toggleFolder = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(path)) {
          next.delete(path)
        } else {
          next.add(path)
          if (children[path] === undefined) {
            void refresh(path)
          }
        }
        return next
      })
    },
    [children, refresh],
  )

  // Load the repository root + full-repo index once on mount.
  useEffect(() => {
    void refresh('')
    void refreshTree()

    // Re-fetch any folders that were expanded in the persisted session so the
    // restored tree renders with its cached children populated again.
    for (const path of restoredExpandedRef.current) {
      if (path !== '') void refresh(path)
    }
  }, [refresh, refreshTree])

  // Persist the session so a refresh resumes exactly where the user left off.
  const persistRef = useRef<number | null>(null)
  useEffect(() => {
    if (persistRef.current !== null) window.clearTimeout(persistRef.current)
    persistRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ expanded: [...expanded], tabs, activePath } satisfies
            PersistedState),
        )
      } catch {
        // Storage full / private mode — the session just won't persist.
      }
    }, 300)
    return () => {
      if (persistRef.current !== null) window.clearTimeout(persistRef.current)
    }
  }, [expanded, tabs, activePath])

  // ── Open file / editor ──────────────────────────────────────────────────────

  /** Patches the tab for `path` using a functional updater (best-effort). */
  const updateTab = useCallback(
    (path: string, patch: (tab: OpenTab) => OpenTab) => {
      setTabs((prev) =>
        prev.map((t) => (t.entry.path === path ? patch(t) : t)),
      )
    },
    [],
  )

  /**
   * Loads a file's content into its tab. Stale-response guarded per path so a
   * slow response can't clobber a newer read of the same file.
   */
  const loadTab = useCallback(
    async (entry: RepoEntryDto): Promise<void> => {
      const path = entry.path
      const id = (readRef.current[path] ?? 0) + 1
      readRef.current[path] = id
      updateTab(path, (t) => ({ ...t, loading: true, error: null }))
      try {
        const data = await adminFileManagerService.getFileContent(path)
        if (id !== readRef.current[path]) return
        updateTab(path, (t) => ({
          ...t,
          entry: { ...t.entry, size: data.size, language: data.language },
          content: data.content,
          savedContent: data.content,
          loading: false,
          error: null,
        }))
      } catch (err) {
        if (id !== readRef.current[path]) return
        updateTab(path, (t) => ({
          ...t,
          loading: false,
          error: err instanceof Error ? err.message : 'Failed to read file',
        }))
      }
    },
    [updateTab],
  )

  /**
   * Opens a file in a tab (reusing an existing tab when already open) and makes
   * it active. Unlike a single-file editor, opening another file never discards
   * unsaved work in the current tab — each tab keeps its own content.
   */
  const openFile = useCallback(
    async (entry: RepoEntryDto): Promise<boolean> => {
      const existing = tabs.find((t) => t.entry.path === entry.path)
      setActivePath(entry.path)
      if (!existing) {
        setTabs((prev) => [
          ...prev,
          {
            entry,
            content: '',
            savedContent: '',
            loading: true,
            error: null,
          },
        ])
        void loadTab(entry)
      } else if (existing.error) {
        void loadTab(entry)
      }
      return true
    },
    [tabs, loadTab],
  )

  /** Opens a file regardless of its tab state (used after a discard confirm). */
  const forceOpenFile = useCallback(
    async (entry: RepoEntryDto): Promise<void> => {
      await openFile(entry)
    },
    [openFile],
  )

  const activateTab = useCallback((path: string) => {
    setActivePath(path)
  }, [])

  // Latest tab set + active path via refs, so the close logic never depends on
  // a stale closure or nests a setState inside another updater.
  const tabsRef = useRef(tabs)
  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])
  const activePathRef = useRef(activePath)
  useEffect(() => {
    activePathRef.current = activePath
  }, [activePath])

  /** Removes a tab, preferring a neighbour as the new active tab. */
  const closeTab = useCallback((path: string) => {
    const list = tabsRef.current
    const idx = list.findIndex((t) => t.entry.path === path)
    if (idx === -1) return
    const sibling = list[idx + 1] ?? list[idx - 1]
    setTabs((prev) => prev.filter((t) => t.entry.path !== path))
    if (activePathRef.current === path) {
      setActivePath(sibling?.entry.path ?? null)
    }
  }, [])

  const setContent = useCallback(
    (value: string) => {
      if (!activePath) return
      updateTab(activePath, (t) => ({ ...t, content: value, error: null }))
    },
    [activePath, updateTab],
  )

  /** Closes the active tab (the page prompts before dirty tabs). */
  const closeFile = useCallback(() => {
    if (!activePath) return
    closeTab(activePath)
  }, [activePath, closeTab])

  // ── Git working-tree panel ──────────────────────────────────────────────────

  /** Re-reads git status (branch, upstream, changes) from the server. */
  const refreshGit = useCallback(async (): Promise<void> => {
    setGitLoading(true)
    setGitError(null)
    try {
      const status = await adminFileManagerService.getGitStatus()
      setGitStatus(status)
    } catch (err) {
      setGitError(err instanceof Error ? err.message : 'Failed to load git status')
    } finally {
      setGitLoading(false)
    }
  }, [])

  /** Re-reads the recent commit history (best-effort). */
  const loadHistory = useCallback(async (): Promise<void> => {
    try {
      setHistory(await adminFileManagerService.getGitLog(15))
    } catch {
      // History is best-effort — the panel still works without it.
    }
  }, [])

  /** Loads the unified diff for a path into the Git panel. */
  const openDiff = useCallback(
    async (path: string, staged: boolean): Promise<void> => {
      setGitDiffPath(path)
      setGitDiffStaged(staged)
      setGitDiffLoading(true)
      setGitDiffError(null)
      try {
        const data = await adminFileManagerService.getGitDiff(path, staged)
        setGitDiff(data.diff)
      } catch (err) {
        setGitDiffError(
          err instanceof Error ? err.message : 'Failed to load diff',
        )
        setGitDiff(null)
      } finally {
        setGitDiffLoading(false)
      }
    },
    [],
  )

  const closeDiff = useCallback(() => {
    setGitDiff(null)
    setGitDiffPath(null)
  }, [])

  const stagePaths = useCallback(
    async (paths: string[]): Promise<void> => {
      await adminFileManagerService.gitStage(paths)
      await refreshGit()
    },
    [refreshGit],
  )

  const stageAll = useCallback(async (): Promise<void> => {
    await adminFileManagerService.gitStage([])
    await refreshGit()
  }, [refreshGit])

  const unstagePaths = useCallback(
    async (paths: string[]): Promise<void> => {
      await adminFileManagerService.gitUnstage(paths)
      await refreshGit()
    },
    [refreshGit],
  )

  /** Pushes the current branch to its upstream, then refreshes status. */
  const pushChanges = useCallback(
    async (): Promise<{ message?: string } | null> => {
      try {
        const data = await adminFileManagerService.gitPush()
        return data
      } finally {
        // Always re-read status so a failed push leaves the panel in a state
        // where the same action can be retried (e.g. unpushed commits shown).
        await refreshGit()
      }
    },
    [refreshGit],
  )

  /** Pulls the current branch from its upstream, then refreshes status. */
  const pullChanges = useCallback(
    async (): Promise<{ message?: string } | null> => {
      const data = await adminFileManagerService.gitPull()
      await refreshGit()
      await loadHistory()
      return data
    },
    [refreshGit, loadHistory],
  )

  /** Switches to an existing local branch and refreshes state. */
  const checkoutBranch = useCallback(
    async (name: string): Promise<void> => {
      await adminFileManagerService.gitCheckout(name)
      setBranches(
        await adminFileManagerService.getGitBranches().catch(() => []),
      )
      await refreshGit()
    },
    [refreshGit],
  )

  /** Commits the staged changes, then pushes — one-click action. */
  const commitAndPush = useCallback(
    async (message: string): Promise<{ sha?: string } | null> => {
      const data = await adminFileManagerService.gitCommit(message)
      try {
        await adminFileManagerService.gitPush()
      } finally {
        // Even if the push fails after a successful commit, re-read status so
        // the commit is visible and the push can be retried immediately.
        await refreshGit()
      }
      await loadHistory()
      closeDiff()
      return data
    },
    [refreshGit, loadHistory, closeDiff],
  )

  /**
   * Discards working-tree changes for the given paths (unstaged edits are
   * reverted, untracked files are deleted), then refreshes git state.
   */
  const discardPaths = useCallback(
    async (paths: string[]): Promise<void> => {
      await adminFileManagerService.gitDiscard(paths)
      if (gitDiffPath && paths.includes(gitDiffPath)) {
        setGitDiff(null)
        setGitDiffPath(null)
      }
      await refreshGit()
    },
    [refreshGit, gitDiffPath],
  )

  /** Creates a new local branch from HEAD, switches to it, and refreshes. */
  const createBranch = useCallback(
    async (name: string): Promise<void> => {
      await adminFileManagerService.gitCreateBranch(name)
      setBranches(
        await adminFileManagerService.getGitBranches().catch(() => []),
      )
      await refreshGit()
      await loadHistory()
    },
    [refreshGit, loadHistory],
  )

  // Load git status + history + branches once on mount.
  useEffect(() => {
    void refreshGit()
    void loadHistory()
    adminFileManagerService
      .getGitBranches()
      .then(setBranches)
      .catch(() => setBranches([]))
  }, [refreshGit, loadHistory])

  // ── Mutations ───────────────────────────────────────────────────────────────

  const withPending = useCallback(
    async <T,>(path: string, fn: () => Promise<T>): Promise<T> => {
      setPending((prev) => new Set(prev).add(path))
      try {
        return await fn()
      } finally {
        setPending((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
      }
    },
    [],
  )

  const saveFile = useCallback(
    async (): Promise<RepoMutationResultDto> => {
      if (!activePath) return { synced: false }
      const path = activePath
      const activeContent = tabs.find((t) => t.entry.path === path)?.content ?? ''
      return withPending(path, async () => {
        const data = await adminFileManagerService.saveFile(path, activeContent)
        updateTab(path, (t) => ({ ...t, savedContent: activeContent }))
        setLastMutation(data)
        void refresh(parentOf(path))
        void refreshGit()
        return data
      })
    },
    [activePath, tabs, withPending, updateTab, refresh, refreshGit],
  )

  const createEntry = useCallback(
    async (
      path: string,
      type: 'file' | 'folder',
      content: string,
    ): Promise<RepoMutationResultDto> => {
      return withPending(path, async () => {
        const data = await adminFileManagerService.createFileEntry(
          path,
          type,
          content,
        )
        setLastMutation(data)
        void refresh(parentOf(path))
        if (type === 'folder') setExpanded((prev) => new Set(prev).add(path))
        void refreshTree()
        void refreshGit()
        return data
      })
    },
    [withPending, refresh, refreshTree, refreshGit],
  )

  const renameEntry = useCallback(
    async (from: string, to: string): Promise<RepoMutationResultDto> => {
      return withPending(from, async () => {
        const data = await adminFileManagerService.renameFileEntry(from, to)
        setLastMutation(data)
        // Update the cached tree in place, then refresh both parents.
        setChildren((prev) => {
          const next = { ...prev }
          const fromParent = parentOf(from)
          const fromParentEntries = next[fromParent]
          if (fromParentEntries) {
            const moved = fromParentEntries.find((e) => e.path === from)
            next[fromParent] = fromParentEntries.filter((e) => e.path !== from)
            if (moved) {
              const newEntry: RepoEntryDto = {
                ...moved,
                path: to,
                name: to.split('/').pop() ?? to,
              }
              const toParent = parentOf(to)
              next[toParent] = [...(next[toParent] ?? []), newEntry]
            }
          }
          return next
        })
        void refresh(parentOf(from))
        if (parentOf(to) !== parentOf(from)) void refresh(parentOf(to))
        // Keep any open tabs pointed at the renamed file.
        setTabs((prev) =>
          prev.map((t) =>
            t.entry.path === from
              ? { ...t, entry: { ...t.entry, path: to, name: to.split('/').pop() ?? to } }
              : t,
          ),
        )
        setActivePath((prev) => (prev === from ? to : prev))
        void refreshTree()
        void refreshGit()
        return data
      })
    },
    [withPending, refresh, refreshTree, refreshGit],
  )

  const deleteEntry = useCallback(
    async (path: string): Promise<RepoMutationResultDto> => {
      return withPending(path, async () => {
        const data = await adminFileManagerService.deleteFileEntry(path)
        setLastMutation(data)
        const parent = parentOf(path)
        setChildren((prev) => {
          const next = { ...prev }
          const entries = next[parent]
          if (entries) next[parent] = entries.filter((e) => e.path !== path)
          return next
        })
        void refresh(parent)
        closeTab(path)
        void refreshTree()
        void refreshGit()
        return data
      })
    },
    [withPending, refresh, closeTab, refreshTree, refreshGit],
  )

  return {
    meta,
    rootEntries: children[''],
    children,
    expanded,
    loadingPaths,
    directoryError,
    isExpanded,
    toggleFolder,
    refresh,
    treeIndex,
    treeError,
    refreshTree,
    tabs,
    activePath,
    activateTab,
    closeTab,
    openFileEntry,
    content,
    savedContent,
    isDirty,
    fileLoading,
    fileError,
    openFile,
    forceOpenFile,
    setContent,
    closeFile,
    pending,
    lastMutation,
    saveFile,
    createEntry,
    renameEntry,
    deleteEntry,
    gitStatus,
    gitError,
    gitLoading,
    refreshGit,
    gitDiff,
    gitDiffPath,
    gitDiffStaged,
    gitDiffLoading,
    gitDiffError,
    openDiff,
    closeDiff,
    stagePaths,
    stageAll,
    unstagePaths,
    commitAndPush,
    pushChanges,
    pullChanges,
    discardPaths,
    history,
    loadHistory,
    branches,
    checkoutBranch,
    createBranch,
  }
}