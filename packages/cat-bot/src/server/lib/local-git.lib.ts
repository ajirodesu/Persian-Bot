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

/** Commits the staged changes. Throws when there is nothing staged. */
export async function commitStaged(message: string): Promise<{ sha: string }> {
  const cleanMessage = message.trim();
  if (!cleanMessage) {
    throw new RepoFileManagerError(400, 'Commit message is required');
  }
  try {
    const out = await runGit(['commit', '-m', cleanMessage]);
    const sha = /^\[[^\]]* ([0-9a-f]+)\]/.exec(out.trim())?.[1] ?? '';
    return { sha };
  } catch (err) {
    if (err instanceof RepoFileManagerError) {
      if (/nothing to commit/i.test(err.message)) {
        throw new RepoFileManagerError(400, 'Nothing staged to commit');
      }
      if (/user\.name|user\.email|tell me who you are/i.test(err.message)) {
        throw new RepoFileManagerError(
          400,
          'Git has no committer identity — run `git config --global user.name "..."` and `git config --global user.email "..."` on the server, then try again.',
        );
      }
    }
    throw err;
  }
}

/** Pushes the current branch to its upstream. Returns git's output. */
export async function pushCurrent(): Promise<string> {
  const out = await runGit(['push']);
  return out.trim();
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
