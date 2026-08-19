/**
 * Local Git Lib — real git integration for the Admin File Manager + Git tab.
 *
 * The File Manager edits a real git checkout on disk (ADMIN_REPO_PATH, or the
 * checkout that contains this process). Saving a file writes to the working
 * tree — it NEVER commits or pushes. The Git tab surfaces the working-tree
 * state (status/diff) and drives the explicit, user-triggered stage/commit/push
 * workflow, exactly like Replit's Git panel.
 *
 * Nothing here is mock data: every operation shells out to the `git` binary in
 * the resolved repository root and fails loudly when git rejects it.
 */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { env } from '@/engine/config/env.config.js';
import {
  getBranchTipSha,
  getDefaultBranch,
  getGitHubConfig,
  pushCommitsToGitHub,
  type GitHubCommitFileInput,
  type GitHubCommitInput,
} from './github-contents.lib.js';

// ── Error type ────────────────────────────────────────────────────────────────

export class RepoFileManagerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ── Repository root resolution ────────────────────────────────────────────────

const MAX_PARENT_DEPTH = 12;

/** Walks up from `start` to the nearest directory containing a `.git` entry. */
function findRepoRoot(start: string): string | null {
  let current = start;
  for (let i = 0; i < MAX_PARENT_DEPTH; i += 1) {
    if (existsSync(resolve(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
  return null;
}

/**
 * Resolves the repository root the File Manager operates on. Prefers the
 * ADMIN_REPO_PATH env override; otherwise auto-detects the nearest git checkout
 * walking up from the process working directory. Returns null when unconfigured.
 */
function resolveRepoRoot(): string | null {
  const override = env.ADMIN_REPO_PATH;
  if (override && override.trim() !== '') {
    const root = isAbsolute(override) ? override : resolve(process.cwd(), override);
    if (!existsSync(resolve(root, '.git'))) {
      throw new RepoFileManagerError(
        503,
        `ADMIN_REPO_PATH is set (${root}) but no .git directory was found there`,
      );
    }
    return root;
  }
  return findRepoRoot(process.cwd());
}

/** Returns the repo root or throws a 503 so callers can short-circuit. */
export function getRepoRootOrThrow(): string {
  const root = resolveRepoRoot();
  if (!root) {
    throw new RepoFileManagerError(
      503,
      'No git repository found — set ADMIN_REPO_PATH or run from a git checkout to enable the file manager.',
    );
  }
  return root;
}

// ── Path validation ───────────────────────────────────────────────────────────

/**
 * Normalizes a repository path. Empty input is allowed only for the root
 * listing; every other operation requires a non-empty relative path. Shared by
 * the file-manager and git operations so both agree on what is a legal path.
 */
export function normalizeRepoPath(raw: string, allowRoot = false): string {
  if (typeof raw !== 'string') {
    throw new RepoFileManagerError(400, 'Path is required');
  }
  if (raw.includes('\\')) {
    throw new RepoFileManagerError(400, 'Invalid path: use forward slashes');
  }
  const cleaned = raw.replace(/^\/+|\/+$/g, '');
  if (cleaned === '') {
    if (allowRoot) return '';
    throw new RepoFileManagerError(400, 'Path is required');
  }
  const segments = cleaned.split('/');
  if (
    segments.some(
      (seg) => seg === '..' || seg === '.' || seg === '' || seg === '.git',
    )
  ) {
    throw new RepoFileManagerError(400, 'Invalid path');
  }
  return cleaned;
}

/** Rejects names that cannot exist as a single repo entry (name only, no slash). */
export function assertSafeName(name: string): void {
  const hasControlChar = Array.from(name).some(
    (ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127,
  );
  if (
    name === '' ||
    name === '.' ||
    name === '..' ||
    name.includes('/') ||
    name.includes('\\') ||
    hasControlChar
  ) {
    throw new RepoFileManagerError(400, `Invalid name: ${name}`);
  }
}

// ── git command runner ────────────────────────────────────────────────────────

interface GitRunResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs `git` in the repo root. Non-zero exits reject with the git error text. */
function runGit(args: string[]): Promise<string> {
  const root = getRepoRootOrThrow();
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: root,
        env: { ...process.env },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 180_000,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        if (err && err.code !== 0) {
          const detail = (stderr || stdout || '').trim();
          reject(
            new RepoFileManagerError(
              400,
              detail || `git ${args[0] ?? ''} failed (${err.code})`,
            ),
          );
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

/** Non-throwing probe — returns exit code + output for best-effort lookups. */
function runGitProbe(args: string[]): Promise<GitRunResult> {
  const root = getRepoRootOrThrow();
  return new Promise((resolvePromise) => {
    execFile(
      'git',
      args,
      {
        cwd: root,
        env: { ...process.env },
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60_000,
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        resolvePromise({
          stdout,
          stderr,
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        });
      },
    );
  });
}

const NO_QUOTE_CONFIG = ['-c', 'core.quotepath=false'];

// ── Public types ──────────────────────────────────────────────────────────────

export type GitChangeStatus =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked';

export interface GitChange {
  path: string;
  status: GitChangeStatus;
  /** True when the change is present in the index (staged). */
  staged: boolean;
  /** True when the file also has unstaged worktree modifications. */
  hasUnstagedMods: boolean;
}

export interface GitStatus {
  configured: boolean;
  root: string;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  changes: GitChange[];
  stagedCount: number;
  unstagedCount: number;
  clean: boolean;
}

export interface GitCommitInfo {
  sha: string;
  author: string;
  when: string;
  subject: string;
}

export interface GitMeta {
  owner: string;
  repo: string;
  branch: string | null;
}

// ── Status parsing ────────────────────────────────────────────────────────────

function statusKind(x: string, y: string): GitChangeStatus {
  if (x === '?' && y === '?') return 'untracked';
  const letter = x !== ' ' && x !== '?' ? x : y;
  switch (letter) {
    case 'A':
    case 'C':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'M':
    case 'T':
      return 'modified';
    default:
      return 'untracked';
  }
}

/** Parses `git status --porcelain=v1 -z` into structured changes. */
function parsePorcelainChanges(stdout: string): GitChange[] {
  const tokens = stdout.split('\0');
  const changes: GitChange[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const raw = tokens[i];
    if (!raw || raw.length < 3) continue;
    const x = raw[0] ?? ' ';
    const y = raw[1] ?? ' ';
    let path = raw.slice(3);
    // Renames/copies emit a second NUL-terminated field with the destination.
    if ((x === 'R' || x === 'C') && i + 1 < tokens.length) {
      path = tokens[i + 1] ?? path;
      i += 1;
    }
    if (!path || path.startsWith('.git')) continue;
    const staged = x !== ' ' && x !== '?';
    changes.push({
      path,
      status: statusKind(x, y),
      staged,
      hasUnstagedMods: y === 'M' || y === 'D' || y === 'T',
    });
  }
  return changes;
}

/** Parses `git rev-list --left-right --count HEAD...@{upstream}` → [ahead, behind]. */
function parseAheadBehind(stdout: string): { ahead: number; behind: number } {
  const [left = '0', right = '0'] = stdout.trim().split(/\s+/);
  return {
    ahead: Number.parseInt(left, 10) || 0,
    behind: Number.parseInt(right, 10) || 0,
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Repository identity from the origin remote (falls back to env defaults). */
export async function getGitMeta(): Promise<GitMeta> {
  const branch = await getCurrentBranch();
  let owner = env.GITHUB_REPO_OWNER ?? '';
  let repo = env.GITHUB_REPO_NAME ?? '';
  try {
    const url = (await runGit(['remote', 'get-url', 'origin'])).trim();
    const ssh = /^git@([^:]+):([^/]+)\/(.+)\.git$/.exec(url);
    const https = /^https?:\/\/(?:[^@/]+@)?[^/]+\/([^/]+)\/(.+)\.git$/.exec(url);
    if (ssh) {
      owner = ssh[2] ?? owner;
      repo = (ssh[3] ?? repo).replace(/\.git$/, '');
    } else if (https) {
      owner = https[1] ?? owner;
      repo = (https[2] ?? repo).replace(/\.git$/, '');
    }
  } catch {
    // Remote lookup is best-effort; env fallbacks remain.
  }
  return { owner, repo, branch };
}

/** Full working-tree status: branch, upstream, ahead/behind, changed files. */
export async function getGitStatus(): Promise<GitStatus> {
  const root = getRepoRootOrThrow();
  const [porcelain, branch, upstream] = await Promise.all([
    runGit([...NO_QUOTE_CONFIG, 'status', '--porcelain=v1', '-z']),
    getCurrentBranch(),
    getUpstream(),
  ]);
  const aheadBehind = upstream !== null
    ? await getAheadBehind()
    : { ahead: 0, behind: 0 };

  const changes = parsePorcelainChanges(porcelain);
  return {
    configured: true,
    root,
    branch,
    upstream,
    ahead: aheadBehind.ahead,
    behind: aheadBehind.behind,
    changes,
    stagedCount: changes.filter((c) => c.staged).length,
    unstagedCount: changes.filter((c) => !c.staged).length,
    clean: changes.length === 0,
  };
}

/** Current branch name, or a short SHA when HEAD is detached. */
export async function getCurrentBranch(): Promise<string | null> {
  const res = await runGitProbe(['symbolic-ref', '--short', '-q', 'HEAD']);
  if (res.code === 0 && res.stdout.trim() !== '') return res.stdout.trim();
  const head = await runGitProbe(['rev-parse', '--short', 'HEAD']);
  return head.code === 0 ? head.stdout.trim() : null;
}

/** Upstream tracking ref (e.g. `origin/main`) or null when there is none. */
async function getUpstream(): Promise<string | null> {
  const res = await runGitProbe([
    'rev-parse',
    '--abbrev-ref',
    '--symbolic-full-name',
    '@{upstream}',
  ]);
  return res.code === 0 && res.stdout.trim() !== '' ? res.stdout.trim() : null;
}

/** Count of commits the local branch is ahead of / behind its upstream. */
async function getAheadBehind(): Promise<{ ahead: number; behind: number }> {
  const res = await runGitProbe(['rev-list', '--left-right', '--count', 'HEAD...@{upstream}']);
  if (res.code !== 0) return { ahead: 0, behind: 0 };
  return parseAheadBehind(res.stdout);
}

/** Unified diff for a single file. `staged` selects the index vs worktree view. */
export async function getFileDiff(path: string, staged: boolean): Promise<string> {
  const repoPath = normalizeRepoPath(path);
  const args = [...NO_QUOTE_CONFIG, 'diff', ...(staged ? ['--cached'] : []), '--', repoPath];
  const res = await runGitProbe(args);
  if (res.code === 0) return res.stdout;

  // Untracked files have no git diff — synthesize a "new file" diff so the
  // panel can still show the content.
  if (res.stderr.includes('fatal') || res.code !== 0) {
    const fileDiff = await diffForUntracked(repoPath);
    if (fileDiff !== null) return fileDiff;
  }
  throw new RepoFileManagerError(400, res.stderr.trim() || `git diff failed for ${path}`);
}

async function diffForUntracked(repoPath: string): Promise<string | null> {
  const root = getRepoRootOrThrow();
  try {
    const content = await import('node:fs/promises').then((fsp) =>
      fsp.readFile(join(root, ...repoPath.split('/')), 'utf8'),
    );
    const lines = content.split('\n');
    return [
      `diff --git a/${repoPath} b/${repoPath}`,
      'new file mode 100644',
      '--- /dev/null',
      `+++ b/${repoPath}`,
      `@@ -0,0 +1,${lines.length} @@`,
      ...lines.map((line) => `+${line}`),
    ].join('\n');
  } catch {
    return null;
  }
}

/** Best-effort blob SHA for a tracked path (null when untracked or missing). */
export async function getTrackedSha(repoPath: string): Promise<string | null> {
  const path = normalizeRepoPath(repoPath);
  const res = await runGitProbe([...NO_QUOTE_CONFIG, 'rev-parse', '--verify', `HEAD:${path}`]);
  return res.code === 0 ? res.stdout.trim() || null : null;
}

/** Best-effort latest commit touching a path (null when none/unavailable). */
export async function getPathLastCommit(
  repoPath: string,
): Promise<{ message: string; author: string; date: string } | null> {
  const path = normalizeRepoPath(repoPath);
  const res = await runGitProbe([
    ...NO_QUOTE_CONFIG,
    'log',
    '-1',
    '--format=%s%x1f%an%x1f%aI',
    '--',
    path,
  ]);
  if (res.code !== 0) return null;
  const [message = '', author = '', date = ''] = res.stdout.trim().split('\x1f');
  return message === '' ? null : { message, author, date };
}

/** Stages paths (or everything when no paths are given). */
export async function stagePaths(paths: string[]): Promise<void> {
  const normalized = paths.map((p) => normalizeRepoPath(p));
  if (normalized.length === 0) {
    await runGit(['add', '-A']);
  } else {
    await runGit(['add', '--', ...normalized]);
  }
}

/** Unstages paths (or everything when no paths are given). */
export async function unstagePaths(paths: string[]): Promise<void> {
  const normalized = paths.map((p) => normalizeRepoPath(p));
  try {
    if (normalized.length === 0) {
      await runGit(['restore', '--staged', '.']);
    } else {
      await runGit(['restore', '--staged', '--', ...normalized]);
    }
  } catch (err) {
    // Older git versions lack `restore` — fall back to reset.
    if (normalized.length === 0) {
      await runGit(['reset']);
    } else {
      await runGit(['reset', 'HEAD', '--', ...normalized]);
    }
    void err;
  }
}

/**
 * Fallback committer identity used when the server has no git
 * user.name/user.email configured (common on Render/Railway deploys).
 * Override with GIT_COMMITTER_NAME / GIT_COMMITTER_EMAIL env vars.
 */
const FALLBACK_COMMITTER = {
  name: env.GIT_COMMITTER_NAME ?? 'Cat-Bot',
  email: env.GIT_COMMITTER_EMAIL ?? 'cat-bot@localhost',
};

/**
 * Author/committer identity for a commit. The File Manager passes the
 * authenticated GitHub user's real name + email so commits carry the admin's
 * actual GitHub identity instead of the server fallback.
 */
export interface GitCommitterIdentity {
  name: string;
  email: string;
}

/** Runs `git commit`, optionally pinning the author/committer identity. */
async function runCommit(
  message: string,
  identity?: GitCommitterIdentity,
): Promise<{ sha: string }> {
  const args = identity
    ? [
        '-c',
        `user.name=${identity.name}`,
        '-c',
        `user.email=${identity.email}`,
        'commit',
        '-m',
        message,
      ]
    : ['commit', '-m', message];
  try {
    const out = await runGit(args);
    const sha = /^\[[^\]]* ([0-9a-f]+)\]/.exec(out.trim())?.[1] ?? '';
    return { sha };
  } catch (err) {
    if (err instanceof RepoFileManagerError && /nothing to commit/i.test(err.message)) {
      throw new RepoFileManagerError(400, 'Nothing staged to commit');
    }
    throw err;
  }
}

/**
 * Commits the staged changes. When a GitHub identity is supplied it is used as
 * the author/committer (the File Manager passes the authenticated GitHub user);
 * otherwise the repo git config wins and the server fallback is used only when
 * no identity is configured at all. Throws when there is nothing staged.
 */
export async function commitStaged(
  message: string,
  identity?: GitCommitterIdentity,
): Promise<{ sha: string }> {
  const cleanMessage = message.trim();
  if (!cleanMessage) {
    throw new RepoFileManagerError(400, 'Commit message is required');
  }
  try {
    return await runCommit(cleanMessage, identity);
  } catch (err) {
    if (
      err instanceof RepoFileManagerError &&
      /user\.name|user\.email|tell me who you are/i.test(err.message)
    ) {
      // The server has no git identity — commit as the bot instead of failing.
      // User-configured identity (repo/global git config) still wins when present.
      return runCommit(cleanMessage, FALLBACK_COMMITTER);
    }
    throw err;
  }
}

// ── GitHub-API push (the Git tab's Push button) ───────────────────────────────

/**
 * The Git tab commits LOCALLY (git commit). The Push step used to run `git
 * push`, which needs working git credentials on the host — the thing that
 * breaks on Render/Railway (and that made the panel's Push silently fail). It
 * now pushes through the GitHub REST API instead, exactly like /push and
 * /installer (the deployment's single stored GitHub token + GITHUB_REPO_OWNER /
 * GITHUB_REPO_NAME), so a managed host can push without any git credentials.
 *
 * The local unpushed commits are recreated on GitHub via the Git Data API —
 * blobs are content-addressed, so re-uploading a local blob's content yields
 * the SAME SHA on GitHub, and with the original author/committer carried over a
 * linear history is recreated byte-identically (same commit SHAs).
 */

interface LsTreeEntry {
  mode: string;
  type: string;
  sha: string;
}

/** Runs `git` and returns the raw output as a Buffer (for blob content). */
function runGitBuffer(args: string[]): Promise<Buffer> {
  const root = getRepoRootOrThrow();
  return new Promise((resolvePromise, reject) => {
    execFile(
      'git',
      args,
      {
        cwd: root,
        env: { ...process.env },
        maxBuffer: 128 * 1024 * 1024,
        timeout: 180_000,
        windowsHide: true,
        encoding: 'buffer',
      },
      (err, stdout, stderr) => {
        if (err && err.code !== 0) {
          const detail = (stderr || stdout).toString().trim();
          reject(
            new RepoFileManagerError(
              400,
              detail || `git ${args[0] ?? ''} failed (${err.code})`,
            ),
          );
          return;
        }
        resolvePromise(stdout);
      },
    );
  });
}

/** Recursive path → entry map of a commit's TREE (the commit state, not the worktree). */
async function lsTree(ref: string): Promise<Map<string, LsTreeEntry>> {
  const out = await runGit(['ls-tree', '-r', '-z', ref]);
  const map = new Map<string, LsTreeEntry>();
  for (const part of out.split('\0')) {
    if (!part) continue;
    const tab = part.indexOf('\t');
    if (tab === -1) continue;
    const meta = part.slice(0, tab).split(' ');
    const path = part.slice(tab + 1);
    if (meta.length >= 3 && path) {
      map.set(path, {
        mode: meta[0] ?? '100644',
        type: meta[1] ?? 'blob',
        sha: meta[2] ?? '',
      });
    }
  }
  return map;
}

/** Raw content of a git blob object (binary-safe). */
async function catBlob(sha: string): Promise<Buffer> {
  return runGitBuffer(['cat-file', 'blob', sha]);
}

/**
 * Files added/updated vs deleted when moving from `parentTree` to `commitTree`.
 * Recreates exactly the commit's tree on GitHub: entries that changed get their
 * new blob content, paths that vanished become deletions.
 */
async function changedBetween(
  parentTree: Map<string, LsTreeEntry>,
  commitTree: Map<string, LsTreeEntry>,
): Promise<{ files: GitHubCommitFileInput[]; deletions: string[] }> {
  const files: GitHubCommitFileInput[] = [];
  for (const [path, entry] of commitTree) {
    const parent = parentTree.get(path);
    if (parent && parent.sha === entry.sha) continue;
    // Submodules / non-blob entries can't be re-uploaded — leave them alone.
    if (entry.type !== 'blob') continue;
    files.push({ path, content: await catBlob(entry.sha), mode: entry.mode });
  }
  const deletions: string[] = [];
  for (const path of parentTree.keys()) {
    if (!commitTree.has(path)) deletions.push(path);
  }
  return { files, deletions };
}

interface CommitPushInfo {
  message: string;
  author: { name: string; email: string; date: string } | undefined;
  committer: { name: string; email: string; date: string } | undefined;
}

/** Message + author/committer of one local commit (used to recreate it on GitHub). */
async function commitPushInfo(sha: string): Promise<CommitPushInfo> {
  const out = await runGit([
    'show',
    '-s',
    '--format=%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%B',
    sha,
  ]);
  const parts = out.split('\x1f');
  const authorName = parts.shift() ?? '';
  const authorEmail = parts.shift() ?? '';
  const authorDate = parts.shift() ?? '';
  const committerName = parts.shift() ?? '';
  const committerEmail = parts.shift() ?? '';
  const committerDate = parts.shift() ?? '';
  const message = parts.join('\x1f').trim();
  return {
    message: message === '' ? 'push' : message,
    author:
      authorName && authorEmail
        ? { name: authorName, email: authorEmail, date: authorDate }
        : undefined,
    committer:
      committerName && committerEmail
        ? { name: committerName, email: committerEmail, date: committerDate }
        : undefined,
  };
}

/**
 * Builds the API input for every commit in `upstreamRef..HEAD` (oldest first),
 * reproducing each commit's tree by diffing consecutive local trees. Merge
 * commits are linearized onto their first parent (the tree is still exact).
 */
async function collectPushCommits(upstreamRef: string): Promise<GitHubCommitInput[]> {
  const shas = (await runGit(['rev-list', '--reverse', `${upstreamRef}..HEAD`]))
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

  const commits: GitHubCommitInput[] = [];
  let parentTree = await lsTree(upstreamRef);
  for (const sha of shas) {
    const commitTree = await lsTree(sha);
    const { files, deletions } = await changedBetween(parentTree, commitTree);
    const info = await commitPushInfo(sha);
    const input: GitHubCommitInput = {
      message: info.message,
      files,
      deletions,
    };
    if (info.author) input.author = info.author;
    if (info.committer) input.committer = info.committer;
    commits.push(input);
    parentTree = commitTree;
  }
  return commits;
}

/** Updates the remote-tracking ref so the Git tab shows 0 ahead after a push. */
async function tryUpdateTrackingRef(
  remote: string,
  branch: string,
  newSha: string,
): Promise<void> {
  const ref = `refs/remotes/${remote}/${branch}`;
  const current = await runGitProbe(['rev-parse', '--verify', '--quiet', ref]);
  if (current.code === 0 && current.stdout.trim() !== '') {
    // CAS against the current tracking-ref value so a concurrent fetch can
    // never be clobbered.
    await runGitProbe(['update-ref', ref, newSha, current.stdout.trim()]);
  } else {
    await runGitProbe(['update-ref', ref, newSha]);
  }
}

/**
 * Pushes the current branch's unpushed commits to GitHub via the REST API.
 *
 * The push ALWAYS targets the repository's DEFAULT branch (main) — it never
 * creates or pushes to another branch, so every change lands directly on main
 * with no merge/PR involved, exactly like a straight `git push origin HEAD:main`.
 *
 * The commits to push are computed against GitHub's ACTUAL default-branch tip
 * fetched fresh through the API, not the possibly-stale local remote-tracking
 * ref. A real non-fast-forward check is done locally: the remote tip must be an
 * ancestor of HEAD, otherwise the push refuses and asks you to pull first.
 *
 * Authenticated with the deployment's single stored GitHub token (set through
 * the dashboard Git tab) — no per-request token override and no env var.
 */
export async function pushCurrent(): Promise<string> {
  const config = await getGitHubConfig();

  // Always push to the repo's default branch (main) — never another branch.
  const branch = await getDefaultBranch(config);

  // GitHub's real branch tip — the base our push builds on. A 404 means the
  // repo isn't reachable / branch doesn't exist (getBranchTipSha verifies the
  // repo is reachable and enriches the error).
  const upstreamSha = await getBranchTipSha(config, branch);

  // Non-fast-forward guard: every commit GitHub already has must exist in our
  // local history, otherwise pushing would lose work on the remote.
  const ancestor = await runGitProbe([
    'merge-base',
    '--is-ancestor',
    upstreamSha,
    'HEAD',
  ]);
  if (ancestor.code !== 0) {
    throw new RepoFileManagerError(
      409,
      `GitHub's \`${branch}\` has commits that are not in this checkout — ` +
        'use Pull to bring them in (or rebase), then Commit & push again.',
    );
  }

  const commits = await collectPushCommits(upstreamSha);
  if (commits.length === 0) {
    throw new RepoFileManagerError(
      400,
      'Nothing to push — there are no unpushed commits.',
    );
  }

  const result = await pushCommitsToGitHub(config, branch, upstreamSha, commits, {
    createRef: false,
  });
  const upstream = await getUpstream();
  const remote =
    upstream && upstream.indexOf('/') !== -1
      ? upstream.slice(0, upstream.indexOf('/'))
      : 'origin';
  await tryUpdateTrackingRef(remote, branch, result.commitSha);

  return `Pushed ${result.pushedCount} commit${result.pushedCount === 1 ? '' : 's'} to ${remote}/${branch} (${result.commitSha.slice(0, 7)})`;
}

/** Pulls the latest changes for the current branch from its upstream. */
export async function pullCurrent(): Promise<string> {
  const out = await runGit(['pull']);
  return out.trim();
}

/** Recent commit history, newest first. */
export async function getCommitLog(limit: number): Promise<GitCommitInfo[]> {
  const safeLimit = Math.max(1, Math.min(50, Math.floor(limit) || 10));
  const out = await runGit([
    ...NO_QUOTE_CONFIG,
    'log',
    '-n',
    String(safeLimit),
    '--pretty=format:%h%x1f%an%x1f%ar%x1f%s',
  ]);
  return out
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      const [sha = '', author = '', when = '', subject = ''] = line.split('\x1f');
      return { sha, author, when, subject };
    });
}

/** Local branch names. */
export async function listBranches(): Promise<string[]> {
  const out = await runGit(['for-each-ref', '--format=%(refname:short)', 'refs/heads']);
  return out
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

/** Switches the working tree to an existing local branch. */
export async function checkoutBranch(branch: string): Promise<string> {
  const out = await runGit(['checkout', branch]);
  return out.trim();
}

/**
 * Discards working-tree changes for the given paths — unstaged edits on
 * tracked files are reverted, and untracked files/folders are deleted.
 * Mirrors Replit's per-file "Discard" in the Git panel. Never touches the
 * index, so staged content is preserved (a file that is both staged and
 * modified only loses its unstaged portion).
 */
export async function discardChanges(paths: string[]): Promise<void> {
  const normalized = paths.map((p) => normalizeRepoPath(p));
  if (normalized.length === 0) {
    throw new RepoFileManagerError(
      400,
      'At least one path is required to discard changes',
    );
  }

  // Untracked paths don't exist in git yet, so `git restore` cannot touch
  // them — split the batch: restore tracked files, clean untracked ones.
  const porcelain = await runGit([...NO_QUOTE_CONFIG, 'status', '--porcelain=v1', '-z']);
  const untracked = new Set(
    parsePorcelainChanges(porcelain)
      .filter((c) => c.status === 'untracked' && !c.staged)
      .map((c) => c.path),
  );
  const tracked = normalized.filter((p) => !untracked.has(p));
  const cleanTargets = normalized.filter((p) => untracked.has(p));

  if (tracked.length > 0) {
    await runGit(['restore', '--', ...tracked]);
  }
  if (cleanTargets.length > 0) {
    await runGit(['clean', '-fd', '--', ...cleanTargets]);
  }
}

/** Creates a new local branch from the current HEAD and switches to it. */
export async function createBranch(name: string): Promise<string> {
  const cleanName = name.trim();
  assertSafeName(cleanName);
  if (
    cleanName.startsWith('-') ||
    cleanName.includes('..') ||
    /\s/.test(cleanName)
  ) {
    throw new RepoFileManagerError(400, `Invalid branch name: ${cleanName}`);
  }
  const out = await runGit(['checkout', '-b', cleanName]);
  return out.trim();
}
