/**
 * Admin File Manager Service — the LOCAL repository file manager.
 *
 * Talks to /api/v1/admin/files, which operates on a REAL git checkout on the
 * server (ADMIN_REPO_PATH, or the process's own checkout). File mutations edit
 * the working tree only — nothing is committed or pushed automatically. The
 * /git/* routes drive the explicit stage → commit → push workflow surfaced by
 * the Git page, mirroring Replit's Git panel.
 */

import apiClient from '@/lib/api-client.lib'

// ── DTOs ───────────────────────────────────────────────────────────────────────

export interface RepoLastCommitDto {
  message: string
  author: string
  /** ISO timestamp of the last commit touching the entry. */
  date: string
}

export interface RepoEntryDto {
  name: string
  /** Path relative to the repository root, e.g. `packages/cat-bot/src/app`. */
  path: string
  type: 'folder' | 'file'
  /** File size in bytes; null for folders. */
  size: number | null
  sha: string
  lastCommit: RepoLastCommitDto | null
  /** Detected language key for editor highlighting; set after the file is read. */
  language?: string | null
}

export interface RepoDirectoryListingDto {
  /** The path that was listed ('' for the repository root). */
  path: string
  entries: RepoEntryDto[]
}

export interface RepoMetaDto {
  owner: string
  repo: string
  /** Current branch name (null when HEAD is detached). */
  branch: string | null
  configured: boolean
  /** Absolute path of the checkout the manager operates on. */
  root: string | null
}

export interface RepoReadFileDto {
  path: string
  content: string
  language: string | null
  size: number | null
  sha: string
}

export interface RepoTreeNodeDto {
  path: string
  type: 'file' | 'folder'
}

export interface RepoMutationResultDto {
  /** Working-tree changes are never auto-committed, so this is false on disk
   *  mutations; true reports for git operations. */
  synced: boolean
  commitSha?: string
}

export type GitChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'

export interface GitChangeDto {
  path: string
  status: GitChangeStatus
  /** True when the change is present in the index (staged). */
  staged: boolean
  /** True when the file also has unstaged worktree modifications. */
  hasUnstagedMods: boolean
}

export interface GitStatusDto {
  configured: boolean
  root: string
  branch: string | null
  upstream: string | null
  ahead: number
  behind: number
  changes: GitChangeDto[]
  stagedCount: number
  unstagedCount: number
  clean: boolean
}

export interface GitCommitInfoDto {
  sha: string
  author: string
  when: string
  subject: string
}

/** The GitHub account behind the deployment's single stored token. */
export interface GitHubIdentityDto {
  login: string
  name: string | null
  email: string | null
  avatarUrl: string | null
}

/** Server-side status of the global GitHub token (never contains the token). */
export interface GitHubConfigDto {
  configured: boolean
  identity: GitHubIdentityDto | null
}

// ── Client caches (perceived instant loads) ──────────────────────────────────
// Module-singleton caches survive route navigation (unlike hook state, which
// resets per page visit), so Files ⇄ Git ⇄ editor round-trips resolve without
// refetching. Short TTLs + mutation invalidation keep them fresh.

/** Folder listings: 20s — invalidated on every mutation. */
const LISTING_TTL_MS = 20_000
/** File contents: 60s — invalidated on save/rename/delete. */
const CONTENT_TTL_MS = 60_000

const listingCache = new Map<string, { at: number; data: RepoDirectoryListingDto }>()
const inflightListings = new Map<string, Promise<RepoDirectoryListingDto>>()
const contentCache = new Map<string, { at: number; data: RepoReadFileDto }>()
const inflightReads = new Map<string, Promise<RepoReadFileDto>>()

function clearListingCache(): void {
  listingCache.clear()
}

class AdminFileManagerService {
  // GET /api/v1/admin/files/meta — repo identity + branch + configured
  async getMeta(): Promise<RepoMetaDto> {
    const response = await apiClient.get<RepoMetaDto>('/api/v1/admin/files/meta')
    return response.data
  }

  // GET /api/v1/admin/files/overview — aggregated page-mount payload
  // (meta + status always; branches / recent commits / token state on
  // request). One round trip instead of up to five.
  async getOverview(opts?: {
    branches?: boolean
    log?: number
    git?: boolean
  }): Promise<{
    meta: RepoMetaDto
    status: GitStatusDto
    branches: string[]
    commits: GitCommitInfoDto[]
    git?: GitHubConfigDto
  }> {
    const response = await apiClient.get<{
      meta: RepoMetaDto
      status: GitStatusDto
      branches: string[]
      commits: GitCommitInfoDto[]
      git?: GitHubConfigDto
    }>('/api/v1/admin/files/overview', {
      params: {
        ...(opts?.branches ? { branches: '1' } : {}),
        ...(opts?.log ? { log: String(opts.log) } : {}),
        ...(opts?.git ? { git: '1' } : {}),
      },
    })
    return response.data
  }

  // GET /api/v1/admin/files?path=packages — list a folder ('' = repo root).
  // Short-TTL client cache: back-navigation (Files ⇄ Git ⇄ editor) resolves
  // instantly without refetching. Cleared on every mutation below.
  async listFiles(dir: string): Promise<RepoDirectoryListingDto> {
    const hit = listingCache.get(dir)
    if (hit && Date.now() - hit.at < LISTING_TTL_MS) return hit.data
    if (inflightListings.has(dir)) return inflightListings.get(dir) as Promise<RepoDirectoryListingDto>
    const req = apiClient
      .get<RepoDirectoryListingDto>('/api/v1/admin/files', {
        params: { path: dir },
      })
      .then((response) => {
        listingCache.set(dir, { at: Date.now(), data: response.data })
        return response.data
      })
      .finally(() => {
        inflightListings.delete(dir)
      })
    inflightListings.set(dir, req)
    return req
  }

  // GET /api/v1/admin/files/tree — recursive index of every file/folder
  async getTree(): Promise<{ path: string; entries: RepoTreeNodeDto[] }> {
    const response = await apiClient.get<{ path: string; entries: RepoTreeNodeDto[] }>(
      '/api/v1/admin/files/tree',
    )
    return response.data
  }

  // GET /api/v1/admin/files/content?path=README.md — read a file.
  // Consults the prefetch cache first (hover-prefetched rows open instantly).
  async getFileContent(path: string): Promise<RepoReadFileDto> {
    const hit = contentCache.get(path)
    if (hit && Date.now() - hit.at < CONTENT_TTL_MS) return hit.data
    if (inflightReads.has(path)) return inflightReads.get(path) as Promise<RepoReadFileDto>
    const req = apiClient
      .get<RepoReadFileDto>('/api/v1/admin/files/content', { params: { path } })
      .then((response) => {
        contentCache.set(path, { at: Date.now(), data: response.data })
        return response.data
      })
      .finally(() => {
        inflightReads.delete(path)
      })
    inflightReads.set(path, req)
    return req
  }

  /**
   * Best-effort prefetch for hover/focus intent — warms the content cache so
   * a subsequent tap opens the editor with zero wait. Never throws; shares
   * in-flight requests with getFileContent.
   */
  prefetchFileContent(path: string): void {
    const hit = contentCache.get(path)
    if (hit && Date.now() - hit.at < CONTENT_TTL_MS) return
    if (inflightReads.has(path)) return
    void this.getFileContent(path).catch(() => {
      // Prefetch is advisory — real opens surface their own errors.
    })
  }

  // POST /api/v1/admin/files — create a file or folder (working tree only)
  async createFileEntry(
    path: string,
    type: 'file' | 'folder',
    content = '',
  ): Promise<RepoMutationResultDto> {
    const response = await apiClient.post<RepoMutationResultDto>(
      '/api/v1/admin/files',
      { path, type, content },
    )
    clearListingCache()
    return response.data
  }

  // PUT /api/v1/admin/files — overwrite a file (working tree only)
  async saveFile(path: string, content: string): Promise<RepoMutationResultDto> {
    const response = await apiClient.put<RepoMutationResultDto>(
      '/api/v1/admin/files',
      { path, content },
    )
    clearListingCache()
    contentCache.delete(path)
    return response.data
  }

  // PUT /api/v1/admin/files/rename — move a file or folder (working tree only)
  async renameFileEntry(from: string, to: string): Promise<RepoMutationResultDto> {
    const response = await apiClient.put<RepoMutationResultDto>(
      '/api/v1/admin/files/rename',
      { from, to },
    )
    clearListingCache()
    contentCache.delete(from)
    contentCache.delete(to)
    return response.data
  }

  // DELETE /api/v1/admin/files?path=foo.ts — delete a file or folder
  async deleteFileEntry(path: string): Promise<RepoMutationResultDto> {
    const response = await apiClient.delete<RepoMutationResultDto>(
      '/api/v1/admin/files',
      { params: { path } },
    )
    clearListingCache()
    contentCache.delete(path)
    return response.data
  }

  // ── Git routes ───────────────────────────────────────────────────────────────

  // GET /api/v1/admin/files/git/status — branch, upstream, ahead/behind, changes
  async getGitStatus(): Promise<GitStatusDto> {
    const response = await apiClient.get<GitStatusDto>('/api/v1/admin/files/git/status')
    return response.data
  }

  // GET /api/v1/admin/files/git/diff?path=a.ts&staged=1 — unified diff
  async getGitDiff(path: string, staged: boolean): Promise<{ path: string; staged: boolean; diff: string }> {
    const response = await apiClient.get<{ path: string; staged: boolean; diff: string }>(
      '/api/v1/admin/files/git/diff',
      { params: { path, staged: staged ? '1' : '0' } },
    )
    return response.data
  }

  // POST /api/v1/admin/files/git/stage — stage paths (all when empty)
  async gitStage(paths: string[] = []): Promise<{ ok: boolean }> {
    const response = await apiClient.post<{ ok: boolean }>(
      '/api/v1/admin/files/git/stage',
      { paths },
    )
    return response.data
  }

  // POST /api/v1/admin/files/git/unstage — unstage paths (all when empty)
  async gitUnstage(paths: string[] = []): Promise<{ ok: boolean }> {
    const response = await apiClient.post<{ ok: boolean }>(
      '/api/v1/admin/files/git/unstage',
      { paths },
    )
    return response.data
  }

  // POST /api/v1/admin/files/git/commit — commit the staged changes as the
  // deployment's stored GitHub user (set once via the Git page).
  async gitCommit(message: string): Promise<{ ok: boolean; sha?: string; author?: GitHubIdentityDto }> {
    const response = await apiClient.post<{ ok: boolean; sha?: string; author?: GitHubIdentityDto }>(
      '/api/v1/admin/files/git/commit',
      { message },
    )
    return response.data
  }

  // POST /api/v1/admin/files/git/identity — verify a classic GitHub PAT
  // (ghp_…), store it as the single global deployment token on the server, and
  // return the account's identity. Connects the whole bot: /push, /installer,
  // /update and this Git page all use it from now on.
  async gitIdentity(token: string): Promise<GitHubIdentityDto> {
    const response = await apiClient.post<GitHubIdentityDto>(
      '/api/v1/admin/files/git/identity',
      { token },
    )
    return response.data
  }

  // GET /api/v1/admin/files/git/config — the stored global GitHub token's
  // status + identity (used to restore the connected state on page load).
  async getGitConfig(): Promise<GitHubConfigDto> {
    const response = await apiClient.get<GitHubConfigDto>(
      '/api/v1/admin/files/git/config',
    )
    return response.data
  }

  // DELETE /api/v1/admin/files/git/config — disconnect the global GitHub token.
  async clearGitConfig(): Promise<{ ok: boolean }> {
    const response = await apiClient.delete<{ ok: boolean }>(
      '/api/v1/admin/files/git/config',
    )
    return response.data
  }

  // POST /api/v1/admin/files/git/push — push unpushed commits directly to the
  // repo's default branch (main); authenticated with the stored global token.
  async gitPush(): Promise<{ ok: boolean; message?: string; author?: string | null }> {
    const response = await apiClient.post<{ ok: boolean; message?: string; author?: string | null }>(
      '/api/v1/admin/files/git/push',
      {},
    )
    return response.data
  }

  // POST /api/v1/admin/files/git/pull — pull the current branch from upstream
  async gitPull(): Promise<{ ok: boolean; message?: string }> {
    const response = await apiClient.post<{ ok: boolean; message?: string }>(
      '/api/v1/admin/files/git/pull',
    )
    return response.data
  }

  // GET /api/v1/admin/files/git/log — recent commit history
  async getGitLog(limit = 15): Promise<GitCommitInfoDto[]> {
    const response = await apiClient.get<{ commits: GitCommitInfoDto[] }>(
      '/api/v1/admin/files/git/log',
      { params: { limit } },
    )
    return response.data.commits
  }

  // GET /api/v1/admin/files/git/branches — local branch names
  async getGitBranches(): Promise<string[]> {
    const response = await apiClient.get<{ branches: string[] }>(
      '/api/v1/admin/files/git/branches',
    )
    return response.data.branches
  }

  // POST /api/v1/admin/files/git/checkout — switch to a local branch
  async gitCheckout(branch: string): Promise<{ ok: boolean }> {
    const response = await apiClient.post<{ ok: boolean }>(
      '/api/v1/admin/files/git/checkout',
      { branch },
    )
    return response.data
  }

  // POST /api/v1/admin/files/git/discard — discard working-tree changes
  async gitDiscard(paths: string[]): Promise<{ ok: boolean }> {
    const response = await apiClient.post<{ ok: boolean }>(
      '/api/v1/admin/files/git/discard',
      { paths },
    )
    return response.data
  }

  // POST /api/v1/admin/files/git/branches — create + switch to a new branch
  async gitCreateBranch(name: string): Promise<{ ok: boolean }> {
    const response = await apiClient.post<{ ok: boolean }>(
      '/api/v1/admin/files/git/branches',
      { name },
    )
    return response.data
  }
}

export const adminFileManagerService = new AdminFileManagerService()