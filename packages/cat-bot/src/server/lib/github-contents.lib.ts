/**
 * GitHub Contents Lib — authenticated GitHub API writes for the bot.
 *
 * Used by /push and /installer to land files in the repo through the GitHub
 * REST API using GITHUB_TOKEN / GITHUB_REPO_OWNER / GITHUB_REPO_NAME, instead
 * of committing to a local git checkout (which needs git user.name/email and
 * push credentials on the host — the things that break on Render/Railway).
 *
 * Everything here goes through the Git Data API so a batch of files lands as
 * ONE commit, authored by the token's account. No local checkout is touched.
 */

import axios from 'axios';
import { env } from '@/engine/config/env.config.js';

// ── Error type ────────────────────────────────────────────────────────────────

export class GitHubApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Normalizes an unknown failure into a GitHubApiError (passes ours through). */
function toGitHubError(err: unknown): GitHubApiError {
  if (err instanceof GitHubApiError) return err;
  if (axios.isAxiosError(err)) {
    const status = typeof err.response?.status === 'number' ? err.response.status : 502;
    const detail =
      (err.response?.data as { message?: string } | undefined)?.message ??
      err.message ??
      'GitHub API request failed';
    return new GitHubApiError(status, `GitHub API ${status}: ${detail}`);
  }
  return new GitHubApiError(502, err instanceof Error ? err.message : String(err));
}

// ── Config ────────────────────────────────────────────────────────────────────

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  /** Repo-relative base path of the cat-bot package (defaults to packages/cat-bot). */
  basePath: string;
}

/**
 * Reads the GitHub env vars, throwing a clear error when any is missing. The
 * /push and /installer commands RELY on these — without them there is no repo
 * to write to.
 */
export function getGitHubConfig(): GitHubConfig {
  const token = env.GITHUB_TOKEN ?? '';
  const owner = env.GITHUB_REPO_OWNER ?? '';
  const repo = env.GITHUB_REPO_NAME ?? '';
  if (!token || !owner || !repo) {
    console.error(
      '[ghp] GITHUB_TOKEN / GITHUB_REPO_OWNER / GITHUB_REPO_NAME are not fully set — ' +
        'this command will fail until they are added to your environment variables.',
    );
    throw new GitHubApiError(
      503,
      'GitHub is not configured — set GITHUB_TOKEN, GITHUB_REPO_OWNER and GITHUB_REPO_NAME in the server environment, then try again.',
    );
  }
  return {
    token,
    owner,
    repo,
    basePath: (env.GITHUB_REPO_BASE_PATH ?? 'packages/cat-bot').replace(/^\/+|\/+$/g, ''),
  };
}

// ── GitHub API plumbing ───────────────────────────────────────────────────────

function createApi(config: GitHubConfig) {
  return axios.create({
    baseURL: `https://api.github.com/repos/${config.owner}/${config.repo}`,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'cat-bot',
    },
    timeout: 60_000,
  });
}

/** Encodes a repo-relative path into URL path segments. */
function encodePath(repoPath: string): string {
  return repoPath
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

// ── Public API ────────────────────────────────────────────────────────────────

/** The repo's default branch — the branch commits land on. */
export async function getDefaultBranch(config: GitHubConfig): Promise<string> {
  try {
    const res = await createApi(config).get('/');
    const branch: unknown = res.data?.default_branch;
    return typeof branch === 'string' && branch !== '' ? branch : 'main';
  } catch (err) {
    throw toGitHubError(err);
  }
}

/**
 * SHA of the file at `repoPath` on `branch`, or null when it doesn't exist
 * there. Used by /installer to refuse re-installing an existing command.
 */
export async function getFileSha(
  config: GitHubConfig,
  repoPath: string,
  branch: string,
): Promise<string | null> {
  try {
    const res = await createApi(config).get(`/contents/${encodePath(repoPath)}`, {
      params: { ref: branch },
    });
    const sha: unknown = res.data?.sha;
    return typeof sha === 'string' ? sha : null;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) return null;
    throw toGitHubError(err);
  }
}

export interface GitHubFileInput {
  /** Repository-relative path, e.g. `packages/cat-bot/src/app/commands/ping.ts`. */
  path: string;
  /** Raw file content (text or binary). */
  content: Buffer;
}

export interface GitHubCommitResult {
  commitSha: string;
  branch: string;
  committedPaths: string[];
}

/**
 * Lands `files` in the repo as ONE commit on `branch` via the Git Data API.
 * Existing files are updated in place, new files are created. The commit is
 * authored by the token's GitHub account — no git identity needed on the host.
 */
export async function pushFilesToGitHub(
  config: GitHubConfig,
  files: GitHubFileInput[],
  message: string,
  branch: string,
): Promise<GitHubCommitResult> {
  if (files.length === 0) {
    throw new GitHubApiError(400, 'Nothing to commit — no files were provided.');
  }
  const api = createApi(config);
  try {
    // 1. The branch's current head commit.
    const headRes = await api.get(`/git/ref/heads/${encodeURIComponent(branch)}`);
    const headSha: unknown = headRes.data?.object?.sha;
    if (typeof headSha !== 'string' || headSha === '') {
      throw new GitHubApiError(502, `Could not resolve branch "${branch}" on GitHub.`);
    }

    // 2. One blob per file (parallel).
    const blobShas = await Promise.all(
      files.map(async (file) => {
        const blobRes = await api.post('/git/blobs', {
          content: file.content.toString('base64'),
          encoding: 'base64',
        });
        const sha: unknown = blobRes.data?.sha;
        if (typeof sha !== 'string') {
          throw new GitHubApiError(502, 'GitHub did not return a blob SHA.');
        }
        return sha;
      }),
    );

    // 3. Base tree = the tree of the current head commit.
    const commitRes = await api.get(`/git/commits/${encodeURIComponent(headSha)}`);
    const baseTreeSha: unknown = commitRes.data?.tree?.sha;
    if (typeof baseTreeSha !== 'string') {
      throw new GitHubApiError(502, 'GitHub did not return the base tree SHA.');
    }

    // 4. New tree with the files layered on top of the base tree.
    const treeRes = await api.post('/git/trees', {
      base_tree: baseTreeSha,
      tree: files.map((file, i) => ({
        path: file.path,
        mode: '100644',
        type: 'blob',
        sha: blobShas[i],
      })),
    });
    const newTreeSha: unknown = treeRes.data?.sha;
    if (typeof newTreeSha !== 'string') {
      throw new GitHubApiError(502, 'GitHub did not return the new tree SHA.');
    }

    // 5. Commit the tree on top of the head commit.
    const newCommitRes = await api.post('/git/commits', {
      message,
      tree: newTreeSha,
      parents: [headSha],
    });
    const newCommitSha: unknown = newCommitRes.data?.sha;
    if (typeof newCommitSha !== 'string') {
      throw new GitHubApiError(502, 'GitHub did not return the commit SHA.');
    }

    // 6. Fast-forward the branch ref to the new commit.
    await api.patch(`/git/refs/heads/${encodeURIComponent(branch)}`, {
      sha: newCommitSha,
      force: false,
    });

    return {
      commitSha: newCommitSha,
      branch,
      committedPaths: files.map((file) => file.path),
    };
  } catch (err) {
    throw toGitHubError(err);
  }
}
