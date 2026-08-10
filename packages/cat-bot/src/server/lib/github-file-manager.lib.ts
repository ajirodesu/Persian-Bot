/**
 * GitHub File Manager Lib — a faithful, GitHub-native repository file manager.
 *
 * Operates DIRECTLY on the configured GitHub repository via the Contents /
 * Trees / Commits / Branches APIs. Every mutation is a real commit pushed to
 * the selected branch — the repository is the single source of truth, exactly
 * like GitHub's own web file manager.
 *
 * Features mirror the GitHub repo browser:
 *   • browse folders on any branch (listDirectory + enrichWithLastCommit)
 *   • switch branches (listBranches / per-call branch)
 *   • read / create / save / rename / delete files and folders
 *   • "Go to file" index (listTree)
 *   • file history (listHistory)
 *   • upload files (uploadFiles)
 *
 * Configuration (all optional):
 *   GITHUB_TOKEN          — fine-grained PAT with Contents:Read+Write on the repo
 *   GITHUB_REPO_OWNER     — e.g. 'ajirodesu'
 *   GITHUB_REPO_NAME      — e.g. 'Persian-Bot'
 *
 * When GITHUB_TOKEN is absent every operation throws RepoFileManagerError with
 * status 503 ("GitHub not configured") so the admin panel can surface a clear
 * setup hint instead of silently doing nothing.
 *
 * Paths are relative to the repository root (e.g. `packages/cat-bot/src/app`),
 * validated the same way as before: no absolute paths, no `..` escapes, no
 * backslashes, no empty segments. Dotfiles are allowed (the repo browser must
 * be able to show `.gitignore`).
 */

import { env } from '@/engine/config/env.config.js';

// ── Error type ────────────────────────────────────────────────────────────────

export class RepoFileManagerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// ── Configuration ─────────────────────────────────────────────────────────────

let defaultBranchCache: string | null | undefined;

interface RepoConfig {
  token: string;
  owner: string;
  repo: string;
}

function repoConfig(): RepoConfig {
  const token = env.GITHUB_TOKEN;
  if (!token) {
    throw new RepoFileManagerError(
      503,
      'GitHub not configured — set GITHUB_TOKEN to enable the file manager',
    );
  }
  return {
    token,
    owner: env.GITHUB_REPO_OWNER ?? 'ajirodesu',
    repo: env.GITHUB_REPO_NAME ?? 'Persian-Bot',
  };
}

/**
 * Resolves the repo's default branch (cached per process). Falls back to 'main'
 * when the lookup fails so the manager still works in restricted networks.
 */
async function resolveDefaultBranch(
  owner: string,
  repo: string,
): Promise<string> {
  if (defaultBranchCache !== undefined) return defaultBranchCache ?? 'main';
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'cat-bot-file-manager',
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      defaultBranchCache = 'main';
      return 'main';
    }
    const data = (await res.json()) as { default_branch?: string };
    defaultBranchCache = data.default_branch ?? 'main';
    return defaultBranchCache;
  } catch {
    defaultBranchCache = 'main';
    return 'main';
  }
}

// ── Path validation ───────────────────────────────────────────────────────────

/**
 * Normalizes a repository path. Empty input is allowed only for the root
 * listing; every other operation requires a non-empty relative path.
 */
function normalizeRepoPath(raw: string, allowRoot = false): string {
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
  if (segments.some((seg) => seg === '..' || seg === '.' || seg === '')) {
    throw new RepoFileManagerError(400, 'Invalid path');
  }
  return cleaned;
}

/** Rejects names that cannot exist as a single repo entry (name only, no slash). */
function assertSafeName(name: string): void {
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

// ── GitHub API primitives ─────────────────────────────────────────────────────

interface GhContext {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

const GH_HEADERS = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'cat-bot-file-manager',
};

/** URL-encodes a repo path without mangling the slashes. */
function encodeRepoPath(repoPath: string): string {
  return repoPath.split('/').map(encodeURIComponent).join('/');
}

/** Fetches the current SHA of a path (null when the path does not exist). */
async function getSha(ctx: GhContext, repoPath: string): Promise<string | null> {
  if (!repoPath) return null;
  const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(ctx.branch)}`;
  const res = await fetch(url, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${ctx.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new RepoFileManagerError(502, `GitHub lookup failed (${res.status})`);
  }
  const data = (await res.json()) as { sha?: string };
  return data.sha ?? null;
}

/** True when a path exists at the given ref (file or folder). */
async function pathExists(ctx: GhContext, repoPath: string): Promise<boolean> {
  const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(ctx.branch)}`;
  const res = await fetch(url, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${ctx.token}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return false;
  if (!res.ok) {
    throw new RepoFileManagerError(502, `GitHub lookup failed (${res.status})`);
  }
  return true;
}

/** Commits content to a repo path (create or update). Returns the commit SHA. */
async function putContent(
  ctx: GhContext,
  repoPath: string,
  content: string,
  sha: string | null,
  message: string,
): Promise<string> {
  const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/contents/${encodeRepoPath(repoPath)}`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      ...GH_HEADERS,
      Authorization: `Bearer ${ctx.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: Buffer.from(content, 'utf8').toString('base64'),
      branch: ctx.branch,
      ...(sha ? { sha } : {}),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new RepoFileManagerError(
      502,
      `GitHub push failed (${res.status})${body?.message ? `: ${body.message}` : ''}`,
    );
  }
  const data = (await res.json()) as { commit?: { sha?: string } };
  return data.commit?.sha ?? '';
}

/** Deletes a repo path. */
async function deleteContent(
  ctx: GhContext,
  repoPath: string,
  sha: string,
  message: string,
): Promise<void> {
  const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/contents/${encodeRepoPath(repoPath)}`;
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      ...GH_HEADERS,
      Authorization: `Bearer ${ctx.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      branch: ctx.branch,
      sha,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as {
      message?: string;
    } | null;
    throw new RepoFileManagerError(
      502,
      `GitHub delete failed (${res.status})${body?.message ? `: ${body.message}` : ''}`,
    );
  }
}

/** Lists every blob under a repo prefix (recursive tree). */
async function listBlobShasUnder(
  ctx: GhContext,
  prefix: string,
): Promise<Array<{ path: string; sha: string }>> {
  const treeRes = await fetch(
    `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/git/trees/${encodeURIComponent(ctx.branch)}?recursive=1`,
    {
      headers: { ...GH_HEADERS, Authorization: `Bearer ${ctx.token}` },
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!treeRes.ok) {
    throw new RepoFileManagerError(
      502,
      `GitHub tree lookup failed (${treeRes.status})`,
    );
  }
  const treeData = (await treeRes.json()) as {
    tree?: Array<{ path?: string; type?: string; sha?: string }>;
  };
  return (treeData.tree ?? [])
    .filter(
      (node) =>
        node.type === 'blob' &&
        typeof node.path === 'string' &&
        node.path.startsWith(`${prefix}/`) &&
        typeof node.sha === 'string',
    )
    .map((node) => ({ path: node.path as string, sha: node.sha as string }));
}

/** Decodes a base64 blob into UTF-8 text. */
async function readBlobText(
  ctx: GhContext,
  sha: string,
): Promise<string> {
  const res = await fetch(
    `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/git/blobs/${sha}`,
    {
      headers: { ...GH_HEADERS, Authorization: `Bearer ${ctx.token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!res.ok) {
    throw new RepoFileManagerError(502, `GitHub blob read failed (${res.status})`);
  }
  const data = (await res.json()) as { content?: string };
  return Buffer.from(data.content ?? '', 'base64').toString('utf8');
}

/** Lists all branch names for the repo. */
async function fetchBranchNames(
  token: string,
  owner: string,
  repo: string,
): Promise<string[]> {
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/branches?per_page=100`,
    {
      headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    },
  );
  if (!res.ok) {
    throw new RepoFileManagerError(
      502,
      `GitHub branch lookup failed (${res.status})`,
    );
  }
  const data = (await res.json()) as Array<{ name?: string }>;
  const names = data
    .map((b) => b.name)
    .filter((name): name is string => typeof name === 'string' && name !== '');
  const fallback = defaultBranchCache ?? 'main';
  if (names.length === 0) names.push(fallback);
  if (!names.includes(fallback)) names.unshift(fallback);
  return names;
}

// ── Language mapping ──────────────────────────────────────────────────────────

const EXTENSION_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.md': 'markdown',
  '.txt': 'text',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.css': 'css',
  '.html': 'html',
  '.sh': 'shell',
  '.py': 'python',
  '.sql': 'sql',
};

export function languageForName(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return EXTENSION_LANGUAGE[name.slice(dot).toLowerCase()] ?? null;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface RepoLastCommit {
  message: string;
  author: string;
  /** ISO timestamp of the last commit touching the entry. */
  date: string;
}

export interface RepoEntry {
  name: string;
  /** Path relative to the repository root, e.g. `packages/cat-bot/src/app`. */
  path: string;
  type: 'folder' | 'file';
  /** File size in bytes; null for folders. */
  size: number | null;
  sha: string;
  lastCommit: RepoLastCommit | null;
}

export interface RepoDirectoryListing {
  /** The path that was listed ('' for the repository root). */
  path: string;
  entries: RepoEntry[];
}

export interface RepoMeta {
  owner: string;
  repo: string;
  /** The repository's default branch. */
  branch: string;
  /** Every branch name (empty when GitHub is not configured). */
  branches: string[];
  configured: boolean;
}

export interface RepoReadFile {
  path: string;
  content: string;
  language: string | null;
  size: number | null;
  sha: string;
}

export interface RepoCommit {
  sha: string;
  message: string;
  author: string;
  /** ISO timestamp of the commit. */
  date: string;
}

export interface RepoTreeNode {
  path: string;
  type: 'file' | 'folder';
}

export interface RepoMutationResult {
  synced: boolean;
  commitSha?: string | undefined;
}

/** The commit message is asked from the operator — never auto-generated. */
export function defaultCommitMessage(action: string, repoPath: string): string {
  return `chore(file-manager): ${action} ${repoPath}`;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Repository identity + default branch + branch list + configured flag. */
export async function getRepoMeta(): Promise<RepoMeta> {
  try {
    const { token, owner, repo } = repoConfig();
    const branch = await resolveDefaultBranch(owner, repo);
    const branches = await fetchBranchNames(token, owner, repo);
    return { owner, repo, branch, branches, configured: true };
  } catch (err) {
    if (err instanceof RepoFileManagerError) {
      return {
        owner: env.GITHUB_REPO_OWNER ?? 'ajirodesu',
        repo: env.GITHUB_REPO_NAME ?? 'Persian-Bot',
        branch: defaultBranchCache ?? 'main',
        branches: [],
        configured: false,
      };
    }
    throw err;
  }
}

/**
 * Lists a folder. The empty path lists the repository root. Each entry is
 * enriched with its most recent commit (message / author / date) so the panel
 * reads like GitHub's own file browser. Enrichment is capped to keep large
 * folders responsive.
 */
export async function listDirectory(
  raw: string,
  branch?: string | undefined,
): Promise<RepoDirectoryListing> {
  const repoPath = normalizeRepoPath(raw, true);
  const ctx = await buildContext(branch);
  const pathSegment = repoPath ? `/${encodeRepoPath(repoPath)}` : '';
  const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/contents${pathSegment}?ref=${encodeURIComponent(ctx.branch)}`;
  const res = await fetch(url, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${ctx.token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) {
    throw new RepoFileManagerError(404, `Folder not found: ${repoPath || '(root)'}`);
  }
  if (!res.ok) {
    throw new RepoFileManagerError(502, `GitHub lookup failed (${res.status})`);
  }
  const data = (await res.json()) as Array<{
    name?: string;
    path?: string;
    type?: string;
    size?: number;
    sha?: string;
  }>;

  const entries = data
    .filter((e) => typeof e.name === 'string' && typeof e.path === 'string')
    .map((e) => ({
      name: e.name as string,
      path: e.path as string,
      type: e.type === 'dir' ? ('folder' as const) : ('file' as const),
      size: e.type === 'file' ? (e.size ?? null) : null,
      sha: e.sha ?? '',
      lastCommit: null,
    }));

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Enrich with last-commit info — bounded so huge folders stay snappy.
  if (entries.length > 0 && entries.length <= 60) {
    await enrichWithLastCommit(ctx, entries);
  }

  return { path: repoPath, entries };
}

/**
 * Reads a text file from the repo. Contents larger than 1 MB are rejected —
 * the editor is for source files, not assets.
 */
export async function readFile(
  raw: string,
  branch?: string | undefined,
): Promise<RepoReadFile> {
  const repoPath = normalizeRepoPath(raw);
  const ctx = await buildContext(branch);
  const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/contents/${encodeRepoPath(repoPath)}?ref=${encodeURIComponent(ctx.branch)}`;
  const res = await fetch(url, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${ctx.token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (res.status === 404) {
    throw new RepoFileManagerError(404, `File not found: ${repoPath}`);
  }
  if (!res.ok) {
    throw new RepoFileManagerError(502, `GitHub lookup failed (${res.status})`);
  }
  const payload = (await res.json()) as
    | Array<unknown>
    | {
        type?: string;
        content?: string;
        size?: number;
        sha?: string;
        encoding?: string;
      };
  // The Contents API returns an array for a directory — never a file body.
  if (Array.isArray(payload)) {
    throw new RepoFileManagerError(400, `${repoPath} is a folder, not a file`);
  }
  const data = payload;
  if (data.type === 'dir') {
    throw new RepoFileManagerError(400, `${repoPath} is a folder, not a file`);
  }
  const size = data.size ?? null;
  if (size !== null && size > 1024 * 1024) {
    throw new RepoFileManagerError(400, 'File exceeds the 1 MB editor limit');
  }
  if (data.encoding !== 'base64') {
    throw new RepoFileManagerError(400, 'File is not text — cannot edit it');
  }
  const content = Buffer.from(data.content ?? '', 'base64').toString('utf8');
  const name = repoPath.split('/').pop() ?? repoPath;
  return {
    path: repoPath,
    content,
    language: languageForName(name),
    size,
    sha: data.sha ?? '',
  };
}

/** Creates a new file (fails with 409 when the path already exists). */
export async function createFile(
  raw: string,
  content: string,
  message: string,
  branch?: string | undefined,
): Promise<RepoMutationResult> {
  const repoPath = normalizeRepoPath(raw);
  assertSafeName(repoPath.split('/').pop() ?? repoPath);
  const ctx = await buildContext(branch);
  if (await pathExists(ctx, repoPath)) {
    throw new RepoFileManagerError(409, `Already exists: ${repoPath}`);
  }
  const commitSha = await putContent(
    ctx,
    repoPath,
    content,
    null,
    message || defaultCommitMessage('create', repoPath),
  );
  return { synced: true, commitSha: commitSha || undefined };
}

/** Creates a folder via a placeholder file (GitHub stores no empty folders). */
export async function createFolder(
  raw: string,
  message: string,
  branch?: string | undefined,
): Promise<RepoMutationResult> {
  const repoPath = normalizeRepoPath(raw);
  assertSafeName(repoPath.split('/').pop() ?? repoPath);
  const ctx = await buildContext(branch);
  if (await pathExists(ctx, repoPath)) {
    throw new RepoFileManagerError(409, `Folder already exists: ${repoPath}`);
  }
  const commitSha = await putContent(
    ctx,
    `${repoPath}/.gitkeep`,
    '',
    null,
    message || defaultCommitMessage('create folder', repoPath),
  );
  return { synced: true, commitSha: commitSha || undefined };
}

/** Overwrites an existing file and commits the change. */
export async function saveFile(
  raw: string,
  content: string,
  message: string,
  branch?: string | undefined,
): Promise<RepoMutationResult> {
  const repoPath = normalizeRepoPath(raw);
  const ctx = await buildContext(branch);
  const sha = await getSha(ctx, repoPath);
  if (!sha) {
    throw new RepoFileManagerError(404, `File not found: ${repoPath}`);
  }
  const commitSha = await putContent(
    ctx,
    repoPath,
    content,
    sha,
    message || defaultCommitMessage('update', repoPath),
  );
  return { synced: true, commitSha: commitSha || undefined };
}

/**
 * Renames a file or folder. Files are copied-then-deleted; folders move every
 * blob under the old prefix the same way (the Contents API has no move).
 */
export async function renameEntry(
  fromRaw: string,
  toRaw: string,
  message: string,
  branch?: string | undefined,
): Promise<RepoMutationResult> {
  const from = normalizeRepoPath(fromRaw);
  const to = normalizeRepoPath(toRaw);
  assertSafeName(to.split('/').pop() ?? to);
  const ctx = await buildContext(branch);

  if (await pathExists(ctx, to)) {
    throw new RepoFileManagerError(409, `Already exists: ${to}`);
  }

  const sha = await getSha(ctx, from);
  if (!sha) {
    // Path may be a folder (Contents API returns an array for dirs → no sha).
    const blobs = await listBlobShasUnder(ctx, from);
    if (blobs.length === 0) {
      throw new RepoFileManagerError(404, `Not found: ${from}`);
    }
    let lastSha = '';
    for (const blob of blobs) {
      const content = await readBlobText(ctx, blob.sha);
      const movedPath = `${to}${blob.path.slice(from.length)}`;
      const commitSha = await putContent(
        ctx,
        movedPath,
        content,
        null,
        message || defaultCommitMessage('rename', blob.path),
      );
      if (commitSha) lastSha = commitSha;
    }
    for (const blob of blobs) {
      await deleteContent(
        ctx,
        blob.path,
        blob.sha,
        message || defaultCommitMessage('rename cleanup', blob.path),
      );
    }
    return { synced: true, commitSha: lastSha || undefined };
  }

  // Single-file rename — reuse the existing blob content, then delete the old.
  const content = await readBlobText(ctx, sha);
  const commitSha = await putContent(
    ctx,
    to,
    content,
    null,
    message || defaultCommitMessage('rename', from),
  );
  await deleteContent(ctx, from, sha, message || defaultCommitMessage('rename', from));
  return { synced: true, commitSha: commitSha || undefined };
}

/** Deletes a file or a folder (every file under a folder prefix). */
export async function deleteEntry(
  raw: string,
  message: string,
  branch?: string | undefined,
): Promise<RepoMutationResult> {
  const repoPath = normalizeRepoPath(raw);
  const ctx = await buildContext(branch);

  const sha = await getSha(ctx, repoPath);
  if (sha) {
    await deleteContent(
      ctx,
      repoPath,
      sha,
      message || defaultCommitMessage('delete', repoPath),
    );
    return { synced: true };
  }

  const blobs = await listBlobShasUnder(ctx, repoPath);
  if (blobs.length === 0) {
    throw new RepoFileManagerError(404, `Not found: ${repoPath}`);
  }
  for (const blob of blobs) {
    await deleteContent(
      ctx,
      blob.path,
      blob.sha,
      message || defaultCommitMessage('delete', blob.path),
    );
  }
  return { synced: true };
}

/**
 * Returns a flat index of every file/folder in the repo on the given branch —
 * powers the "Go to file" finder, matching GitHub's command-palette search.
 */
export async function listTree(
  branch?: string | undefined,
): Promise<{ path: string; entries: RepoTreeNode[] }> {
  const ctx = await buildContext(branch);
  const treeRes = await fetch(
    `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/git/trees/${encodeURIComponent(ctx.branch)}?recursive=1`,
    {
      headers: { ...GH_HEADERS, Authorization: `Bearer ${ctx.token}` },
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!treeRes.ok) {
    throw new RepoFileManagerError(
      502,
      `GitHub tree lookup failed (${treeRes.status})`,
    );
  }
  const treeData = (await treeRes.json()) as {
    tree?: Array<{ path?: string; type?: string }>;
    truncated?: boolean;
  };
  const entries: RepoTreeNode[] = (treeData.tree ?? [])
    .filter(
      (node): node is { path: string; type: 'blob' | 'tree' } =>
        (node.type === 'blob' || node.type === 'tree') &&
        typeof node.path === 'string' &&
        node.path !== '',
    )
    .map((node) => ({
      path: node.path,
      type: node.type === 'tree' ? 'folder' : 'file',
    }));
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { path: '', entries };
}

/** Returns recent commits for a path — the file's History view. */
export async function listHistory(
  raw: string,
  branch?: string | undefined,
): Promise<RepoCommit[]> {
  const repoPath = normalizeRepoPath(raw);
  const ctx = await buildContext(branch);
  const url = `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/commits?path=${encodeURIComponent(repoPath)}&sha=${encodeURIComponent(ctx.branch)}&per_page=30`;
  const res = await fetch(url, {
    headers: { ...GH_HEADERS, Authorization: `Bearer ${ctx.token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    throw new RepoFileManagerError(502, `GitHub history lookup failed (${res.status})`);
  }
  const data = (await res.json()) as Array<{
    sha?: string;
    commit?: {
      message?: string;
      author?: { date?: string };
    };
    author?: { login?: string } | null;
  }>;
  return data
    .filter((c) => typeof c.sha === 'string')
    .map((c) => ({
      sha: c.sha as string,
      message: c.commit?.message ?? '',
      author: c.author?.login ?? '',
      date: c.commit?.author?.date ?? '',
    }));
}

/**
 * Creates or updates a batch of files (used by "Upload files"). Each file is a
 * separate commit — the Contents API has no batch endpoint. Fails atomically at
 * the first error; already-written files stay committed.
 */
export async function uploadFiles(
  files: Array<{ path: string; content: string }>,
  message: string,
  branch?: string | undefined,
): Promise<RepoMutationResult> {
  if (!Array.isArray(files) || files.length === 0) {
    throw new RepoFileManagerError(400, 'No files to upload');
  }
  const ctx = await buildContext(branch);
  let lastSha = '';
  for (const file of files) {
    const repoPath = normalizeRepoPath(file.path);
    assertSafeName(repoPath.split('/').pop() ?? repoPath);
    if (typeof file.content !== 'string' || file.content.length > 1024 * 1024) {
      throw new RepoFileManagerError(400, `Invalid content for ${repoPath}`);
    }
    const sha = await getSha(ctx, repoPath);
    const commitSha = await putContent(
      ctx,
      repoPath,
      file.content,
      sha,
      message || defaultCommitMessage(sha ? 'update' : 'create', repoPath),
    );
    if (commitSha) lastSha = commitSha;
  }
  return { synced: true, commitSha: lastSha || undefined };
}

// ── Internals ─────────────────────────────────────────────────────────────────

/**
 * Builds the GitHub context. When a branch is supplied it is used as-is;
 * otherwise the repo's default branch is resolved.
 */
async function buildContext(branch?: string | undefined): Promise<GhContext> {
  const { token, owner, repo } = repoConfig();
  const active = branch && branch.trim() !== ''
    ? branch.trim()
    : await resolveDefaultBranch(owner, repo);
  return { token, owner, repo, branch: active };
}

/** Fetches the latest commit for each entry with a small concurrency pool. */
async function enrichWithLastCommit(
  ctx: GhContext,
  entries: RepoEntry[],
): Promise<void> {
  const pool: Array<Promise<void>> = [];
  for (const entry of entries) {
    pool.push(
      (async () => {
        try {
          const res = await fetch(
            `https://api.github.com/repos/${ctx.owner}/${ctx.repo}/commits?path=${encodeURIComponent(entry.path)}&sha=${encodeURIComponent(ctx.branch)}&per_page=1`,
            {
              headers: { ...GH_HEADERS, Authorization: `Bearer ${ctx.token}` },
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!res.ok) return;
          const data = (await res.json()) as Array<{
            commit?: {
              message?: string;
              author?: { date?: string };
            };
            author?: { login?: string } | null;
          }>;
          const latest = data[0];
          if (!latest?.commit) return;
          entry.lastCommit = {
            message: latest.commit.message ?? '',
            author: latest.author?.login ?? '',
            date: latest.commit.author?.date ?? '',
          };
        } catch {
          // Commit enrichment is best-effort — the listing still works.
        }
      })(),
    );
    if (pool.length >= 6) {
      await Promise.all(pool);
      pool.length = 0;
    }
  }
  await Promise.all(pool);
}
