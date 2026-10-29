import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Helmet } from '@dr.pogodin/react-helmet'
import {
  Navigate,
  useBlocker,
  useNavigate,
  useSearchParams,
} from 'react-router-dom'
import { Check, ChevronLeft, Loader2, RefreshCw } from 'lucide-react'
import IconButton from '@/components/ui/buttons/IconButton'
import Button from '@/components/ui/buttons/Button'
import Dialog from '@/components/ui/overlay/Dialog'
import Skeleton from '@/components/ui/feedback/Skeleton'
import CodeEditor, {
  CODE_HIGHLIGHT_MAX_CHARS,
} from '@/components/editor/CodeEditor'
import { getFileLanguage } from '@/components/icons/FileTypeIcons'
import { ApiError } from '@/lib/api-client.lib'
import { adminFileManagerService } from '@/features/admin/services/admin-file-manager.service'
import { useAdminFileManager } from '@/features/admin/hooks/useAdminFileManager'
import { useAdminHeader } from '@/contexts/AdminHeaderContext'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { ROUTES } from '@/constants/routes.constants'
import { H_ICON_BTN_MOBILE } from '@/constants/header.constants'
import { cn } from '@/utils/cn.util'

function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

/**
 * AdminFileEditorPage — /admin/dashboard/files/edit?path=xxx
 *
 * Entered ONLY from the Files page (file tap, search result, just-created
 * file). Uses the dashboard's single content header via AdminHeaderContext:
 * back chevron (left), filename title, save check (right). Direct access
 * without a file — or a file that fails to load — redirects to Files.
 */
export default function AdminFileEditorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const path = searchParams.get('path') ?? ''
  const { error: notifyError } = useSnackbar()
  const { setOverride } = useAdminHeader()
  const { refresh, refreshGit } = useAdminFileManager()

  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [savedSha, setSavedSha] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadToken, setReloadToken] = useState(0)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [conflictOpen, setConflictOpen] = useState(false)
  const [navAllowed, setNavAllowed] = useState(false)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const savedTimer = useRef<number | null>(null)
  // Latest committed path for async completions, plus a synchronous save lock
  // (state updates are not visible to a second Ctrl+S in the same tick). The
  // lock stores the path it belongs to so a finishing save for the previous
  // file cannot unlock a save already running for the new one.
  const pathRef = useRef(path)
  const saveLock = useRef<string | null>(null)
  // Latest-render path for async completions. Writing a ref during render is
  // intentional here: route changes must invalidate in-flight loads before
  // any microtask can deliver their result.
  // eslint-disable-next-line react-hooks/refs -- latest-value ref for async guards
  pathRef.current = path

  // Reset per-file state when the route path changes while mounted
  // (render-phase adjustment — same pattern as DashboardLayout's
  // openBotId reset — so the load effect below stays fetch-only).
  const [prevPath, setPrevPath] = useState(path)
  if (path !== prevPath) {
    setPrevPath(path)
    setContent('')
    setSavedContent('')
    setSavedSha('')
    setLoading(true)
    setLoadError(null)
    setSavedFlash(false)
    setConfirmOpen(false)
    setConflictOpen(false)
    setNavAllowed(false)
    setRefreshing(false)
    setSaving(false)
  }

  const isDirty = content !== savedContent
  const fileName = basename(path)
  const language = getFileLanguage(fileName)
  const directory = path.includes('/')
    ? path.slice(0, path.lastIndexOf('/'))
    : ''
  const languageLabel =
    content.length > CODE_HIGHLIGHT_MAX_CHARS
      ? 'PLAIN TEXT'
      : (language ?? 'TEXT').toUpperCase()

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current)
    },
    [],
  )

  // A save belonging to the previous path must not block saves on the new one.
  useEffect(() => {
    saveLock.current = null
  }, [path])

  // Load the real file. Abort on path change/unmount and ignore a stale
  // response even if the transport could not be cancelled.
  useEffect(() => {
    if (path === '') return
    const controller = new AbortController()
    let cancelled = false
    adminFileManagerService
      .getFileContent(path, { signal: controller.signal })
      .then((data) => {
        if (cancelled || pathRef.current !== path) return
        setContent(data.content)
        setSavedContent(data.content)
        setSavedSha(data.sha)
      })
      .catch((err: unknown) => {
        if (cancelled || isAbortError(err) || pathRef.current !== path) return
        setLoadError(err instanceof Error ? err.message : 'Failed to read file')
      })
      .finally(() => {
        if (!cancelled && pathRef.current === path) setLoading(false)
      })
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [path, reloadToken])

  async function handleSave(force = false): Promise<boolean> {
    const target = path
    const snapshot = content
    if (!isDirty || saveLock.current || target === '') return false

    // Synchronous lock: two Ctrl+S presses before the next render must not
    // issue two writes. The snapshot is what this request actually saved.
    saveLock.current = target
    setSaving(true)
    try {
      const result = await adminFileManagerService.saveFile(target, snapshot, {
        ...(force || savedSha === '' ? {} : { expectedSha: savedSha }),
      })
      if (pathRef.current === target) {
        setSavedContent(snapshot)
        setSavedSha(result.sha ?? '')
        // Seed the read cache so reopening the file (or back/forward) does
        // not pay a second read, and clear the stale listing.
        adminFileManagerService.rememberFileContent(
          target,
          snapshot,
          language,
          result.sha ?? '',
        )
        // Refresh the browser listing + git markers behind the editor.
        void refresh(parentOf(target))
        void refreshGit()
        // Success is shown in-button (brief check flash) — no toast.
        setSavedFlash(true)
        if (savedTimer.current !== null) window.clearTimeout(savedTimer.current)
        savedTimer.current = window.setTimeout(() => setSavedFlash(false), 1400)
      }
      return true
    } catch (err) {
      // Changes are kept (dirty only clears on success).
      if (err instanceof ApiError && err.status === 409) {
        setConflictOpen(true)
        return false
      }
      notifyError(err instanceof Error ? err.message : 'Failed to save file')
      return false
    } finally {
      if (saveLock.current === target) saveLock.current = null
      if (pathRef.current === target) setSaving(false)
    }
  }

  function goBack() {
    navigate(ROUTES.ADMIN.FILES)
  }

  function handleBack() {
    if (isDirty) {
      setConfirmOpen(true)
      return
    }
    goBack()
  }

  // Latest actions for the header override below. Mirrored in an effect
  // (not during render) so the override effect stays dependency-clean.
  const actionsRef = useRef({ handleSave, handleBack })
  useEffect(() => {
    actionsRef.current = { handleSave, handleBack }
  })

  // Stable callback for CodeEditor's memo boundary: cursor-only renders must
  // not invalidate the editor's props.
  const saveAction = useCallback(() => {
    void actionsRef.current.handleSave()
  }, [])

  // Header override — the page's ONLY header is the dashboard header.
  // Set when identity/state changes, cleared on unmount so other pages are
  // unaffected.
  const saveDisabled =
    !isDirty || saving || loading || loadError !== null || refreshing
  useEffect(() => {
    setOverride({
      left: (
        <IconButton
          variant="text"
          size="md"
          icon={<ChevronLeft className="h-5 w-5" />}
          aria-label="Back to files"
          title="Back to files"
          className={H_ICON_BTN_MOBILE}
          onClick={() => actionsRef.current.handleBack()}
        />
      ),
      title: (
        <span className="flex min-w-0 items-baseline gap-2" title={path}>
          <span className="truncate">{fileName || 'Code Editor'}</span>
          {directory && (
            <span className="hidden min-w-0 truncate font-mono text-[10px] normal-case tracking-[0.06em] text-on-surface-variant/70 md:inline">
              {directory}
            </span>
          )}
        </span>
      ),
      right: (
        <div className="flex items-center gap-2">
          <span className="inline-flex shrink-0 border border-hairline bg-surface-container-low px-2 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-on-surface-variant">
            {saving ? 'SAVING' : isDirty ? 'MODIFIED' : languageLabel}
          </span>
          <IconButton
            variant="text"
            size="md"
            icon={
              saving ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : savedFlash ? (
                <Check className="h-5 w-5 text-success" />
              ) : (
                <Check
                  className={cn(
                    'h-5 w-5',
                    isDirty ? 'text-primary' : 'text-on-surface-variant/80',
                  )}
                />
              )
            }
            aria-label={saving ? 'Saving…' : savedFlash ? 'Saved' : 'Save file'}
            title={
              saving
                ? 'Saving…'
                : savedFlash
                  ? 'Saved'
                  : isDirty
                    ? 'Save changes (Ctrl+S)'
                    : 'No changes to save'
            }
            disabled={saveDisabled && !savedFlash}
            isLoading={saving}
            className={H_ICON_BTN_MOBILE}
            onClick={() => void actionsRef.current.handleSave()}
          />
        </div>
      ),
    })
    return () => setOverride(null)
  }, [
    setOverride,
    fileName,
    path,
    directory,
    languageLabel,
    isDirty,
    saving,
    savedFlash,
    saveDisabled,
    loading,
    loadError,
    refreshing,
  ])

  // Block in-app back/forward navigation while dirty — the confirm dialog
  // offers Save (then proceed), Discard (proceed), Cancel (stay).
  const blocker = useBlocker(
    isDirty && !navAllowed && path !== '' && !loadError,
  )
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- router blocker callback surfaces as state; opening the confirm is its handler
    if (blocker.state === 'blocked') setConfirmOpen(true)
  }, [blocker.state])

  // Block tab close / reload while dirty (browser-level, no custom UI).
  useEffect(() => {
    if (!isDirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      // Legacy browsers require a truthy returnValue to show the prompt.
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])

  async function handleConfirmSave() {
    const ok = await handleSave()
    if (!ok) return
    setNavAllowed(true)
    setConfirmOpen(false)
    if (blocker.state === 'blocked') {
      blocker.proceed()
    } else {
      // Deferred a tick so the blocker stands down (state commit + its
      // internal effect) before this manual navigation is attempted.
      setTimeout(goBack, 0)
    }
  }

  function handleConfirmDiscard() {
    setNavAllowed(true)
    setConfirmOpen(false)
    if (blocker.state === 'blocked') {
      blocker.proceed()
    } else {
      setTimeout(goBack, 0)
    }
  }

  function handleConfirmCancel() {
    setConfirmOpen(false)
    if (blocker.state === 'blocked') blocker.reset()
  }

  /** Explicitly discard local edits and take the disk version after a conflict. */
  async function handleReloadConflict() {
    const target = path
    setConflictOpen(false)
    try {
      const data = await adminFileManagerService.getFileContent(target, {
        force: true,
      })
      if (pathRef.current !== target) return
      setContent(data.content)
      setSavedContent(data.content)
      setSavedSha(data.sha)
      notifyError('Reloaded the version currently on disk.')
    } catch (err) {
      notifyError(
        err instanceof Error ? err.message : 'Failed to reload the file',
      )
    }
  }

  /** Explicitly overwrite the disk version (the user chose their own edits). */
  function handleOverwriteConflict() {
    setConflictOpen(false)
    void handleSave(true)
  }

  function handleRefresh() {
    const target = path
    if (isDirty || saving || refreshing || target === '') return
    setRefreshing(true)
    adminFileManagerService
      .getFileContent(target, { force: true })
      .then((data) => {
        if (pathRef.current !== target) return
        setContent(data.content)
        setSavedContent(data.content)
        setSavedSha(data.sha)
      })
      .catch((err: unknown) => {
        if (isAbortError(err) || pathRef.current !== target) return
        notifyError(
          err instanceof Error ? err.message : 'Failed to reload file',
        )
      })
      .finally(() => {
        if (pathRef.current === target) setRefreshing(false)
      })
  }

  // The editor's own threshold: above this it switches to plain text instead
  // of tokenising the whole document per keystroke. Checking `length` only
  // avoids splitting the file into a line array on every render.
  const isLargeFile = useMemo(
    () => content.length > CODE_HIGHLIGHT_MAX_CHARS,
    [content],
  )

  // No file on the route (typed URL / refresh with no file) — back to Files.
  if (path === '') {
    return <Navigate to={ROUTES.ADMIN.FILES} replace />
  }

  // A file that no longer exists (or can't be read): keep the operator on the
  // page with an explicit retry instead of silently bouncing to the browser.
  if (loadError) {
    return (
      <div className="flex flex-col w-[calc(100%+2rem)] md:w-[calc(100%+3rem)] -mx-4 md:-mx-6 -my-6 md:-my-8 h-[calc(100dvh-3.5rem)] items-center justify-center gap-4 px-6 text-center">
        <Helmet>
          <title>Editor · Admin</title>
        </Helmet>
        <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-error">
          Could not open file
        </p>
        <p className="max-w-[46ch] text-body-md text-on-surface-variant">
          <span className="font-mono text-on-surface">{path}</span> could not be
          read. {loadError}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="filled"
            color="primary"
            size="md"
            onClick={() => {
              setLoading(true)
              setLoadError(null)
              setReloadToken((n) => n + 1)
            }}
          >
            Retry
          </Button>
          <Button variant="text" color="neutral" size="md" onClick={goBack}>
            Back to files
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col overflow-hidden overscroll-none w-[calc(100%+2rem)] md:w-[calc(100%+3rem)] -mx-4 md:-mx-6 -my-6 md:-my-8 h-[calc(100dvh-3.5rem)]">
      <Helmet>
        <title>
          {fileName ? `${fileName} · Files · Admin` : 'Code Editor · Admin'}
        </title>
      </Helmet>

      {/* ── Editor body (full-page, not a card) ───────────────────────────── */}
      <div className="flex-1 min-h-0 relative">
        {loading ? (
          <div className="h-full overflow-hidden">
            <Skeleton variant="rectangular" className="h-full" />
          </div>
        ) : (
          <CodeEditor
            value={content}
            onChange={setContent}
            language={isLargeFile ? null : language}
            onSave={saveAction}
            onCursor={setCursor}
            placeholder={`// Editing ${path}`}
            ariaLabel={`${fileName || 'File'} code editor`}
            fillHeight
            borderless
            autoFocus
          />
        )}
      </div>

      {/* ── Footer status bar: permanent chrome, never part of the scroll ── */}
      <div className="flex min-h-9 shrink-0 items-center justify-between gap-2 border-t border-hairline bg-surface-container-low px-3 py-1.5 pb-[max(0.375rem,env(safe-area-inset-bottom))] text-[11px] font-mono text-on-surface-variant select-none">
        <span className="flex items-center gap-2.5 min-w-0">
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || isDirty || saving || refreshing}
            aria-label="Reload file from disk"
            title={
              loading
                ? 'Loading file…'
                : isDirty
                  ? 'Save or discard changes before reloading'
                  : 'Reload file from disk'
            }
            className="flex items-center justify-center h-6 w-6 rounded-[var(--radius-card)] text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high active:opacity-[0.82] transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <RefreshCw
              className={cn(
                'h-3.5 w-3.5',
                (refreshing || loading) && 'animate-spin',
              )}
              strokeWidth={2}
            />
          </button>
          <span className="tabular-nums whitespace-nowrap">
            {loading ? 'Loading…' : `Ln ${cursor.line}, Col ${cursor.column}`}
          </span>
        </span>
        <span className="flex items-center gap-2 flex-shrink-0">
          {loading ? (
            <span>Reading file…</span>
          ) : (
            <>
              <span className="flex min-w-0 items-center gap-1.5 text-on-surface-variant/80">
                <span className="shrink-0">{languageLabel}</span>
                <span className="hidden shrink-0 sm:inline">· UTF-8 · LF</span>
                <span className="shrink-0 tabular-nums">
                  · {content.length.toLocaleString()} ch
                </span>
              </span>
              {isLargeFile && (
                <span className="hidden text-on-surface-variant/85 md:inline">
                  Plain-text mode
                </span>
              )}
              {isDirty ? (
                <span className="flex items-center gap-1.5 text-warning">
                  <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
                  <span>Unsaved</span>
                </span>
              ) : (
                savedFlash && <span className="text-success">Saved</span>
              )}
            </>
          )}
        </span>
        {/* Announce save-state transitions only — the cursor position changes
            on every keypress and must never be a live region. */}
        <span className="sr-only" role="status" aria-live="polite">
          {saving
            ? 'Saving file'
            : savedFlash
              ? 'File saved'
              : isDirty
                ? 'Unsaved changes'
                : ''}
        </span>
      </div>

      {/* ── Unsaved-changes confirm ─────────────────────────────────────── */}
      <Dialog.Root
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!open) handleConfirmCancel()
        }}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>Unsaved changes</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant">
                <span className="font-mono text-on-surface">{fileName}</span>{' '}
                has unsaved changes. Save them before leaving?
              </p>
            </Dialog.Body>
            <Dialog.Footer>
              <Button
                variant="text"
                color="neutral"
                size="sm"
                onClick={handleConfirmCancel}
              >
                Cancel
              </Button>
              <Button
                variant="tonal"
                color="error"
                size="sm"
                onClick={handleConfirmDiscard}
              >
                Discard
              </Button>
              <Button
                variant="filled"
                color="primary"
                size="sm"
                onClick={() => void handleConfirmSave()}
                isLoading={saving}
                disabled={saving}
                leftIcon={<Check className="h-4 w-4" />}
              >
                Save
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>

      {/* Externally modified file: never overwrite silently. */}
      <Dialog.Root
        open={conflictOpen}
        onOpenChange={(open) => {
          if (!open) setConflictOpen(false)
        }}
      >
        <Dialog.Positioner position="center">
          <Dialog.Backdrop />
          <Dialog.Content size="sm">
            <Dialog.Header>
              <Dialog.Title>File changed on disk</Dialog.Title>
              <Dialog.CloseTrigger />
            </Dialog.Header>
            <Dialog.Body>
              <p className="text-body-md text-on-surface-variant">
                <span className="font-mono text-on-surface">{fileName}</span>{' '}
                was modified outside this editor after you opened it. Saving now
                would overwrite that change.
              </p>
            </Dialog.Body>
            <Dialog.Footer>
              <Button
                variant="text"
                color="neutral"
                size="sm"
                onClick={() => setConflictOpen(false)}
              >
                Keep editing
              </Button>
              <Button
                variant="tonal"
                color="warning"
                size="sm"
                onClick={() => void handleReloadConflict()}
              >
                Reload from disk
              </Button>
              <Button
                variant="filled"
                color="error"
                size="sm"
                onClick={handleOverwriteConflict}
              >
                Overwrite
              </Button>
            </Dialog.Footer>
          </Dialog.Content>
        </Dialog.Positioner>
      </Dialog.Root>
    </div>
  )
}

function parentOf(entryPath: string): string {
  const idx = entryPath.lastIndexOf('/')
  return idx === -1 ? '' : entryPath.slice(0, idx)
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}
