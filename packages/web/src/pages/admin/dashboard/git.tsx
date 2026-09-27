import { Helmet } from '@dr.pogodin/react-helmet'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  GitBranch,
  GitCommitHorizontal,
  ArrowDownToLine,
  ArrowUpFromLine,
  RefreshCw,
  Plus,
  Undo2,
  Trash2,
  Check,
  ChevronRight,
} from 'lucide-react'
import Alert from '@/components/ui/feedback/Alert'
import Skeleton from '@/components/ui/feedback/Skeleton'
import Input from '@/components/ui/forms/Input'
import Button from '@/components/ui/buttons/Button'
import { FileTypeIcon } from '@/components/icons/FileTypeIcons'
import { adminFileManagerService } from '@/features/admin/services/admin-file-manager.service'
import type {
  GitChangeDto,
  GitCommitInfoDto,
  GitStatusDto,
  RepoMetaDto,
} from '@/features/admin/services/admin-file-manager.service'
import { useSnackbar } from '@/contexts/SnackbarContext'
import { ROUTES } from '@/constants/routes.constants'
import { cn } from '@/utils/cn.util'

// ============================================================================
// Small presentational pieces matching admin settings
// ============================================================================

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-1">
      <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
        {children}
      </h2>
    </div>
  )
}

function StatusChip({ text, tone = 'default' }: { text: string; tone?: 'default' | 'accent' | 'success' | 'error' | 'info' | 'warning' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium border flex-shrink-0',
        tone === 'accent' && 'bg-surface-container-high text-primary border-primary/30',
        tone === 'success' && 'bg-surface-container-high text-success border-success/30',
        tone === 'error' && 'bg-surface-container-high text-error border-error/30',
        tone === 'info' && 'bg-surface-container-high text-info border-info/30',
        tone === 'warning' && 'bg-surface-container-high text-warning border-warning/30',
        tone === 'default' && 'bg-surface-container-high text-on-surface-variant border-hairline',
      )}
    >
      {text}
    </span>
  )
}

function changeTone(status: GitChangeDto['status']): 'accent' | 'success' | 'error' | 'info' | 'warning' {
  switch (status) {
    case 'added':
      return 'success'
    case 'deleted':
      return 'error'
    case 'renamed':
      return 'info'
    case 'untracked':
      return 'warning'
    case 'modified':
    default:
      return 'accent'
  }
}

function changeLabel(status: GitChangeDto['status']): string {
  switch (status) {
    case 'added':
      return 'A'
    case 'deleted':
      return 'D'
    case 'renamed':
      return 'R'
    case 'untracked':
      return 'U'
    case 'modified':
    default:
      return 'M'
  }
}

function apiErrorMessage(err: unknown, fallback: string): string {
  const e = err as { response?: { data?: { error?: string } } }
  return (
    e.response?.data?.error ||
    (err instanceof Error ? err.message : fallback)
  )
}

/**
 * AdminGitPage — /admin/dashboard/git
 *
 * Deployment repository Git panel: working-tree status, stage/unstage,
 * commit, push/pull, branches and recent history. Writes authenticate with
 * the single global GitHub token connected in Admin → Settings → Git.
 */
export default function AdminGitPage() {
  const { success, error: notifyError } = useSnackbar()

  const [meta, setMeta] = useState<RepoMetaDto | null>(null)
  const [status, setStatus] = useState<GitStatusDto | null>(null)
  const [branches, setBranches] = useState<string[]>([])
  const [log, setLog] = useState<GitCommitInfoDto[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [newBranch, setNewBranch] = useState('')
  const [branchesOpen, setBranchesOpen] = useState(false)

  const refresh = useCallback(async () => {
    setLoadError(null)
    try {
      const [m, s, b, l] = await Promise.all([
        adminFileManagerService.getMeta(),
        adminFileManagerService.getGitStatus(),
        adminFileManagerService.getGitBranches().catch(() => [] as string[]),
        adminFileManagerService.getGitLog(15).catch(() => [] as GitCommitInfoDto[]),
      ])
      setMeta(m)
      setStatus(s)
      setBranches(b)
      setLog(l)
    } catch (err) {
      setLoadError(apiErrorMessage(err, 'Failed to load Git status'))
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard async data-fetching: setState is deferred to await continuations
    void refresh()
  }, [refresh])

  const runAction = useCallback(
    async (key: string, fn: () => Promise<unknown>, okMessage: string) => {
      setBusy(key)
      try {
        await fn()
        await refresh()
        success(okMessage)
      } catch (err) {
        notifyError(apiErrorMessage(err, 'Git operation failed'))
      } finally {
        setBusy(null)
      }
    },
    [refresh, success, notifyError],
  )

  const handleCommit = () => {
    const text = message.trim()
    if (!text) return
    void runAction('commit', async () => {
      const result = await adminFileManagerService.gitCommit(text)
      if (result.author) setMessage('')
      return result
    }, 'Changes committed')
  }

  const handleCreateBranch = () => {
    const name = newBranch.trim()
    if (!name) return
    void runAction(`create-branch`, async () => {
      const result = await adminFileManagerService.gitCreateBranch(name)
      setNewBranch('')
      return result
    }, `Switched to new branch '${name}'`)
  }

  const isBusy = (key: string) => busy === key
  const anyBusy = busy !== null
  const tokenConnected = meta?.configured ?? status?.configured ?? false

  if (isLoading) {
    return (
      <div className="flex flex-col gap-0 max-w-[420px] md:max-w-2xl w-full mx-auto pb-8" aria-busy="true">
        <div className="px-5 pt-4 space-y-6">
          {[0, 1, 2].map((s) => (
            <section key={s} className="space-y-2">
              <Skeleton textSize="body-sm" width="96px" />
              <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
                <div className="p-3.5 flex items-center gap-3.5">
                  <Skeleton variant="input" width={36} height={36} />
                  <div className="flex flex-col gap-2">
                    <Skeleton textSize="body-sm" width="140px" />
                    <Skeleton textSize="body-sm" width="100px" />
                  </div>
                </div>
              </div>
            </section>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col max-w-2xl lg:max-w-4xl w-full mx-auto pb-8">
      <Helmet>
        <title>Git · Admin</title>
      </Helmet>

      <div className="pt-4 space-y-6">
        {loadError && (
          <Alert variant="tonal" color="error" title="Error" message={loadError} size="sm" />
        )}

        {/* ── REPOSITORY ── */}
        <section aria-label="Repository status" className="space-y-2">
          <SectionTitle>Repository</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
            <div className="p-3.5 flex items-center justify-between gap-3">
              <div className="flex items-center space-x-3.5 min-w-0">
                <div className="rounded-lg border w-9 h-9 flex items-center justify-center flex-shrink-0 bg-primary/10 border-primary/30 text-primary">
                  <GitBranch className="w-4 h-4" strokeWidth={2} />
                </div>
                <div className="flex flex-col min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-on-surface truncate leading-snug font-mono">
                      {meta && meta.owner !== '' ? `${meta.owner}/${meta.repo}` : 'repository'}
                    </span>
                    {status?.branch && <StatusChip text={status.branch} tone="accent" />}
                    {status?.upstream && <StatusChip text={`↑${status.ahead} ↓${status.behind}`} />}
                    {status && <StatusChip text={status.clean ? 'Clean' : 'Dirty'} tone={status.clean ? 'success' : 'warning'} />}
                  </div>
                  <span className="text-xs text-on-surface-variant truncate mt-0.5 font-mono">
                    {status?.upstream ?? status?.root ?? '—'}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  setIsLoading(true)
                  void refresh()
                }}
                disabled={anyBusy}
                aria-label="Refresh Git status"
                className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high active:opacity-[0.82] transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex-shrink-0"
              >
                <RefreshCw className={cn('h-4 w-4', isLoading && 'animate-spin')} strokeWidth={2} />
              </button>
            </div>
            {!tokenConnected && (
              <div className="p-3.5 pt-0">
                <Alert
                  variant="tonal"
                  color="warning"
                  title="GitHub not connected"
                  message="Connect a personal access token to enable commits and pushes."
                  size="sm"
                />
                <div className="pt-2">
                  <Button
                    as={Link}
                    to={ROUTES.ADMIN.SETTINGS}
                    variant="tonal"
                    color="primary"
                    size="sm"
                  >
                    Open Settings → Git
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* ── COMMIT ── */}
        <section aria-label="Commit changes" className="space-y-2">
          <SectionTitle>Commit</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden">
            <div className="p-3.5 space-y-2.5">
              <Input
                placeholder="Commit message — e.g. Fix login redirect"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                aria-label="Commit message"
                disabled={anyBusy}
                className="py-2.5 text-sm leading-6"
              />
              <div className="flex flex-col gap-2 sm:grid sm:grid-cols-2">
                <Button
                  variant="filled"
                  color="primary"
                  size="md"
                  leftIcon={<GitCommitHorizontal className="h-4 w-4" />}
                  disabled={anyBusy || !message.trim() || (status?.stagedCount ?? 0) === 0}
                  onClick={handleCommit}
                  fullWidth
                  className="max-sm:py-1.5"
                >
                  {isBusy('commit') ? 'Committing…' : `Commit (${status?.stagedCount ?? 0} staged)`}
                </Button>
                <div className="grid grid-cols-2 gap-2">
                  <Button
                    variant="tonal"
                    color="primary"
                    size="md"
                    leftIcon={<ArrowUpFromLine className="h-4 w-4" />}
                    disabled={anyBusy || !tokenConnected}
                    onClick={() => void runAction('push', () => adminFileManagerService.gitPush(), 'Pushed to upstream')}
                    className="max-sm:py-1.5"
                  >
                    {isBusy('push') ? 'Pushing…' : 'Push'}
                  </Button>
                  <Button
                    variant="tonal"
                    color="primary"
                    size="md"
                    leftIcon={<ArrowDownToLine className="h-4 w-4" />}
                    disabled={anyBusy || !tokenConnected}
                    onClick={() => void runAction('pull', () => adminFileManagerService.gitPull(), 'Pulled from upstream')}
                    className="max-sm:py-1.5"
                  >
                    {isBusy('pull') ? 'Pulling…' : 'Pull'}
                  </Button>
                </div>
              </div>
              <p className="text-[11px] text-surface-variant leading-normal px-0.5">
                Committing uses the GitHub identity connected in Settings → Git.
              </p>
            </div>
          </div>
        </section>

        {/* ── CHANGES ── */}
        <section aria-label="Working tree changes" className="space-y-2">
          <div className="flex items-center justify-between px-1">
            <h2 className="text-xs font-semibold text-on-surface-variant uppercase tracking-wider">
              Changes
            </h2>
            <span className="text-[11px] font-mono font-medium text-surface-variant">
              {(status?.changes.length ?? 0) === 0
                ? 'Working tree clean'
                : `${status?.stagedCount ?? 0} staged · ${status?.unstagedCount ?? 0} unstaged`}
            </span>
          </div>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            <div className="p-3.5 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void runAction('stage-all', () => adminFileManagerService.gitStage([]), 'All changes staged')}
                disabled={anyBusy || (status?.unstagedCount ?? 0) === 0}
                className="flex-1 h-9 px-3 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline active:border-primary text-on-surface font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                <span>{isBusy('stage-all') ? 'Staging…' : 'Stage All'}</span>
              </button>
              <button
                type="button"
                onClick={() => void runAction('unstage-all', () => adminFileManagerService.gitUnstage([]), 'All changes unstaged')}
                disabled={anyBusy || (status?.stagedCount ?? 0) === 0}
                className="flex-1 h-9 px-3 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline active:border-primary text-on-surface font-semibold text-xs flex items-center justify-center gap-1.5 transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <Undo2 className="h-3.5 w-3.5" strokeWidth={2} />
                <span>{isBusy('unstage-all') ? 'Working…' : 'Unstage All'}</span>
              </button>
            </div>
            {(status?.changes.length ?? 0) === 0 ? (
              <p className="p-6 text-sm text-on-surface-variant italic text-center">
                No changes — the working tree matches HEAD.
              </p>
            ) : (
              status?.changes.map((change) => (
                <ChangeRow
                  key={`${change.path}-${change.staged ? 's' : 'u'}`}
                  change={change}
                  disabled={anyBusy}
                  busyKey={busy}
                  onStage={(p) => void runAction(`stage:${p}`, () => adminFileManagerService.gitStage([p]), `Staged ${p}`)}
                  onUnstage={(p) => void runAction(`unstage:${p}`, () => adminFileManagerService.gitUnstage([p]), `Unstaged ${p}`)}
                  onDiscard={(p) => void runAction(`discard:${p}`, () => adminFileManagerService.gitDiscard([p]), `Discarded ${p}`)}
                />
              ))
            )}
          </div>
        </section>

        {/* ── BRANCHES ── */}
        <section aria-label="Branches" className="space-y-2">
          <article
            role="button"
            tabIndex={0}
            aria-expanded={branchesOpen}
            onClick={() => setBranchesOpen((v) => !v)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                setBranchesOpen((v) => !v)
              }
            }}
            className="bg-surface-container-low border border-hairline rounded-xl overflow-hidden p-3.5 flex items-center justify-between hover:bg-surface-container-highest/60 active:bg-surface-container-highest tactile-press cursor-pointer transition-colors duration-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-inset"
          >
            <div className="flex items-center space-x-3.5 min-w-0">
              <div className="rounded-lg border w-9 h-9 flex items-center justify-center flex-shrink-0 bg-surface-container-high border-hairline text-on-surface-variant">
                <GitBranch className="w-4 h-4" strokeWidth={2} />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="text-sm font-semibold text-on-surface leading-snug">
                  Branches
                </span>
                <span className="text-xs text-on-surface-variant truncate mt-0.5 font-mono">
                  {branches.length === 0 ? 'No branches loaded' : `${branches.length} local · on ${status?.branch ?? '—'}`}
                </span>
              </div>
            </div>
            <div className="flex items-center pl-3 flex-shrink-0 text-surface-variant">
              <ChevronRight
                className={cn('w-4 h-4 transition-transform duration-200', branchesOpen && 'rotate-90')}
                strokeWidth={2}
              />
            </div>
          </article>
          {branchesOpen && (
            <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
              <div className="p-3.5 flex items-center gap-2">
                <div className="flex-1 min-w-0">
                  <Input
                    placeholder="New branch name"
                    value={newBranch}
                    onChange={(e) => setNewBranch(e.target.value)}
                    aria-label="New branch name"
                    disabled={anyBusy}
                    className="py-2.5 text-sm leading-6"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleCreateBranch}
                  disabled={anyBusy || !newBranch.trim()}
                  className="h-10 px-3 rounded-lg bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline active:border-primary text-on-surface font-semibold text-xs flex items-center gap-1.5 transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex-shrink-0"
                >
                  <Plus className="h-3.5 w-3.5" strokeWidth={2} />
                  <span>{isBusy('create-branch') ? 'Creating…' : 'Create & Switch'}</span>
                </button>
              </div>
              {branches.map((branch) => {
                const current = branch === status?.branch
                return (
                  <div key={branch} className="p-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-mono text-on-surface truncate">{branch}</span>
                      {current && <StatusChip text="Current" tone="accent" />}
                    </div>
                    {!current && (
                      <button
                        type="button"
                        onClick={() => void runAction(`checkout:${branch}`, () => adminFileManagerService.gitCheckout(branch), `Switched to '${branch}'`)}
                        disabled={anyBusy}
                        className="px-2.5 py-1 text-xs font-semibold rounded bg-surface-container-high hover:bg-surface-container-highest active:opacity-[0.82] border border-hairline text-on-surface transition-colors duration-100 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 flex-shrink-0"
                      >
                        {isBusy(`checkout:${branch}`) ? 'Switching…' : 'Switch'}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </section>

        {/* ── HISTORY ── */}
        <section aria-label="Recent commits" className="space-y-2">
          <SectionTitle>Recent Commits</SectionTitle>
          <div className="bg-surface-container-low border border-hairline rounded-xl divide-y divide-outline-variant overflow-hidden">
            {log.length === 0 ? (
              <p className="p-6 text-sm text-on-surface-variant italic text-center">
                No commits found.
              </p>
            ) : (
              log.map((commit) => (
                <div key={commit.sha} className="p-3.5 flex items-start gap-3">
                  <div className="rounded-lg border w-8 h-8 flex items-center justify-center flex-shrink-0 bg-surface-container-high border-hairline text-on-surface-variant">
                    <Check className="w-3.5 h-3.5" strokeWidth={2} />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-sm font-medium text-on-surface leading-snug break-words">
                      {commit.subject}
                    </span>
                    <span className="text-[11px] text-surface-variant font-mono mt-1 truncate">
                      {commit.sha.slice(0, 7)} · {commit.author} · {commit.when}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function ChangeRow({
  change,
  disabled,
  busyKey,
  onStage,
  onUnstage,
  onDiscard,
}: {
  change: GitChangeDto
  disabled: boolean
  busyKey: string | null
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  onDiscard: (path: string) => void
}) {
  return (
    <div className="p-3 flex items-center justify-between gap-3">
      <div className="flex items-center gap-2.5 min-w-0">
        <FileTypeIcon name={change.path} className="h-5 w-5 shrink-0" />
        <StatusChip text={changeLabel(change.status)} tone={changeTone(change.status)} />
        <div className="flex flex-col min-w-0">
          <span className="text-sm font-mono text-on-surface truncate">{change.path}</span>
          <span className="text-[11px] text-surface-variant mt-0.5">
            {change.staged ? 'Staged' : 'Unstaged'}
            {change.hasUnstagedMods && change.staged ? ' + unstaged edits' : ''}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1 flex-shrink-0">
        {change.staged ? (
          <button
            type="button"
            onClick={() => onUnstage(change.path)}
            disabled={disabled}
            aria-label={`Unstage ${change.path}`}
            title="Unstage"
            className="p-2 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-container-high active:opacity-[0.82] transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <Undo2 className="h-4 w-4" strokeWidth={2} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onStage(change.path)}
            disabled={disabled}
            aria-label={`Stage ${change.path}`}
            title="Stage"
            className="p-2 rounded-lg text-on-surface-variant hover:text-primary hover:bg-surface-container-high active:opacity-[0.82] transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            {busyKey === `stage:${change.path}` ? (
              <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2} />
            ) : (
              <Plus className="h-4 w-4" strokeWidth={2} />
            )}
          </button>
        )}
        <button
          type="button"
          onClick={() => onDiscard(change.path)}
          disabled={disabled}
          aria-label={`Discard ${change.path}`}
          title="Discard changes"
          className="p-2 rounded-lg text-on-surface-variant hover:text-error hover:bg-surface-container-high active:opacity-[0.82] transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-error/40"
        >
          <Trash2 className="h-4 w-4" strokeWidth={2} />
        </button>
      </div>
    </div>
  )
}
