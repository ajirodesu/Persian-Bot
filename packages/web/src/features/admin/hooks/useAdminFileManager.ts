/**
 * useAdminFileManager — data fetching + mutations for the Admin GitHub File
 * Manager panel.
 *
 * Manages a lazily-expanded folder tree (folder path → cached child entries)
 * rooted at the repository root, multiple open editor tabs (each with its own
 * content + dirty tracking), and every mutation (create / save / rename /
 * delete). Because the panel is GitHub-native, each mutation returns a commit
 * SHA and refreshes the affected folder caches so the tree reflects the repo's
 * real state.
 */

import { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import { adminFileManagerService } from '@/features/admin/services/admin-file-manager.service'
import type {
  RepoEntryDto,
  RepoMetaDto,
  RepoMutationResultDto,
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
  saveFile: (message: string) => Promise<RepoMutationResultDto>
  createEntry: (
    path: string,
    type: 'file' | 'folder',
    content: string,
    message?: string,
  ) => Promise<RepoMutationResultDto>
  renameEntry: (from: string, to: string, message?: string) => Promise<RepoMutationResultDto>
  deleteEntry: (path: string, message?: string) => Promise<RepoMutationResultDto>
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

  const [tabs, setTabs] = useState<OpenTab[]>(initialState?.tabs ?? [])
  const [activePath, setActivePath] = useState<string | null>(
    initialState?.activePath ?? null,
  )
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [lastMutation, setLastMutation] = useState<RepoMutationResultDto | null>(null)

  // Stable snapshot of the folders that were expanded in the restored session,
  // used exactly once to re-fetch their children after mount.
  const restoredExpandedRef = useRef<string[]>(initialState?.expanded ?? [])

  // Per-path request counters. Only a newer request for the SAME path may
  // discard an older one — parallel refreshes of different folders must never
  // invalidate each other (that previously left the root stuck on the loader).
  const fetchRef = useRef<Record<string, number>>({})
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

  // Load repository metadata once on mount.
  useEffect(() => {
    let cancelled = false
    adminFileManagerService
      .getMeta()
      .then((data) => {
        if (!cancelled) setMeta(data)
      })
      .catch(() => {
        if (!cancelled) setMeta(null)
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

  // Load the repository root once on mount.
  useEffect(() => {
    void refresh('')

    // Re-fetch any folders that were expanded in the persisted session so the
    // restored tree renders with its cached children populated again.
    for (const path of restoredExpandedRef.current) {
      if (path !== '') void refresh(path)
    }
  }, [refresh])

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
    async (message: string): Promise<RepoMutationResultDto> => {
      if (!activePath) return { synced: false }
      const path = activePath
      const activeContent = tabs.find((t) => t.entry.path === path)?.content ?? ''
      return withPending(path, async () => {
        const data = await adminFileManagerService.saveFile(path, activeContent, message)
        updateTab(path, (t) => ({ ...t, savedContent: activeContent }))
        setLastMutation(data)
        void refresh(parentOf(path))
        return data
      })
    },
    [activePath, tabs, withPending, updateTab, refresh],
  )

  const createEntry = useCallback(
    async (
      path: string,
      type: 'file' | 'folder',
      content: string,
      message?: string,
    ): Promise<RepoMutationResultDto> => {
      return withPending(path, async () => {
        const data = await adminFileManagerService.createFileEntry(
          path,
          type,
          content,
          message,
        )
        setLastMutation(data)
        void refresh(parentOf(path))
        if (type === 'folder') setExpanded((prev) => new Set(prev).add(path))
        return data
      })
    },
    [withPending, refresh],
  )

  const renameEntry = useCallback(
    async (from: string, to: string, message?: string): Promise<RepoMutationResultDto> => {
      return withPending(from, async () => {
        const data = await adminFileManagerService.renameFileEntry(from, to, message)
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
        return data
      })
    },
    [withPending, refresh],
  )

  const deleteEntry = useCallback(
    async (path: string, message?: string): Promise<RepoMutationResultDto> => {
      return withPending(path, async () => {
        const data = await adminFileManagerService.deleteFileEntry(path, message)
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
        return data
      })
    },
    [withPending, refresh, closeTab],
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
  }
}