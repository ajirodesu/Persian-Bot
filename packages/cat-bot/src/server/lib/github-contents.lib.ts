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

/**
 * The write endpoints (blobs/trees/commits/refs — all under the Git Data API)
 * need **Contents: Read and write** on the repo. A fine-grained token that can
 * read the repo but is missing write access fails with the cryptic
 * "403: Resource not accessible by personal access token" — turn that into the
 * exact fix.
 */
function enrichWriteError(err: unknown, config: GitHubConfig): GitHubApiError {
  const base = toGitHubError(err);
  if (base.status !== 403) return base;
  const isFineGrained = config.token.startsWith('github_pat_');
  const hint = isFineGrained
    ? 'The token can read the repo but has no write access. Edit it at GitHub → Settings → ' +
      'Developer settings → Fine-grained personal access tokens: this repo needs **Contents: ' +
      'Read and write** (Metadata: Read is included automatically). The commit writes go ' +
      'through the Git Data API (blobs, trees, commits, refs) — all covered by Contents.'
    : 'The token can read the repo but has no write access — a classic PAT needs the `repo` ' +
      'scope (or `public_repo` for a public repo).';
  return new GitHubApiError(base.status, `${base.message} — ${hint}`);
}

// ── Config ────────────────────────────────────────────────────────────────────

// Startup sanity check (mirrors the reference /ghp command): warn loudly when
// the GitHub env vars aren't fully set — /push and /installer rely on them.
// Uses exactly the project's canonical env names (env.config.ts).
if (!env.GITHUB_TOKEN || !env.GITHUB_REPO_OWNER || !env.GITHUB_REPO_NAME) {
  console.error(
    '[ghp] GITHUB_TOKEN / GITHUB_REPO_OWNER / GITHUB_REPO_NAME are not fully set — ' +
      'this command will fail until they are added to your environment variables.',
  );
}

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
 * to write to. Reads exactly the project's current env (env.config.ts):
 * GITHUB_TOKEN / GITHUB_REPO_OWNER / GITHUB_REPO_NAME (+ optional
 * GITHUB_REPO_BASE_PATH).
 */
/**
 * Cleans raw owner/repo env values into API-ready refs. Handles the common
 * paste mistakes: full `https://github.com/owner/repo` URLs, `.git` suffixes,
 * and stray whitespace. An owner field that accidentally holds a whole
 * `owner/repo` is split apart; a repo field that holds a full URL keeps only
 * its last path segment.
 */
function resolveOwnerAndRepo(rawOwner: string, rawRepo: string): { owner: string; repo: string } {
  const strip = (value: string): string =>
    value
      .trim()
      // Remove invisible/zero-width characters that sneak in when an env value
      // is copied from a web page (zero-width space, ZWNJ/ZWJ, BOM, soft
      // hyphen, word joiner). They render identically in logs but change the
      // URL, making GitHub return 404 for a repo that clearly exists.
      .replace(/[\u200B-\u200D\uFEFF\u00AD\u2060\u180E]/g, '')
      .replace(/^https?:\/\/(www\.)?github\.com\//i, '')
      .replace(/^git@github\.com:/i, '')
      .replace(/^\/+|\/+$/g, '')
      .replace(/\.git$/i, '');

  let owner = strip(rawOwner);
  let repo = strip(rawRepo);

  const ownerParts = owner.split('/').filter(Boolean);
  if (ownerParts.length >= 2) {
    // The owner field holds a full `owner/repo` (or a pasted repo URL).
    owner = ownerParts[0]!;
    if (!repo) repo = ownerParts[1]!;
  }
  const repoParts = repo.split('/').filter(Boolean);
  if (repoParts.length >= 2) repo = repoParts[repoParts.length - 1]!;

  return { owner, repo };
}

export function getGitHubConfig(): GitHubConfig {
  const token = env.GITHUB_TOKEN ?? '';
  const { owner, repo } = resolveOwnerAndRepo(
    env.GITHUB_REPO_OWNER ?? '',
    env.GITHUB_REPO_NAME ?? '',
  );
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

function authHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'cat-bot',
  };
}

function createApi(config: GitHubConfig) {
  return axios.create({
    baseURL: `https://api.github.com/repos/${config.owner}/${config.repo}`,
    headers: authHeaders(config.token),
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
    // NOTE: hit the repo URL WITHOUT a trailing slash. GitHub returns 404 for
    // GET /repos/{owner}/{repo}/ (verified against a public repo), and axios's
    // baseURL + '/' would produce exactly that — so use the explicit absolute
    // URL here rather than `createApi(config).get('/')`.
    const res = await createApi(config).get(
      `https://api.github.com/repos/${config.owner}/${config.repo}`,
    );
    const branch: unknown = res.data?.default_branch;
    return typeof branch === 'string' && branch !== '' ? branch : 'main';
  } catch (err) {
    throw await enrichRepoLookupError(err, config);
  }
}

/**
 * Turns the bare "GitHub API 404: Not Found" from a failed repo lookup into
 * an actionable diagnosis: whether the token itself is valid, and whether the
 * repo exists under the token's own account (i.e. the owner env var is wrong).
 * Non-repo-lookup failures pass through unchanged.
 */
async function enrichRepoLookupError(err: unknown, config: GitHubConfig): Promise<GitHubApiError> {
  const base = toGitHubError(err);

  // Only repo visibility failures (401/404 on GET /repos/{owner}/{repo}) get
  // the full diagnostic — everything else is passed through untouched.
  if (base.status !== 404 && base.status !== 401) return base;

  const probe = axios.create({
    baseURL: 'https://api.github.com',
    headers: authHeaders(config.token),
    timeout: 30_000,
  });

  // 1. Is the token itself valid? GET /user also reveals which account it
  //    belongs to, which we can compare against GITHUB_REPO_OWNER.
  let tokenLogin: string | null;
  try {
    const user = await probe.get('/user');
    tokenLogin = typeof user.data?.login === 'string' ? (user.data.login as string) : null;
  } catch {
    const hint =
      'GITHUB_TOKEN is invalid or expired — GitHub rejected it. Generate a new token ' +
      '(GitHub → Settings → Developer settings → Personal access tokens) and update the env var.';
    return new GitHubApiError(base.status, `${base.message} — ${hint}`);
  }

  if (base.status === 404 && tokenLogin) {
    // 2. Maybe the owner is wrong — try the repo under the token's own
    //    account. Skip this when the env owner already matches the token's
    //    account (e.g. an invisible character hiding in the env value made
    //    the URL differ even though it renders the same) — then the "set it
    //    to the token's account" advice would be circular, so fall straight
    //    to the enumeration below.
    const ownerMatchesToken =
      config.owner.toLowerCase() === tokenLogin.toLowerCase();
    if (!ownerMatchesToken) {
      try {
        await probe.get(`/repos/${tokenLogin}/${config.repo}`);
        const hint =
          `the repo exists under the token's account \`${tokenLogin}\`, but ` +
          `GITHUB_REPO_OWNER is set to \`${config.owner}\`. Set GITHUB_REPO_OWNER ` +
          `to \`${tokenLogin}\` and try again.`;
        return new GitHubApiError(base.status, `${base.message} — ${hint}`);
      } catch {
        // Fall through to the enumeration below.
      }
    }
    {
      // 3. Enumerate the repos this token can actually see and look for the
      //    target repo — this distinguishes a wrong owner from a token that
      //    simply hasn't been granted the repo (very common with fine-grained
      //    PATs, which hide un-granted repos as 404 rather than 403).
      let grantedRepos: string[] = [];
      try {
        const repos = await probe.get('/user/repos', { params: { per_page: 100 } });
        const items: Array<{ full_name?: unknown }> = Array.isArray(repos.data)
          ? (repos.data as Array<{ full_name?: unknown }>)
          : [];
        grantedRepos = items
          .map((repo) => (typeof repo.full_name === 'string' ? repo.full_name : ''))
          .filter(Boolean);
      } catch {
        // Enumeration failed — fall through to the generic hint.
      }

      const target = config.repo.toLowerCase();
      const match = grantedRepos.find((full) =>
        full.toLowerCase().endsWith(`/${target}`),
      );
      if (match) {
        const correctOwner = match.split('/')[0];
        const hint =
          `the repo exists as \`${match}\`, but GITHUB_REPO_OWNER is set to ` +
          `\`${config.owner}\`. Set GITHUB_REPO_OWNER to ` +
          `\`${correctOwner}\` and try again.`;
        return new GitHubApiError(base.status, `${base.message} — ${hint}`);
      }

      const isFineGrained = config.token.startsWith('github_pat_');
      const scopeHint = isFineGrained
        ? 'This looks like a fine-grained token (github_pat_…). Edit it at GitHub → Settings → ' +
          'Developer settings → Fine-grained personal access tokens: select this repo under ' +
          '“Repository access”, and give it **Contents: Read and write** (Metadata: Read is ' +
          'included automatically).'
        : 'If the repo is private, the token needs the `repo` scope (or `public_repo` for a ' +
          'public one) — regenerate a classic token with that scope.';
      const hint =
        `the token can't see the repo \`${config.repo}\` under \`${config.owner}\` (it can ` +
        `see ${grantedRepos.length} repo(s) total). ${scopeHint}`;
      return new GitHubApiError(base.status, `${base.message} — ${hint}`);
    }
  }

  return base;
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
  /** Link to the commit on github.com. */
  commitUrl: string;
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
      commitUrl: `https://github.com/${config.owner}/${config.repo}/commit/${newCommitSha}`,
    };
  } catch (err) {
    throw enrichWriteError(err, config);
  }
}

/**
 * Single-file convenience wrapper matching the reference /ghp command's
 * `pushFileToGithub(buffer, repoPath, commitMessage)` API — lands one file on
 * the repo as a commit and returns its link. `branch` defaults to the repo's
 * default branch.
 */
export async function pushFileToGithub(
  config: GitHubConfig,
  file: GitHubFileInput,
  message: string,
  branch?: string,
): Promise<GitHubCommitResult> {
  const targetBranch = branch ?? (await getDefaultBranch(config));
  return pushFilesToGitHub(config, [file], message, targetBranch);
}
