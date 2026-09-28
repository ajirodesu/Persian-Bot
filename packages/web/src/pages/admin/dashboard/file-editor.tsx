import { useEffect, useMemo, useRef, useState } from 'react'
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
import CodeEditor from '@/components/editor/CodeEditor'
import { getFileLanguage } from '@/components/icons/FileTypeIcons'
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
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [navAllowed, setNavAllowed] = useState(false)
  const [cursor, setCursor] = useState({ line: 1, column: 1 })
  const savedTimer = useRef<number | null>(null)

  // Reset per-file state when the route path changes while mounted
  // (render-phase adjustment — same pattern as DashboardLayout's
  // openBotId reset — so the load effect below stays fetch-only).
  const [prevPath, setPrevPath] = useState(path)
  if (path !== prevPath) {
    setPrevPath(path)
    setContent('')
    setSavedContent('')
    setLoading(true)
    setLoadError(null)
    setSavedFlash(false)
    setConfirmOpen(false)
    setNavAllowed(false)
  }

  const isDirty = content !== savedContent
  const fileName = basename(path)
  const language = getFileLanguage(fileName)

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current)
    },
    [],
  )

  // Load the real file through the existing file-read flow.
  useEffect(() => {
    if (path === '') return
    let cancelled = false
    adminFileManagerService
      .getFileContent(path)
      .then((data) => {
        if (cancelled) return
        setContent(data.content)
        setSavedContent(data.content)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setLoadError(err instanceof Error ? err.message : 'Failed to read file')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [path])

  async function handleSave(): Promise<boolean> {
    if (!isDirty || saving || path === '') return false
    setSaving(true)
    try {
      await adminFileManagerService.saveFile(path, content)
      setSavedContent(content)
      // Refresh the browser listing + git markers behind the editor.
      void refresh(parentOf(path))
      void refreshGit()
      // Success is shown in-button (brief check flash) — no toast.
      setSavedFlash(true)
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(() => setSavedFlash(false), 1400)
      return true
    } catch (err) {
      // Changes are kept (dirty only clears on success).
      notifyError(err instanceof Error ? err.message : 'Failed to save file')
      return false
    } finally {
      setSaving(false)
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

  // Header override — the page's ONLY header is the dashboard header.
  // Set when identity/state changes, cleared on unmount so other pages are
  // unaffected.
  const saveDisabled = !isDirty || saving
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
      title: <span title={path}>{fileName || 'Code Editor'}</span>,
      right: (
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
                  isDirty ? 'text-primary' : 'text-on-surface-variant/40',
                )}
              />
            )
          }
          aria-label={
            saving ? 'Saving…' : savedFlash ? 'Saved' : 'Save file'
          }
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
      ),
    })
    return () => setOverride(null)
  }, [
    setOverride,
    fileName,
    path,
    isDirty,
    saving,
    savedFlash,
    saveDisabled,
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

  function handleRefresh() {
    if (isDirty || saving || path === '') return
    setLoading(true)
    adminFileManagerService
      .getFileContent(path)
      .then((data) => {
        setContent(data.content)
        setSavedContent(data.content)
      })
      .catch((err: unknown) => {
        notifyError(err instanceof Error ? err.message : 'Failed to reload file')
      })
      .finally(() => setLoading(false))
  }

  // Large files skip highlighting (Replit-style graceful degradation):
  // tokenizing megabytes per keystroke would jank typing. Editing, gutter,
  // save and dirty tracking all keep working on plain text.
  const LARGE_FILE_BYTES = 150_000
  const LARGE_FILE_LINES = 4000
  const isLargeFile = useMemo(
    () =>
      content.length > LARGE_FILE_BYTES ||
      content.split('\n').length > LARGE_FILE_LINES,
    [content],
  )

  // No file on the route (typed URL / refresh with no file) — back to Files.
  if (path === '') {
    return <Navigate to={ROUTES.ADMIN.FILES} replace />
  }

  // A file that no longer exists (or can't be read) — back to Files.
  if (loadError) {
    return <Navigate to={ROUTES.ADMIN.FILES} replace />
  }

  return (
    <div className="flex flex-col w-[calc(100%+2rem)] md:w-[calc(100%+3rem)] -m-4 md:-m-6 h-[calc(100dvh-3.5rem)] min-h-[24rem] pb-[env(safe-area-inset-bottom)]">
      <Helmet>
        <title>{fileName ? `${fileName} · Files · Admin` : 'Code Editor · Admin'}</title>
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
            onSave={() => void handleSave()}
            onCursor={setCursor}
            placeholder={`// Editing ${path}`}
            fillHeight
            borderless
            autoFocus
          />
        )}
      </div>

      {/* ── Footer status bar: refresh · cursor · dirty ─────────────────── */}
      {!loading && (
        <div className="flex items-center justify-between gap-2 px-3 text-[11px] font-mono text-on-surface-variant select-none shrink-0">
          <span className="flex items-center gap-2.5 min-w-0">
            <button
              type="button"
              onClick={handleRefresh}
              disabled={isDirty || saving}
              aria-label="Reload file from disk"
              title={
                isDirty
                  ? 'Save or discard changes before reloading'
                  : 'Reload file from disk'
              }
              className="flex items-center justify-center h-7 w-7 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high active:opacity-[0.82] transition-colors disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
            <span className="tabular-nums whitespace-nowrap">
              Ln {cursor.line}, Col {cursor.column}
            </span>
          </span>
          <span className="flex items-center gap-2 flex-shrink-0">
            {isLargeFile && (
              <span className="hidden sm:inline text-on-surface-variant/70">
                Large file — highlighting off
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
          </span>
        </div>
      )}

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
                <span className="font-mono text-on-surface">{fileName}</span> has
                unsaved changes. Save them before leaving?
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
    </div>
  )
}

function parentOf(entryPath: string): string {
  const idx = entryPath.lastIndexOf('/')
  return idx === -1 ? '' : entryPath.slice(0, idx)
}
