/**
 * Local File Manager Lib — filesystem-based repository file manager for the
 * Admin panel, operating on the real git checkout resolved by local-git.lib.
 *
 * Reads come straight from disk. Every mutation writes to the WORKING TREE only
 * and returns `{ synced: false }` — nothing is committed or pushed until the
 * operator explicitly does so from the Git tab (stage/commit/push), exactly like
 * Replit's file manager + Git panel.
 *
 * This supersedes the old GitHub-native lib (which committed on every save).
 * The public names/types are kept so controllers and the webview stay stable.
 */

import { promises as fsp } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
  getCurrentBranch,
  getGitMeta,
  getPathLastCommit,
  getRepoRootOrThrow,
  getTrackedSha,
  listBranches,
  normalizeRepoPath,
  assertSafeName,
  RepoFileManagerError,
} from './local-git.lib.js';

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

/** Detected editor key for a filename, or null for unknown/binary extensions. */
export function languageForName(name: string): string | null {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return null;
  return EXTENSION_LANGUAGE[name.slice(dot).toLowerCase()] ?? null;
}

// ── Public types (kept compatible with the old GitHub-native lib) ─────────────

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
  /** Git blob SHA when tracked; a content hash otherwise ('' for folders). */
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
  /** The current branch name (null when HEAD is detached). */
  branch: string | null;
  /** Every local branch name. */
  branches: string[];
  configured: boolean;
  /** Absolute path of the checkout the manager operates on. */
  root: string | null;
}

export interface RepoReadFile {
  path: string;
  content: string;
  language: string | null;
  size: number | null;
  sha: string;
}

export interface RepoTreeNode {
  path: string;
  type: 'file' | 'folder';
}

export interface RepoMutationResult {
  /** Always false — file-manager writes are working-tree changes, never commits. */
  synced: boolean;
  commitSha?: string | undefined;
}

/**
 * The commit message is asked from the operator — never auto-generated. Kept as
 * a placeholder for the panel's message field; file-manager writes no longer
 * produce commits.
 */
export function defaultCommitMessage(action: string, repoPath: string): string {
  return `chore(file-manager): ${action} ${repoPath}`;
}

// ── Internals ─────────────────────────────────────────────────────────────────

const MAX_EDIT_SIZE = 1024 * 1024;
const MAX_TREE_NODES = 2500;

/** Absolute filesystem path for a normalized repo path. */
function absPath(repoPath: string): string {
  const root = getRepoRootOrThrow();
  return join(root, ...repoPath.split('/'));
}

/** Guards a write so it can never touch the git internals. */
function guardCriticalPath(repoPath: string): void {
  if (repoPath === '.git' || repoPath.startsWith('.git/')) {
    throw new RepoFileManagerError(400, 'Cannot modify .git — use git commands');
  }
}

/** Stable pseudo-SHA for untracked files (real git SHA when tracked). */
async function entrySha(repoPath: string): Promise<string> {
  const tracked = await getTrackedSha(repoPath);
  if (tracked) return tracked;
  try {
    const content = await fsp.readFile(absPath(repoPath), 'utf8');
    return createHash('sha1').update(content, 'utf8').digest('hex');
  } catch {
    return '';
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Repository identity + current branch + local branches + configured flag. */
export async function getRepoMeta(): Promise<RepoMeta> {
  const root = getRepoRootOrThrow();
  const [meta, branch, branches] = await Promise.all([
    getGitMeta(),
    getCurrentBranch(),
    listBranches(),
  ]);
  const repoName =
    (typeof meta.repo === 'string' && meta.repo !== '' ? meta.repo : null) ??
    root.split(/[\\/]/).pop() ??
    'repository';
  return {
    owner: meta.owner || '',
    repo: repoName,
    branch,
    branches,
    configured: true,
    root,
  };
}

/**
 * Lists a folder. The empty path lists the repository root. Each entry is
 * enriched with its most recent commit (message / author / date) and a real git
 * blob SHA when tracked — bounded so huge folders stay responsive.
 */
export async function listDirectory(raw: string): Promise<RepoDirectoryListing> {
  const repoPath = normalizeRepoPath(raw, true);
  const dir = absPath(repoPath);
  let dirents;
  try {
    dirents = await fsp.readdir(dir, { withFileTypes: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new RepoFileManagerError(404, `Folder not found: ${repoPath || '(root)'}`);
    }
    throw err;
  }

  const entries: RepoEntry[] = dirents
    .filter((d) => d.name !== '.git')
    .map((d) => ({
      name: d.name,
      path: repoPath ? `${repoPath}/${d.name}` : d.name,
      type: d.isDirectory() ? ('folder' as const) : ('file' as const),
      size: null,
      sha: '',
      lastCommit: null,
    }));

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  // Enrich with size + sha + last-commit — bounded so huge folders stay snappy.
  const enrichable = entries.filter((e) => e.type === 'file').slice(0, 60);
  await Promise.all(
    enrichable.map(async (entry) => {
      try {
        const stat = await fsp.stat(absPath(entry.path));
        entry.size = stat.size;
      } catch {
        entry.size = null;
      }
      entry.sha = await entrySha(entry.path);
    }),
  );
  if (entries.length <= 60) {
    await Promise.all(
      entries.slice(0, 60).map(async (entry) => {
        entry.lastCommit = await getPathLastCommit(entry.path);
      }),
    );
  }

  return { path: repoPath, entries };
}

/**
 * Reads a text file from the checkout. Contents larger than 1 MB are rejected —
 * the editor is for source files, not assets.
 */
export async function readFile(raw: string): Promise<RepoReadFile> {
  const repoPath = normalizeRepoPath(raw);
  const name = repoPath.split('/').pop() ?? repoPath;
  const filePath = absPath(repoPath);
  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new RepoFileManagerError(404, `File not found: ${repoPath}`);
    }
    throw err;
  }
  if (stat.isDirectory()) {
    throw new RepoFileManagerError(400, `${repoPath} is a folder, not a file`);
  }
  const size = stat.size;
  if (size > MAX_EDIT_SIZE) {
    throw new RepoFileManagerError(400, 'File exceeds the 1 MB editor limit');
  }
  const content = await fsp.readFile(filePath, 'utf8');
  return {
    path: repoPath,
    content,
    language: languageForName(name),
    size,
    sha: await entrySha(repoPath),
  };
}

/** Creates a new file in the working tree (fails with 409 when it exists). */
export async function createFile(
  raw: string,
  content: string,
): Promise<RepoMutationResult> {
  const repoPath = normalizeRepoPath(raw);
  assertSafeName(repoPath.split('/').pop() ?? repoPath);
  guardCriticalPath(repoPath);
  const filePath = absPath(repoPath);
  await fsp.mkdir(join(filePath, '..'), { recursive: true });
  try {
    await fsp.writeFile(filePath, content, { encoding: 'utf8', flag: 'wx' });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new RepoFileManagerError(409, `Already exists: ${repoPath}`);
    }
    throw err;
  }
  return { synced: false };
}

/** Creates a real (empty) folder in the working tree. */
export async function createFolder(raw: string): Promise<RepoMutationResult> {
  const repoPath = normalizeRepoPath(raw);
  assertSafeName(repoPath.split('/').pop() ?? repoPath);
  guardCriticalPath(repoPath);
  try {
    await fsp.mkdir(absPath(repoPath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new RepoFileManagerError(409, `Folder already exists: ${repoPath}`);
    }
    throw err;
  }
  return { synced: false };
}

/** Overwrites an existing file in the working tree (untracked otherwise). */
export async function saveFile(
  raw: string,
  content: string,
): Promise<RepoMutationResult> {
  const repoPath = normalizeRepoPath(raw);
  guardCriticalPath(repoPath);
  const filePath = absPath(repoPath);
  try {
    await fsp.access(filePath);
  } catch {
    throw new RepoFileManagerError(404, `File not found: ${repoPath}`);
  }
  await fsp.writeFile(filePath, content, { encoding: 'utf8' });
  return { synced: false };
}

/** Renames/moves a file or folder within the working tree. */
export async function renameEntry(
  fromRaw: string,
  toRaw: string,
): Promise<RepoMutationResult> {
  const from = normalizeRepoPath(fromRaw);
  const to = normalizeRepoPath(toRaw);
  assertSafeName(to.split('/').pop() ?? to);
  guardCriticalPath(from);
  guardCriticalPath(to);
  try {
    await fsp.rename(absPath(from), absPath(to));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new RepoFileManagerError(404, `Not found: ${from}`);
    }
    if (code === 'EEXIST') {
      throw new RepoFileManagerError(409, `Already exists: ${to}`);
    }
    throw err;
  }
  return { synced: false };
}

/** Deletes a file or a folder (recursively) from the working tree. */
export async function deleteEntry(raw: string): Promise<RepoMutationResult> {
  const repoPath = normalizeRepoPath(raw);
  guardCriticalPath(repoPath);
  try {
    await fsp.rm(absPath(repoPath), { recursive: true, force: false });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new RepoFileManagerError(404, `Not found: ${repoPath}`);
    }
    throw err;
  }
  return { synced: false };
}

/**
 * Returns a flat index of every file/folder in the checkout — powers the "Go to
 * file" finder. Bounded (2 500 nodes) and skips `.git`/`node_modules`.
 */
export async function listTree(): Promise<{ path: string; entries: RepoTreeNode[] }> {
  const root = getRepoRootOrThrow();
  const entries: RepoTreeNode[] = [];
  const SKIP = new Set(['.git', 'node_modules', '.next', 'dist', 'build']);

  async function walk(dirPath: string, repoPath: string): Promise<void> {
    if (repoPath !== '' && repoPath.split('/').some((seg) => SKIP.has(seg))) return;
    if (entries.length >= MAX_TREE_NODES) return;
    let dirents;
    try {
      dirents = await fsp.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      if (entries.length >= MAX_TREE_NODES) return;
      const childPath = repoPath ? `${repoPath}/${dirent.name}` : dirent.name;
      if (dirent.isDirectory()) {
        if (dirent.name === '.git' || SKIP.has(dirent.name)) continue;
        entries.push({ path: childPath, type: 'folder' });
        await walk(join(dirPath, dirent.name), childPath);
      } else if (dirent.isFile()) {
        entries.push({ path: childPath, type: 'file' });
      }
    }
  }

  await walk(root, '');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { path: '', entries };
}