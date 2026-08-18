/**
 * Fork Update Lib — safely merges upstream changes into a user's fork.
 *
 * The /update command lets someone running a fork of the main repository pull
 * the latest features, improvements, and fixes from upstream into their OWN
 * fork — without ever clobbering their custom commands, APIs, configuration, or
 * other locally-modified files.
 *
 * Why a git-merge-by-API instead of `git merge`?
 *   Render and Railway deploy from git but typically do NOT ship a .git
 *   checkout (or git push credentials) in the runtime container, so a local
 *   merge/push is unreliable there. Everything here goes through the GitHub
 *   REST API (the same strategy as github-contents.lib.ts / /installer), so the
 *   update works on managed hosts out of the box.
 *
 * ── The three-way merge ─────────────────────────────────────────────────────
 *   base      = merge-base commit (last commit shared by fork HEAD and upstream HEAD)
 *   upstream  = upstream default branch HEAD
 *   fork      = fork default branch HEAD
 *
 *   Every tracked path is classified by comparing its blob SHA across the three
 *   trees (this is a real three-way merge, not a naive overwrite):
 *
 *     upstream changed, fork unchanged  →  update (take upstream)
 *     new upstream file                 →  add    (take upstream)
 *     upstream removed, fork unchanged  →  delete (apply upstream removal)
 *     fork modified, upstream unchanged →  preserve (user's change wins)
 *     fork-created file                 →  preserve (user-created file wins)
 *     fork deleted, upstream unchanged  →  preserve (user's deletion wins)
 *     changed on BOTH sides             →  conflict → preserve user's copy + report
 *
 *   A conflict never auto-overwrites the user's file — the fork keeps the
 *   user's version and the summary tells them which files need manual attention.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────
 *   * Before any change, a backup branch (refs/heads/catbot-update-backup-<ts>)
 *     is created pointing at the fork's pre-update HEAD — a one-click restore
 *     point that also serves as the rollback target if the update fails midway.
 *   * If the update creates a commit but the branch fast-forward fails, the
 *     branch ref is force-returned to the pre-update HEAD (restore).
 *   * Environment/secret/config files (.env, .env.*, *.pem/*.key/...) are never
 *     overwritten or deleted even if upstream touched them. Database data,
 *     credentials, and session state live outside the git tree entirely, so
 *     they are untouched by design.
 *   * The fork HEAD is never force-rewritten during a normal update — the new
 *     commit is created on top of the current HEAD and the ref fast-forwards.
 */

import type { AxiosInstance } from 'axios';
import axios from 'axios';
import {
  GitHubApiError,
  getDefaultBranch,
  type GitHubConfig,
} from './github-contents.lib.js';

// ── Constants ────────────────────────────────────────────────────────────────

/** The canonical upstream (main) repository that forks sync from. */
export const UPSTREAM_OWNER = 'ajirodesu';
export const UPSTREAM_REPO = 'Persian-Bot';
export const UPSTREAM_FULL = `${UPSTREAM_OWNER}/${UPSTREAM_REPO}`;

/** How many upstream blobs are fetched in parallel while applying an update. */
const FETCH_CONCURRENCY = 6;

/**
 * Paths that are NEVER overwritten or deleted by an update. Local env overrides
 * and secret material are gitignored so they normally never appear in the
 * trees, but this is a last line of defence in case a fork tracks them.
 * `.env.example` is a tracked template and is intentionally NOT protected.
 */
const PROTECTED_PATH_PATTERNS: ReadonlyArray<{ test(path: string): boolean }> = [
  { test: (p) => /(^|\/)\.env(?!\.example)(\.|$)/i.test(p) },
  { test: (p) => /(^|\/)[^/]+\.(pem|key|p12|pfx|crt)$/i.test(p) },
];

// ── Public types ─────────────────────────────────────────────────────────────

/** A single path → git blob SHA entry pulled from a recursive tree. */
export type TreeEntry = { sha: string };

/** Map of repo-relative path → blob SHA for one ref. */
export type TreeMap = Map<string, TreeEntry>;

export type ForkPlanAction =
  | 'add'
  | 'update'
  | 'delete'
  | 'preserve'
  | 'conflict';

export interface ForkPlanItem {
  /** Repo-relative path, e.g. `packages/cat-bot/src/app/commands/ping.ts`. */
  path: string;
  action: ForkPlanAction;
  /** Human-readable reason shown in the summary. */
  reason: string;
  /** Upstream blob SHA for add/update items — used to fetch content when applying. */
  sha?: string | undefined;
}

export interface ForkUpdatePlan {
  fork: { owner: string; repo: string };
  upstream: { owner: string; repo: string };
  forkBranch: string;
  upstreamBranch: string;
  mergeBaseSha: string;
  forkHeadSha: string;
  upstreamHeadSha: string;
  /** Items to apply (add / update / delete). */
  changes: ForkPlanItem[];
  /** User-created or user-modified files kept untouched. */
  preserved: ForkPlanItem[];
  /** Files changed on both sides — kept as the user's version, needs manual attention. */
  conflicts: ForkPlanItem[];
  /** True when the fork is already up to date with upstream. */
  upToDate: boolean;
}

export interface ApplyForkUpdateResult {
  commitSha: string;
  commitUrl: string;
  /** Backup branch created before the update, pointing at the pre-update HEAD. */
  backupBranch: string;
  /** SHA that a rollback would force the fork branch back to. */
  rollbackSha: string;
}

// ── Protected-path helper ────────────────────────────────────────────────────

/** True when `path` must never be overwritten/deleted by an update. */
export function isProtectedPath(path: string): boolean {
  return PROTECTED_PATH_PATTERNS.some((p) => p.test(path));
}

// ── Three-way merge classifier ───────────────────────────────────────────────

/**
 * Classifies every path across the three trees (merge base / fork / upstream)
 * into a merge plan. Pure and synchronous — the whole safety model of /update
 * lives here, so it is unit-tested independently of the network.
 */
export function classifyTreeChange(
  baseTree: TreeMap,
  forkTree: TreeMap,
  upstreamTree: TreeMap,
): { changes: ForkPlanItem[]; preserved: ForkPlanItem[]; conflicts: ForkPlanItem[] } {
  const paths = new Set([
    ...baseTree.keys(),
    ...forkTree.keys(),
    ...upstreamTree.keys(),
  ]);

  const changes: ForkPlanItem[] = [];
  const preserved: ForkPlanItem[] = [];
  const conflicts: ForkPlanItem[] = [];

  for (const path of paths) {
    const baseSha = baseTree.get(path)?.sha;
    const forkSha = forkTree.get(path)?.sha;
    const upSha = upstreamTree.get(path)?.sha;
    const inBase = baseSha !== undefined;
    const inFork = forkSha !== undefined;
    const inUp = upSha !== undefined;

    let action: ForkPlanAction;
    let reason: string;
    let sha: string | undefined;

    if (!inUp) {
      // Path does not exist upstream.
      if (!inFork) continue; // in base only — removed on both sides, nothing to do
      if (!inBase) {
        action = 'preserve';
        reason = 'User-created file — kept untouched.';
      } else if (forkSha === baseSha) {
        action = 'delete';
        reason = 'Removed upstream; unchanged in your fork.';
      } else {
        action = 'conflict';
        reason = 'Removed upstream but modified in your fork — kept as yours.';
      }
    } else if (!inFork) {
      // Exists upstream, absent in fork.
      if (!inBase) {
        action = 'add';
        reason = 'New in upstream.';
        sha = upSha;
      } else if (upSha === baseSha) {
        action = 'preserve';
        reason = 'Deleted in your fork; unchanged upstream — kept deleted.';
      } else {
        action = 'conflict';
        reason = 'Modified upstream but deleted in your fork — kept deleted.';
      }
    } else if (upSha === forkSha) {
      continue; // identical in upstream and fork — nothing to do
    } else if (!inBase) {
      action = 'conflict';
      reason =
        'Added by both upstream and your fork with different content — kept as yours.';
    } else if (upSha === baseSha) {
      action = 'preserve';
      reason = 'Modified in your fork; unchanged upstream — kept as yours.';
    } else if (forkSha === baseSha) {
      action = 'update';
      reason = 'Updated upstream; unchanged in your fork.';
      sha = upSha;
    } else {
      action = 'conflict';
      reason = 'Modified by both upstream and your fork — kept as yours.';
    }

    // Never touch protected configuration regardless of what upstream did.
    if (
      (action === 'add' || action === 'update' || action === 'delete') &&
      isProtectedPath(path)
    ) {
      action = 'preserve';
      reason = 'Protected configuration file — never overwritten.';
      sha = undefined;
    }

    const item: ForkPlanItem = {
      path,
      action,
      reason,
      ...(sha !== undefined ? { sha } : {}),
    };

    if (action === 'add' || action === 'update' || action === 'delete') {
      changes.push(item);
    } else if (action === 'conflict') {
      conflicts.push(item);
    } else {
      preserved.push(item);
    }
  }

  return { changes, preserved, conflicts };
}

// ── GitHub API plumbing ──────────────────────────────────────────────────────

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cat-bot',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

function createApi(baseURL: string, token?: string): AxiosInstance {
  return axios.create({ baseURL, headers: authHeaders(token), timeout: 60_000 });
}

/** Normalizes an unknown failure into a GitHubApiError (passes ours through). */
function toGitHubError(err: unknown): GitHubApiError {
  if (err instanceof GitHubApiError) return err;
  if (axios.isAxiosError(err)) {
    const status =
      typeof err.response?.status === 'number' ? err.response.status : 502;
    const detail = (
      (err.response?.data as { message?: unknown } | undefined)?.message as
        | string
        | undefined
    ) ?? err.message;
    return new GitHubApiError(status, `GitHub API ${status}: ${detail}`);
  }
  return new GitHubApiError(
    502,
    err instanceof Error ? err.message : String(err),
  );
}

/** Attaches context to network failures; our own GitHubApiErrors pass through. */
function withContext(err: unknown, context: string): GitHubApiError {
  if (err instanceof GitHubApiError) return err;
  return new GitHubApiError(502, `${context} — ${toGitHubError(err).message}`);
}

/** The upstream repo's default branch (public read; defaults to `main`). */
async function getPublicDefaultBranch(
  api: AxiosInstance,
  owner: string,
  repo: string,
): Promise<string> {
  try {
    // NOTE: absolute URL without a trailing slash — see getDefaultBranch() in
    // github-contents.lib.ts for why a trailing slash 404s.
    const res = await api.get(`https://api.github.com/repos/${owner}/${repo}`);
    const branch = res.data?.default_branch;
    return typeof branch === 'string' && branch !== '' ? branch : 'main';
  } catch {
    return 'main';
  }
}

/** Resolves a branch ref to its HEAD commit SHA. */
async function getBranchHeadSha(
  api: AxiosInstance,
  branch: string,
): Promise<string> {
  const res = await api.get(`/git/ref/heads/${encodeURIComponent(branch)}`);
  const sha = res.data?.object?.sha;
  if (typeof sha !== 'string' || sha === '') {
    throw new GitHubApiError(502, `Could not resolve branch "${branch}" on GitHub.`);
  }
  return sha;
}

/**
 * Builds a path → blob SHA map for a whole commit tree. Recurses into subtrees
 * when GitHub truncates the recursive response (large repositories).
 */
async function getTreeMap(api: AxiosInstance, treeSha: string): Promise<TreeMap> {
  const map: TreeMap = new Map();
  await collectTree(api, treeSha, map, '');
  return map;
}

async function collectTree(
  api: AxiosInstance,
  treeSha: string,
  map: TreeMap,
  prefix: string,
): Promise<void> {
  const res = await api.get(`/git/trees/${encodeURIComponent(treeSha)}`, {
    params: { recursive: prefix === '' ? 1 : 0 },
  });
  const tree: Array<{ path?: unknown; type?: unknown; sha?: unknown }> =
    Array.isArray(res.data?.tree)
      ? (res.data.tree as Array<{ path?: unknown; type?: unknown; sha?: unknown }>)
      : [];
  const truncated = res.data?.truncated === true;
  const subtrees: Array<{ path: string; sha: string }> = [];

  for (const entry of tree) {
    if (entry.type === 'tree') {
      if (typeof entry.path === 'string' && typeof entry.sha === 'string') {
        subtrees.push({ path: entry.path, sha: entry.sha });
      }
      continue;
    }
    if (entry.type !== 'blob') continue;
    if (typeof entry.path !== 'string' || typeof entry.sha !== 'string') continue;
    map.set(prefix ? `${prefix}/${entry.path}` : entry.path, { sha: entry.sha });
  }

  if (truncated) {
    for (const sub of subtrees) {
      await collectTree(api, sub.sha, map, sub.path);
    }
  }
}

// ── Merge-base resolution ────────────────────────────────────────────────────

interface MergeBaseResult {
  sha: string;
  /** Commits in upstream that are not in the fork (the pending update). */
  upstreamAhead: number;
  /** Commits in the fork that are not in upstream (the user's local work). */
  forkAhead: number;
}

/**
 * Finds the last commit shared by the fork and upstream branches. Primary path
 * uses GitHub's compare API with a cross-fork ref (`owner:branch`), which works
 * for any two repos in the same fork network. Falls back to walking both commit
 * lists until a shared SHA is found.
 */
async function findMergeBase(
  forkApi: AxiosInstance,
  forkOwner: string,
  forkRepo: string,
  forkBranch: string,
  upstreamApi: AxiosInstance,
  upstreamOwner: string,
  upstreamRepo: string,
  upstreamBranch: string,
): Promise<MergeBaseResult> {
  try {
    const res = await forkApi.get(
      `/compare/${encodeURIComponent(forkBranch)}...${encodeURIComponent(
        `${upstreamOwner}:${upstreamBranch}`,
      )}`,
    );
    const mergeBase = res.data?.merge_base_commit?.sha;
    if (typeof mergeBase === 'string' && mergeBase !== '') {
      return {
        sha: mergeBase,
        upstreamAhead:
          typeof res.data?.ahead_by === 'number'
            ? (res.data.ahead_by as number)
            : 0,
        forkAhead:
          typeof res.data?.behind_by === 'number'
            ? (res.data.behind_by as number)
            : 0,
      };
    }
  } catch {
    // Fall back to the commit-list intersection below.
  }
  return findMergeBaseByCommits(
    forkApi,
    forkBranch,
    upstreamApi,
    upstreamBranch,
  );
}

async function findMergeBaseByCommits(
  forkApi: AxiosInstance,
  forkBranch: string,
  upstreamApi: AxiosInstance,
  upstreamBranch: string,
): Promise<MergeBaseResult> {
  const upstreamShas = new Set<string>();
  let page = 1;
  for (let i = 0; i < 8; i += 1) {
    const res = await upstreamApi.get('/commits', {
      params: { sha: upstreamBranch, per_page: 100, page },
    });
    const commits: Array<{ sha?: unknown }> = Array.isArray(res.data)
      ? (res.data as Array<{ sha?: unknown }>)
      : [];
    if (commits.length === 0) break;
    for (const c of commits) if (typeof c.sha === 'string') upstreamShas.add(c.sha);
    if (commits.length < 100) break;
    page += 1;
  }

  page = 1;
  let found = '';
  let forkCount = 0;
  for (let i = 0; i < 100; i += 1) {
    const res = await forkApi.get('/commits', {
      params: { sha: forkBranch, per_page: 100, page },
    });
    const commits: Array<{ sha?: unknown }> = Array.isArray(res.data)
      ? (res.data as Array<{ sha?: unknown }>)
      : [];
    if (commits.length === 0) break;
    forkCount += commits.length;
    const match = commits.find(
      (c) => typeof c.sha === 'string' && upstreamShas.has(c.sha),
    );
    if (match && typeof match.sha === 'string') {
      found = match.sha;
      break;
    }
    if (commits.length < 100) break;
    page += 1;
  }

  if (!found) {
    throw new GitHubApiError(
      422,
      `Could not find a common ancestor between your fork and ${UPSTREAM_FULL}. This usually means the repository is not actually a fork of ${UPSTREAM_FULL}, or the histories are unrelated.`,
    );
  }
  return { sha: found, upstreamAhead: 0, forkAhead: forkCount };
}

// ── Plan computation ─────────────────────────────────────────────────────────

/**
 * Compares the configured fork against the upstream repository and computes a
 * full three-way merge plan. Read-only — nothing is changed on GitHub.
 */
export async function planForkUpdate(config: GitHubConfig): Promise<ForkUpdatePlan> {
  if (
    config.owner.toLowerCase() === UPSTREAM_OWNER.toLowerCase() &&
    config.repo.toLowerCase() === UPSTREAM_REPO.toLowerCase()
  ) {
    throw new GitHubApiError(
      400,
      `GITHUB_REPO_OWNER / GITHUB_REPO_NAME point at the main repository (${UPSTREAM_FULL}), not a fork. Point them at your fork to use this command.`,
    );
  }

  const forkApi = createApi(
    `https://api.github.com/repos/${config.owner}/${config.repo}`,
    config.token,
  );
  // Upstream is public — read without auth so a token scoped only to the fork still works.
  const upstreamApi = createApi(
    `https://api.github.com/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}`,
  );

  const upstreamBranch = await getPublicDefaultBranch(
    upstreamApi,
    UPSTREAM_OWNER,
    UPSTREAM_REPO,
  );
  const forkBranch = await getDefaultBranch(config);

  const [forkHeadSha, upstreamHeadSha] = await Promise.all([
    getBranchHeadSha(forkApi, forkBranch),
    getBranchHeadSha(upstreamApi, upstreamBranch),
  ]);

  const mergeBase = await findMergeBase(
    forkApi,
    config.owner,
    config.repo,
    forkBranch,
    upstreamApi,
    UPSTREAM_OWNER,
    UPSTREAM_REPO,
    upstreamBranch,
  );

  const [baseTree, forkTree, upstreamTree] = await Promise.all([
    getTreeMap(upstreamApi, mergeBase.sha),
    getTreeMap(forkApi, forkHeadSha),
    getTreeMap(upstreamApi, upstreamHeadSha),
  ]);

  const { changes, preserved, conflicts } = classifyTreeChange(
    baseTree,
    forkTree,
    upstreamTree,
  );

  return {
    fork: { owner: config.owner, repo: config.repo },
    upstream: { owner: UPSTREAM_OWNER, repo: UPSTREAM_REPO },
    forkBranch,
    upstreamBranch,
    mergeBaseSha: mergeBase.sha,
    forkHeadSha,
    upstreamHeadSha,
    changes,
    preserved,
    conflicts,
    upToDate: changes.length === 0,
  };
}

// ── Apply + rollback ─────────────────────────────────────────────────────────

/** Runs `fn` over `items` with at most `limit` concurrent in-flight calls. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Reads an upstream blob's base64 content. Tries the authenticated read first
 * (a classic PAT often has access to the upstream network); falls back to the
 * public, unauthenticated read so tokens scoped only to the fork still work.
 */
async function fetchBlobBase64(
  upstreamApiAuth: AxiosInstance,
  upstreamApiPublic: AxiosInstance,
  sha: string,
): Promise<string> {
  try {
    const res = await upstreamApiAuth.get(`/git/blobs/${encodeURIComponent(sha)}`);
    if (typeof res.data?.content === 'string') return res.data.content as string;
  } catch {
    // Fall through to the public read below.
  }
  const res = await upstreamApiPublic.get(`/git/blobs/${encodeURIComponent(sha)}`);
  if (typeof res.data?.content !== 'string') {
    throw new GitHubApiError(502, `GitHub did not return content for blob ${sha}.`);
  }
  return res.data.content as string;
}

/** Force-returns the fork branch ref to a target SHA (used only for rollback). */
async function tryRollback(
  api: AxiosInstance,
  branch: string,
  targetSha: string,
): Promise<boolean> {
  try {
    await api.patch(`/git/refs/heads/${encodeURIComponent(branch)}`, {
      sha: targetSha,
      force: true,
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Applies a computed plan to the fork as ONE commit:
 *   1. Creates a backup branch pointing at the pre-update HEAD (restore point).
 *   2. Uploads upstream content for add/update files as new blobs.
 *   3. Builds a new tree (deletes use `sha: null` entries), commits it on top of
 *      the current HEAD, and fast-forwards the branch ref.
 *   4. If anything fails AFTER the commit exists, force-restores the branch to
 *      the pre-update HEAD so the fork returns to its previous state.
 */
export async function applyForkUpdate(
  config: GitHubConfig,
  plan: ForkUpdatePlan,
  commitMessage?: string,
): Promise<ApplyForkUpdateResult> {
  const forkApi = createApi(
    `https://api.github.com/repos/${config.owner}/${config.repo}`,
    config.token,
  );
  const upstreamApiAuth = createApi(
    `https://api.github.com/repos/${plan.upstream.owner}/${plan.upstream.repo}`,
    config.token,
  );
  const upstreamApiPublic = createApi(
    `https://api.github.com/repos/${plan.upstream.owner}/${plan.upstream.repo}`,
  );

  const branch = plan.forkBranch;
  const timestamp = new Date();
  const backupBranch = `catbot-update-backup-${timestamp
    .toISOString()
    .replace(/[:.]/g, '-')}`;
  const backupRef = `refs/heads/${backupBranch}`;
  const message =
    commitMessage?.trim() ||
    `chore: sync fork with ${UPSTREAM_FULL} (Cat-Bot auto-update)`;

  // ── 0. Backup / restore point ─────────────────────────────────────────────
  try {
    await forkApi.post('/git/refs', { ref: backupRef, sha: plan.forkHeadSha });
  } catch (err) {
    throw withContext(
      err,
      'Failed to create the pre-update backup branch — update aborted, nothing was changed.',
    );
  }

  const contentChanges = plan.changes.filter(
    (c) => c.action === 'add' || c.action === 'update',
  );
  const deleteChanges = plan.changes.filter((c) => c.action === 'delete');

  let newCommitSha: string | null = null;
  try {
    // ── 1. Base tree of the fork's current HEAD ─────────────────────────────
    const headRes = await forkApi.get(
      `/git/commits/${encodeURIComponent(plan.forkHeadSha)}`,
    );
    const baseTreeSha = headRes.data?.tree?.sha;
    if (typeof baseTreeSha !== 'string') {
      throw new GitHubApiError(502, 'Could not resolve the fork head tree.');
    }

    // ── 2. Upload upstream content as blobs on the fork ─────────────────────
    const uploaded = await mapWithConcurrency(
      contentChanges,
      FETCH_CONCURRENCY,
      async (item) => {
        if (!item.sha) {
          throw new GitHubApiError(500, `Missing upstream blob SHA for ${item.path}.`);
        }
        const base64 = await fetchBlobBase64(
          upstreamApiAuth,
          upstreamApiPublic,
          item.sha,
        );
        const blobRes = await forkApi.post('/git/blobs', {
          content: base64,
          encoding: 'base64',
        });
        const sha = blobRes.data?.sha;
        if (typeof sha !== 'string') {
          throw new GitHubApiError(502, `GitHub did not return a blob SHA for ${item.path}.`);
        }
        return { path: item.path, sha };
      },
    );

    // ── 3. New tree ─────────────────────────────────────────────────────────
    const tree: Array<Record<string, unknown>> = [
      ...uploaded.map((u) => ({
        path: u.path,
        mode: '100644',
        type: 'blob',
        sha: u.sha,
      })),
      ...deleteChanges.map((d) => ({
        path: d.path,
        mode: '100644',
        type: 'blob',
        sha: null,
      })),
    ];

    const treeRes = await forkApi.post('/git/trees', { base_tree: baseTreeSha, tree });
    const newTreeSha = treeRes.data?.sha;
    if (typeof newTreeSha !== 'string') {
      throw new GitHubApiError(502, 'GitHub did not return the new tree SHA.');
    }

    // ── 4. Commit ───────────────────────────────────────────────────────────
    const commitRes = await forkApi.post('/git/commits', {
      message,
      tree: newTreeSha,
      parents: [plan.forkHeadSha],
    });
    if (typeof commitRes.data?.sha !== 'string') {
      throw new GitHubApiError(502, 'GitHub did not return the update commit SHA.');
    }
    newCommitSha = commitRes.data.sha as string;

    // ── 5. Fast-forward the branch ref ──────────────────────────────────────
    await forkApi.patch(`/git/refs/heads/${encodeURIComponent(branch)}`, {
      sha: newCommitSha,
      force: false,
    });
  } catch (err) {
    const baseMessage = err instanceof Error ? err.message : String(err);
    if (newCommitSha !== null) {
      const rolledBack = await tryRollback(forkApi, branch, plan.forkHeadSha);
      if (rolledBack) {
        throw new GitHubApiError(
          500,
          `The update failed midway (${baseMessage}) — your fork was rolled back to its previous state.`,
        );
      }
      throw new GitHubApiError(
        500,
        `The update failed (${baseMessage}) and the automatic rollback also failed. Restore your fork to the \`${backupBranch}\` branch manually to recover the previous state.`,
      );
    }
    throw withContext(err, 'The update failed — no changes were applied.');
  }

  return {
    commitSha: newCommitSha,
    commitUrl: `https://github.com/${config.owner}/${config.repo}/commit/${newCommitSha}`,
    backupBranch,
    rollbackSha: plan.forkHeadSha,
  };
}
