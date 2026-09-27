import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ComponentType, Ref, SVGProps } from 'react'
import { createPortal } from 'react-dom'
import { Helmet } from '@dr.pogodin/react-helmet'
import {
  CircleDot,
  FilePlus2,
  Pencil,
  Trash2,
  X,
  RefreshCw,
  Check,
  GitBranch,
  GitCommitHorizontal,
  GitBranchPlus,
  Upload,
  Download,
  Undo2,
  RotateCcw,
  UserKey,
  KeyRound,
  LogOut,
  Eye,
  EyeOff,
  History,
} from 'lucide-react'
import { cn } from '@/utils/cn.util'
import Button from '@/components/ui/buttons/Button'
import IconButton from '@/components/ui/buttons/IconButton'
import Badge from '@/components/ui/data-display/Badge'
import EmptyState from '@/components/ui/data-display/EmptyState'
import Alert from '@/components/ui/feedback/Alert'
import Dialog from '@/components/ui/overlay/Dialog'
import Skeleton from '@/components/ui/feedback/Skeleton'
import { highlightToHtml } from '@/lib/syntax-highlight.lib'
import { useAdminFileManager } from '@/features/admin/hooks/useAdminFileManager'
import type { UseAdminFileManagerReturn } from '@/features/admin/hooks/useAdminFileManager'
import type {
  GitChangeDto,
  GitStatusDto,
  GitCommitInfoDto,
} from '@/features/admin/services/admin-file-manager.service'
import { useSnackbar } from '@/contexts/SnackbarContext'

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
    // The identity card is stationary: nothing in it shifts for the on-screen
    // keyboard. Only the commit composer (data-git-composer) lifts when IT is
    // focused — focusing this card's token input leaves every element in the
    // panel exactly where it is (the browser scrolls the input into view
    // itself if needed).
    <div
      data-git-token-card=""
      className="flex shrink-0 flex-col gap-2 border-b border-hairline bg-surface px-3 py-2.5 sm:py-2 lg:bg-transparent"
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
                type={showToken ? 'text' : 'password'}
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                placeholder="ghp_… personal access token"
                autoComplete="off"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={!configured || verifyBusy}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleConnect()
                }}
                className="w-full rounded-[var(--radius-input)] border border-outline-variant bg-surface-container px-3 py-2.5 pr-11 font-mono text-[16px] leading-6 text-on-surface placeholder:text-on-surface-variant/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50 sm:py-1.5 sm:text-label-sm"
              />
              <button
                type="button"
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
          <p className="text-body-xs text-on-surface-variant">
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
  // Focus-scoped: ONLY the commit composer adjusts for the keyboard. Focusing
  // the GitHub token input (or anything else) moves nothing — the identity
  // card is stationary and the browser's own scroll-into-view handles
  // visibility — so the composer stays pinned and still in every case.
  const panelRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // Coarse-pointer mobile gate: `lg` is this panel's mobile breakpoint, and
    // the pointer check keeps desktop (including pinch/ctrl-zoom, where the
    // visual viewport also shrinks) from ever moving the layout.
    const mq = window.matchMedia('(max-width: 1023px) and (pointer: coarse)')
    const vv = window.visualViewport
    let raf = 0
    let mode: 'composer' | null = null

    const update = () => {
      raf = 0
      const root = panelRef.current
      if (!root) return
      const kb =
        mq.matches && vv
          ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop))
          : 0

      // Only the commit composer ever lifts, and only by the covered height.
      root.style.setProperty(
        '--git-kb-offset',
        mode === 'composer' ? `${kb}px` : '0px',
      )
    }

    // The keyboard open/close sequence fires a burst of viewport events —
    // fold them into one layout read per frame.
    const onEvent = () => {
      if (raf) return
      raf = requestAnimationFrame(update)
    }

    // Focus routing: only the commit composer owns the keyboard. Any other
    // focus (the GitHub token input included) maps to null — nothing moves.
    const classify = (target: Element | null): 'composer' | null => {
      if (!target) return null
      if (target.closest('[data-git-composer]')) return 'composer'
      return null
    }
    const onFocusIn = (e: FocusEvent) => {
      mode = classify(e.target as Element | null)
      onEvent()
    }
    // focusout fires before the next focusin — re-check in a microtask so
    // tabbing between the panel's inputs never flashes back to "no mode".
    const onFocusOut = () => {
      queueMicrotask(() => {
        mode = classify(document.activeElement)
        onEvent()
      })
    }

    update()
    vv?.addEventListener('resize', onEvent)
    vv?.addEventListener('scroll', onEvent)
    window.addEventListener('resize', onEvent)
    const root = panelRef.current
    root?.addEventListener('focusin', onFocusIn)
    root?.addEventListener('focusout', onFocusOut)
    return () => {
      if (raf) cancelAnimationFrame(raf)
      vv?.removeEventListener('resize', onEvent)
      vv?.removeEventListener('scroll', onEvent)
      window.removeEventListener('resize', onEvent)
      root?.removeEventListener('focusin', onFocusIn)
      root?.removeEventListener('focusout', onFocusOut)
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
    <div
      ref={panelRef}
      className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row"
    >
      {/* Left column — branch, changes, commit box, history */}
      <div className="flex min-w-0 flex-col border-b border-hairline pb-[calc(var(--git-composer-h,0px)+env(safe-area-inset-bottom))] lg:pb-0 lg:w-96 lg:border-r lg:border-b-0 xl:w-[26rem]">
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
          <div className="max-h-40 overflow-y-auto overscroll-contain px-1 pb-2">
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

// ── Page ──────────────────────────────────────────────────────────────────────

/**
 * Admin Git page — the working-tree panel that previously lived as a "Git" view
 * inside the Files page. Owns its own useAdminFileManager instance: the file
 * tree/editor state is not shared with the Files page, and git status/history/
 * branches load on mount via the hook.
 */
export default function AdminGitPage() {
  const files = useAdminFileManager()
  const configured = files.meta?.configured ?? true

  return (
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden">
      <Helmet>
        <title>Git · Admin</title>
      </Helmet>

      <GitPanel files={files} configured={configured} />
    </div>
  )
}
