/**
 * useAdminFileManager — data fetching + mutations for the Admin local File
 * Manager + Git panel.
 *
 * The File Manager edits a REAL git checkout on the server: reads come from
 * disk, mutations write to the working tree, and nothing is committed until the
 * operator explicitly stages/commits from the Git page. This hook manages the
 * lazily-expanded folder tree, file mutations, and the git working-tree
 * status/diff/stage/commit/push state.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { adminFileManagerService } from '@/features/admin/services/admin-file-manager.service'
import type {
  GitCommitInfoDto,
  GitStatusDto,
  GitHubIdentityDto,
  RepoEntryDto,
  RepoMetaDto,
  RepoMutationResultDto,
  RepoTreeNodeDto,
} from '@/features/admin/services/admin-file-manager.service'

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
  // Full-repository index — powers search across every directory.
  // Loaded lazily on first search interaction (not on mount) so the
  // browser view paints after two requests instead of three plus a walk.
  treeIndex: RepoTreeNodeDto[] | undefined
  treeError: string | null
  treeLoading: boolean
  refreshTree: () => Promise<void>

  // Mutations
  pending: Set<string>
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

  // GitHub identity (deployment's single stored token)
  githubToken: string
  githubIdentity: GitHubIdentityDto | null
  githubIdentityLoading: boolean
  githubIdentityError: string | null
  setGithubToken: (token: string) => void
  verifyGithubIdentity: (token: string) => Promise<GitHubIdentityDto | null>
  disconnectGithub: () => Promise<void>
}

/** Parent folder path for a repo path ('packages/a.ts' → 'packages'). */
function parentOf(entryPath: string): string {
  const idx = entryPath.lastIndexOf('/')
  return idx === -1 ? '' : entryPath.slice(0, idx)
}

/** localStorage key for the browser's persisted session state. */
const STORAGE_KEY = 'admin-file-manager:state:v1'

interface PersistedState {
  expanded: string[]
}

/** Reads a persisted session snapshot; returns null when absent/corrupt. */
function readPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      expanded: Array.isArray(parsed.expanded) ? parsed.expanded : [],
    }
  } catch {
    return null
  }
}

export function useAdminFileManager(): UseAdminFileManagerReturn {
  // Restore expanded folders on mount so a refresh resumes the same tree.
  // Lazy initializers avoid setState-in-effect entirely.
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
  const [treeLoading, setTreeLoading] = useState(false)
  // Mirror for mutation paths — refreshes the search index after a
  // create/rename/delete only when it was actually loaded.
  const treeIndexRef = useRef<RepoTreeNodeDto[] | undefined>(undefined)
  useEffect(() => {
    treeIndexRef.current = treeIndex
  }, [treeIndex])

  const [pending, setPending] = useState<Set<string>>(new Set())

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

  // GitHub identity — the deployment's SINGLE global token lives on the server
  // (set via the Git page, encrypted in the DB); the client only holds the token
  // in the input field while connecting and never persists it. The identity is
  // restored from the server on mount so a refresh resumes as connected.
  const [githubToken, setGithubTokenState] = useState<string>('')
  const [githubIdentity, setGithubIdentity] = useState<GitHubIdentityDto | null>(
    null,
  )
  const [githubIdentityLoading, setGithubIdentityLoading] = useState(false)
  const [githubIdentityError, setGithubIdentityError] = useState<string | null>(
    null,
  )

  // Stable snapshot of the folders that were expanded in the restored session,
  // used exactly once to re-fetch their children after mount.
  const restoredExpandedRef = useRef<string[]>(initialState?.expanded ?? [])

  // Per-path request counters. Only a newer request for the SAME path may
  // discard an older one — parallel refreshes of different folders must never
  // invalidate each other (that previously left the root stuck on the loader).
  const fetchRef = useRef<Record<string, number>>({})
  // Guards the full-repo tree index reads (search).
  const treeFetchRef = useRef(0)

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

  /** Re-fetches the full-repo index used by search (files + folders, any dir). */
  const refreshTree = useCallback(async (): Promise<void> => {
    const id = (treeFetchRef.current += 1)
    setTreeError(null)
    setTreeLoading(true)
    try {
      const data = await adminFileManagerService.getTree()
      if (id !== treeFetchRef.current) return
      setTreeIndex(data.entries)
    } catch (err) {
      if (id !== treeFetchRef.current) return
      setTreeError(err instanceof Error ? err.message : 'Failed to load repository tree')
    } finally {
      if (id === treeFetchRef.current) setTreeLoading(false)
    }
  }, [])

  // Ref mirrors so folder toggling never depends on (or invalidates) the
  // cached children identity — memoized tree rows stay memoized.
  const childrenRef = useRef(children)
  useEffect(() => {
    childrenRef.current = children
  }, [children])
  const expandedRef = useRef(expanded)
  useEffect(() => {
    expandedRef.current = expanded
  }, [expanded])

  // Reads LIVE state (not the ref mirror): open/close must paint on the
  // same render as the toggle, otherwise rows lag one tap behind and the
  // wrong folder appears to open/close.
  const isExpanded = useCallback(
    (path: string) => expanded.has(path),
    [expanded],
  )

  const toggleFolder = useCallback(
    (path: string) => {
      if (expandedRef.current.has(path)) {
        setExpanded((prev) => {
          const next = new Set(prev)
          next.delete(path)
          return next
        })
        return
      }
      setExpanded((prev) => new Set(prev).add(path))
      if (childrenRef.current[path] === undefined) {
        void refresh(path)
      }
    },
    [refresh],
  )

  // Load the repository root once on mount. The full-repo search index
  // resolves lazily on first search interaction so first paint never waits
  // for the walk.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-fetching: setState is deferred to await continuations
    void refresh('')

    // Re-fetch any folders that were expanded in the persisted session so the
    // restored tree renders with its cached children populated again.
    for (const path of restoredExpandedRef.current) {
      if (path !== '') void refresh(path)
    }
  }, [refresh, refreshTree])

  // Persist the expanded folders so a refresh resumes the same tree.
  const persistRef = useRef<number | null>(null)
  useEffect(() => {
    if (persistRef.current !== null) window.clearTimeout(persistRef.current)
    persistRef.current = window.setTimeout(() => {
      try {
        localStorage.setItem(
          STORAGE_KEY,
          JSON.stringify({ expanded: [...expanded] } satisfies PersistedState),
        )
      } catch {
        // Storage full / private mode — the session just won't persist.
      }
    }, 300)
    return () => {
      if (persistRef.current !== null) window.clearTimeout(persistRef.current)
    }
  }, [expanded])

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

  // ── GitHub identity (deployment's single stored token) ──────────────────────

  /**
   * Holds the token currently typed into the connect input. A blank value
   * clears the local identity state. The token is never persisted client-side —
   * the server stores it (encrypted) once verified.
   */
  const setGithubToken = useCallback((token: string): void => {
    const trimmed = token.trim()
    setGithubTokenState(trimmed)
    if (trimmed === '') {
      setGithubIdentity(null)
      setGithubIdentityError(null)
    }
  }, [])

  /**
   * Verifies the token against GitHub and — on success — stores it on the
   * server as the single global deployment token. Connects the whole bot:
   * /push, /installer, /update and this Git page all use it
   * from now on.
   */
  const verifyGithubIdentity = useCallback(
    async (token: string): Promise<GitHubIdentityDto | null> => {
      const trimmed = token.trim()
      if (!trimmed) {
        setGithubIdentity(null)
        setGithubIdentityError('Enter your GitHub personal access token to connect.')
        return null
      }
      setGithubIdentityLoading(true)
      setGithubIdentityError(null)
      try {
        const identity = await adminFileManagerService.gitIdentity(trimmed)
        setGithubIdentity(identity)
        setGithubTokenState(trimmed)
        return identity
      } catch (err) {
        setGithubIdentity(null)
        setGithubIdentityError(
          err instanceof Error ? err.message : 'Failed to verify GitHub API key',
        )
        return null
      } finally {
        setGithubIdentityLoading(false)
      }
    },
    [],
  )

  /** Disconnects the global token on the server and clears local state. */
  const disconnectGithub = useCallback(async (): Promise<void> => {
    setGithubIdentityLoading(true)
    setGithubIdentityError(null)
    try {
      await adminFileManagerService.clearGitConfig()
    } catch {
      // Best-effort — the local state clears even if the server call failed.
    } finally {
      setGithubIdentityLoading(false)
    }
    setGithubTokenState('')
    setGithubIdentity(null)
  }, [])

  // Load git status once on mount. History, branches and the GitHub
  // identity have no consumer on pages using this hook (the Git page talks
  // to the service directly), so they stay unloaded until explicitly asked.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-fetching: setState is deferred to await continuations
    void refreshGit()
  }, [refreshGit])

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
        void refresh(parentOf(path))
        if (type === 'folder') setExpanded((prev) => new Set(prev).add(path))
        // Keep the search index fresh only when it was actually loaded —
        // otherwise a mutation would pay for a full walk nobody asked for.
        if (treeIndexRef.current !== undefined) void refreshTree()
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
        // Keep the search index fresh only when it was actually loaded —
        // otherwise a mutation would pay for a full walk nobody asked for.
        if (treeIndexRef.current !== undefined) void refreshTree()
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
        const parent = parentOf(path)
        setChildren((prev) => {
          const next = { ...prev }
          const entries = next[parent]
          if (entries) next[parent] = entries.filter((e) => e.path !== path)
          return next
        })
        void refresh(parent)
        // Keep the search index fresh only when it was actually loaded —
        // otherwise a mutation would pay for a full walk nobody asked for.
        if (treeIndexRef.current !== undefined) void refreshTree()
        void refreshGit()
        return data
      })
    },
    [withPending, refresh, refreshTree, refreshGit],
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
    treeLoading,
    refreshTree,
    pending,
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
    githubToken,
    githubIdentity,
    githubIdentityLoading,
    githubIdentityError,
    setGithubToken,
    verifyGithubIdentity,
    disconnectGithub,
  }
}