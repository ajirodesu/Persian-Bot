import { useEffect, useRef, useState } from 'react'
import { Helmet } from '@dr.pogodin/react-helmet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft, ChevronDown } from 'lucide-react'
import IconButton from '@/components/ui/buttons/IconButton'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import EmptyState from '@/components/ui/data-display/EmptyState'
import CodeEditor from '@/components/editor/CodeEditor'
import { useAdminFileManager } from '@/features/admin/hooks/useAdminFileManager'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { ROUTES } from '@/constants/routes.constants'
import { cn } from '@/utils/cn.util'
import type { RepoEntryDto } from '@/features/admin/services/admin-file-manager.service'

// Ajiro code-editor language badge (extension → 2–3 letter mark).
const EXT_LANG: Record<string, string> = {
  js: 'JS',
  jsx: 'JS',
  json: 'JSON',
  ts: 'TS',
  tsx: 'TSX',
  html: 'HTML',
  css: 'CSS',
  md: 'MD',
  lock: 'JSON',
  toml: 'TOML',
  yaml: 'YAML',
  yml: 'YAML',
  gitignore: 'TXT',
  replit: 'TOML',
}

function langFor(fileName: string): string {
  const ext = (fileName.split('.').pop() ?? '').toLowerCase()
  return EXT_LANG[ext] ?? 'TXT'
}

function basename(path: string): string {
  const idx = path.lastIndexOf('/')
  return idx === -1 ? path : path.slice(idx + 1)
}

/**
 * AdminFileEditorPage — /admin/dashboard/files/edit?path=xxx
 *
 * Dedicated code-editor route (Ajiro flow: project-files → project/code-editor).
 * The header carries a chevron-left back button to the Files page (never a
 * hamburger) plus a centered file pill with language badge. The footer
 * status bar shows the file path, dirty state, and save action.
 */
export default function AdminFileEditorPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const path = searchParams.get('path') ?? ''
  const { success, error: notifyError } = useSnackbar()

  const files = useAdminFileManager()
  const [saving, setSaving] = useState(false)

  // files.openFile identity flips with dirty state — hold it in a ref so the
  // open effect below only re-runs when the path itself changes.
  const openFileRef = useRef(files.openFile)
  useEffect(() => {
    openFileRef.current = files.openFile
  }, [files.openFile])

  useEffect(() => {
    if (!path) return
    void openFileRef.current({
      name: basename(path),
      path,
      type: 'file',
      size: null,
      sha: '',
      lastCommit: null,
    })
  }, [path])

  const openEntry: RepoEntryDto | null = files.openFileEntry
  const isDirty = files.isDirty

  const handleSave = async () => {
    if (!isDirty || saving) return
    setSaving(true)
    try {
      const result = await files.saveFile()
      if (result.commitSha) {
        success(`Saved to working tree — commit ${result.commitSha.slice(0, 7)}`)
      } else {
        success('Saved to working tree (not yet committed)')
      }
    } catch (err) {
      notifyError(err instanceof Error ? err.message : 'Failed to save file')
    } finally {
      setSaving(false)
    }
  }

  const fileName = openEntry ? basename(openEntry.path) : basename(path)
  const badge = langFor(fileName)

  return (
    <div className="flex flex-col w-full">
      <Helmet>
        <title>{fileName ? `${fileName} · Files · Admin` : 'Code Editor · Admin'}</title>
      </Helmet>

      {/* ── Editor header: chevron back · file pill ─────────────────────── */}
      <div className="flex items-center gap-2">
        <IconButton
          variant="text"
          size="md"
          icon={<ChevronLeft className="h-5 w-5" />}
          aria-label="Back to files"
          title="Back to files"
          onClick={() => navigate(ROUTES.ADMIN.FILES)}
        />
        <button
          type="button"
          onClick={() => navigate(ROUTES.ADMIN.FILES)}
          title={openEntry?.path ?? path}
          className="flex min-w-0 flex-1 items-center justify-center rounded-full border border-hairline bg-surface-container-low px-3.5 h-11 space-x-2 transition-colors duration-fast hover:bg-surface-container-high focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <span className="flex h-4 w-4 items-center justify-center rounded-sm bg-primary font-bold text-[9px] text-on-primary flex-shrink-0">
            {badge}
          </span>
          <span className="text-sm font-medium tracking-tight text-on-surface truncate">
            {fileName || 'No file'}
          </span>
          <ChevronDown className="h-3 w-3 text-on-surface-variant flex-shrink-0" />
        </button>
      </div>

      {/* ── Editor body ─────────────────────────────────────────────────── */}
      <div className="mt-3 h-[calc(100dvh-16rem)] min-h-[26rem]">
        {!path || !openEntry ? (
          <div className="h-full flex items-center justify-center rounded-xl border border-hairline bg-surface-container-low p-6">
            <EmptyState
              icon={ChevronLeft}
              title="No file selected"
              description="Pick a file from the Files page to start editing."
              action={{
                label: 'Browse files',
                onClick: () => navigate(ROUTES.ADMIN.FILES),
              }}
            />
          </div>
        ) : (
          <>
            {files.fileError && (
              <div className="mb-3">
                <Alert
                  variant="tonal"
                  color="error"
                  title="Failed to read file"
                  message={files.fileError}
                />
              </div>
            )}
            <div className="h-full min-h-0 rounded-xl border border-hairline bg-surface-container-lowest overflow-hidden">
              {files.fileLoading ? (
                <Skeleton variant="rectangular" className="h-full" />
              ) : (
                <CodeEditor
                  value={files.content}
                  onChange={files.setContent}
                  language={openEntry.language}
                  onSave={() => void handleSave()}
                  placeholder={`// Editing ${openEntry.path}`}
                  fillHeight
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* ── Footer status bar ───────────────────────────────────────────── */}
      {openEntry && (
        <div className="mt-3 flex items-center justify-between gap-2 text-[11px] font-mono text-on-surface-variant select-none">
          <span className="min-w-0 truncate">{openEntry.path}</span>
          <span className="flex items-center gap-2 flex-shrink-0">
            {isDirty && (
              <span className="flex items-center gap-1.5 text-warning">
                <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />
                <span>Unsaved</span>
              </span>
            )}
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!isDirty || saving}
              className={cn(
                'px-2.5 py-1 text-xs font-sans font-semibold rounded bg-surface-container-high hover:bg-surface-container-highest/60 border border-hairline text-on-surface transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              )}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </span>
        </div>
      )}
    </div>
  )
}
