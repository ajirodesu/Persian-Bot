/**
 * useAdminFileManager — data fetching + mutations for the Admin GitHub File
 * Manager panel.
 *
 * Manages a lazily-expanded folder tree (folder path → cached child entries)
 * rooted at the repository root, the currently open file's content (with dirty
 * tracking), and every mutation (create / save / rename / delete). Because the
 * panel is GitHub-native, each mutation returns a commit SHA and refreshes the
 * affected folder caches so the tree reflects the repo's real state.
 */

import { useState, useCallback, useEffect, useRef } from 'react'
import { adminFileManagerService } from '@/features/admin/services/admin-file-manager.service'
import type {
  RepoEntryDto,
  RepoMetaDto,
  RepoMutationResultDto,
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

  // Open file / editor
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
  openFileEntry: RepoEntryDto | null
  content: string
  savedContent: string
}

/** Reads a persisted session snapshot; returns null when absent/corrupt. */
function readPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<PersistedState>
    return {
      expanded: Array.isArray(parsed.expanded) ? parsed.expanded : [],
      openFileEntry:
        typeof parsed.openFileEntry === 'object' && parsed.openFileEntry !== null
          ? (parsed.openFileEntry as RepoEntryDto)
          : null,
      content: typeof parsed.content === 'string' ? parsed.content : '',
      savedContent: typeof parsed.savedContent === 'string' ? parsed.savedContent : '',
    }
  } catch {
    return null
  }
}

export function useAdminFileManager(): UseAdminFileManagerReturn {
  // Restore a persisted session on mount so a refreshed tab resumes where it
  // left off (open file + content + expanded folders). Lazy initializers avoid
  // setState-in-effect entirely.
  const [initialState] = useState<PersistedState | null>(() => readPersisted())

  const [meta, setMeta] = useState<RepoMetaDto | null>(null)
  const [children, setChildren] = useState<Record<string, RepoEntryDto[]>>({})
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(initialState?.expanded ?? []),
  )
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set())
  const [directoryError, setDirectoryError] = useState<string | null>(null)

  const [openFileEntry, setOpenFileEntry] = useState<RepoEntryDto | null>(
    initialState?.openFileEntry ?? null,
  )
  const [content, setContentRaw] = useState(initialState?.content ?? '')
  const [savedContent, setSavedContent] = useState(initialState?.savedContent ?? '')
  const [fileLoading, setFileLoading] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)

  const [pending, setPending] = useState<Set<string>>(new Set())
  const [lastMutation, setLastMutation] = useState<RepoMutationResultDto | null>(null)

  // Stable snapshot of the folders that were expanded in the restored session,
  // used exactly once to re-fetch their children after mount.
  const restoredExpandedRef = useRef<string[]>(initialState?.expanded ?? [])

  // Per-path request counters. Only a newer request for the SAME path may
  // discard an older one — parallel refreshes of different folders must never
  // invalidate each other (that previously left the root stuck on the loader).
  const fetchRef = useRef<Record<string, number>>({})
  // Tracks the path the editor is currently pointed at, so a slow read for an
  // older file can never overwrite the content of a newer one (same stale
  // response-discard pattern as useBotDatabase / the old useBotFiles).
  const openRef = useRef<string | null>(null)

  const isDirty = Boolean(openFileEntry) && content !== savedContent

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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- async data-fetching; setState is deferred to microtasks in refresh
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
          JSON.stringify({
            expanded: [...expanded],
            openFileEntry,
            content,
            savedContent,
          } satisfies PersistedState),
        )
      } catch {
        // Storage full / private mode — the session just won't persist.
      }
    }, 300)
    return () => {
      if (persistRef.current !== null) window.clearTimeout(persistRef.current)
    }
  }, [expanded, openFileEntry, content, savedContent])

  // ── Open file / editor ──────────────────────────────────────────────────────

  const loadFile = useCallback(async (entry: RepoEntryDto): Promise<void> => {
    const path = entry.path
    openRef.current = path
    setFileLoading(true)
    setFileError(null)
    try {
      const data = await adminFileManagerService.getFileContent(path)
      if (openRef.current !== path) return
      setOpenFileEntry((prev) =>
        prev && prev.path === path
          ? { ...prev, size: data.size, language: data.language }
          : prev,
      )
      setContentRaw(data.content)
      setSavedContent(data.content)
    } catch (err) {
      if (openRef.current !== path) return
      setFileError(err instanceof Error ? err.message : 'Failed to read file')
    } finally {
      if (openRef.current === path) setFileLoading(false)
    }
  }, [])

  /**
   * Opens a file for editing. Returns false (without switching) when another
   * file has unsaved changes so the caller can confirm before discarding.
   */
  const openFile = useCallback(
    async (entry: RepoEntryDto): Promise<boolean> => {
      if (isDirty) return false
      setOpenFileEntry(entry)
      void loadFile(entry)
      return true
    },
    [isDirty, loadFile],
  )

  /** Opens a file regardless of dirty state (used after a discard confirm). */
  const forceOpenFile = useCallback(
    async (entry: RepoEntryDto): Promise<void> => {
      setOpenFileEntry(entry)
      await loadFile(entry)
    },
    [loadFile],
  )

  const setContent = useCallback((value: string) => {
    setContentRaw(value)
  }, [])

  const closeFile = useCallback(() => {
    openRef.current = null
    setOpenFileEntry(null)
    setContentRaw('')
    setSavedContent('')
    setFileError(null)
  }, [])

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
      if (!openFileEntry) return { synced: false }
      const path = openFileEntry.path
      return withPending(path, async () => {
        const data = await adminFileManagerService.saveFile(path, content, message)
        setSavedContent(content)
        setLastMutation(data)
        void refresh(parentOf(path))
        return data
      })
    },
    [openFileEntry, content, withPending, refresh],
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
        // Keep the editor pointed at the renamed file.
        setOpenFileEntry((prev) => {
          if (!prev || prev.path !== from) return prev
          return { ...prev, path: to, name: to.split('/').pop() ?? to }
        })
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
        if (openFileEntry?.path === path) closeFile()
        return data
      })
    },
    [withPending, refresh, openFileEntry?.path, closeFile],
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
