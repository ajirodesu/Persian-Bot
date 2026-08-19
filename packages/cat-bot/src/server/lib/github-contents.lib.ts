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
    // Name the failing endpoint so a bare "404: Not Found" (GitHub hides the
    // resource for both missing-branch and no-access) is at least traceable.
    const method = String(err.config?.method ?? 'get').toUpperCase();
    const url = typeof err.config?.url === 'string' ? err.config.url : '';
    const where = url ? ` ${method} ${url}` : '';
    return new GitHubApiError(status, `GitHub API ${status}${where}: ${detail}`);
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

export function getGitHubConfig(tokenOverride?: string): GitHubConfig {
  // A per-request token (the admin's own PAT, sent by the File Manager) wins
  // over the server env token so commits/pushes are attributed to the person
  // actually performing them.
  const token =
    typeof tokenOverride === 'string' && tokenOverride.trim() !== ''
      ? tokenOverride.trim()
      : (env.GITHUB_TOKEN ?? '');
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

/** The GitHub account that owns a personal access token — used to identify the
 *  admin operating the File Manager and to author their commits with the real
 *  GitHub username/name/email instead of a server-side fallback identity. */
export interface GitHubUserIdentity {
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/**
 * Identifies the GitHub user behind `token` via GET /user. Throws a
 * GitHubApiError (401 for an invalid/expired token) when the key is rejected.
 */
export async function getGitHubUserIdentity(
  token: string,
): Promise<GitHubUserIdentity> {
  const probe = axios.create({
    baseURL: 'https://api.github.com',
    headers: authHeaders(token),
    timeout: 30_000,
  });
  try {
    const res = await probe.get('/user');
    const data = res.data ?? {};
    const login =
      typeof data.login === 'string' && data.login !== '' ? data.login : '';
    if (!login) {
      throw new GitHubApiError(
        502,
        'GitHub did not return a username for this API key.',
      );
    }
    return {
      login,
      name: typeof data.name === 'string' && data.name !== '' ? data.name : null,
      email:
        typeof data.email === 'string' && data.email !== '' ? data.email : null,
      avatarUrl:
        typeof data.avatar_url === 'string' && data.avatar_url !== ''
          ? data.avatar_url
          : null,
    };
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 401) {
      throw new GitHubApiError(
        401,
        'Invalid GitHub API key — GitHub rejected it. Generate a new token ' +
          '(GitHub → Settings → Developer settings → Personal access tokens) and try again.',
      );
    }
    throw toGitHubError(err);
  }
}

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
 * A file entry to write inside a pushed commit (the Git tab's API push). The
 * local git blob SHA is content-addressed, so re-uploading the raw content
 * produces the SAME blob SHA on GitHub — which is what lets the recreation of
 * local commits keep their exact SHAs when author/committer/parents match.
 */
export interface GitHubCommitFileInput {
  /** Repository-relative path, e.g. `packages/cat-bot/src/app/commands/ping.ts`. */
  path: string;
  /** Raw file content (text or binary). */
  content: Buffer;
  /** Git blob mode — defaults to `100644` (a `100755` executable stays executable). */
  mode?: string | undefined;
}

/**
 * One commit to recreate on GitHub. Carries the author/committer from the local
 * commit so the recreated object hashes to the SAME SHA when the history is
 * linear — making the API push indistinguishable from a real `git push`.
 */
export interface GitHubCommitInput {
  /** Full commit message (subject + body). */
  message: string;
  author?: { name: string; email: string; date: string } | undefined;
  committer?: { name: string; email: string; date: string } | undefined;
  /** Files to add or update relative to the parent commit. */
  files: GitHubCommitFileInput[];
  /** Paths present in the parent commit that must be removed. */
  deletions: string[];
}

export interface GitHubPushResult {
  commitSha: string;
  commitUrl: string;
  /** Number of commits pushed. */
  pushedCount: number;
}

/**
 * The branch's current tip commit SHA on GitHub.
 *
 * A 404 means one of two things: the branch genuinely doesn't exist on GitHub
 * yet (a brand-new local branch — push will create it), OR the repo itself is
 * unreachable (wrong GITHUB_REPO_OWNER/GITHUB_REPO_NAME, or a token without
 * access, which GitHub also reports as 404). Both cases are disambiguated here
 * so callers get an actionable error instead of a bare "404: Not Found": the
 * repo is probed via getDefaultBranch, whose enriched error explains exactly
 * how to fix a repo-access problem when that is the cause.
 */
export async function getBranchTipSha(
  config: GitHubConfig,
  branch: string,
): Promise<string> {
  const api = createApi(config);
  try {
    const res = await api.get(`/git/ref/heads/${encodeURIComponent(branch)}`);
    const sha: unknown = res.data?.object?.sha;
    if (typeof sha !== 'string' || sha === '') {
      throw new GitHubApiError(
        502,
        `Could not resolve branch "${branch}" on GitHub.`,
      );
    }
    return sha;
  } catch (err) {
    if (axios.isAxiosError(err) && err.response?.status === 404) {
      let defaultBranch: string;
      try {
        defaultBranch = await getDefaultBranch(config);
      } catch {
        // The repo itself is the problem — surface getDefaultBranch's full
        // diagnostic (wrong owner, token access, etc.) for the original 404.
        throw await enrichRepoLookupError(err, config);
      }
      throw new GitHubApiError(
        404,
        `Branch "${branch}" does not exist in ${config.owner}/${config.repo} ` +
          `(default branch: "${defaultBranch}").`,
      );
    }
    throw toGitHubError(err);
  }
}

/**
 * Pushes a linear series of commits onto `branch` via the Git Data API —
 * the GitHub-API equivalent of a `git push`, used by the Admin Git tab so a
 * managed host (Render/Railway, where git push credentials don't exist) can
 * push its local commits exactly like /installer and /push do.
 *
 * `parentTipSha` must be the branch tip the commits were built on — the caller
 * resolves it with getBranchTipSha() and verifies locally that it is an
 * ancestor of HEAD (a real non-fast-forward check). The ref fast-forwards with
 * `force: false` only after every commit is created, so a remote that moved in
 * the meantime is rejected exactly like git would.
 *
 * With `createRef: true` the branch is pushed as a BRAND-NEW branch (git's
 * `git push -u origin <branch>` when no upstream exists): no tip-equality check
 * is possible, so the commits are built on `parentTipSha` (the verified default
 * branch tip) and the ref is created with POST /git/refs. A 422 from GitHub
 * (the branch appeared mid-flight) is surfaced as a 409 "pull first".
 */
export async function pushCommitsToGitHub(
  config: GitHubConfig,
  branch: string,
  parentTipSha: string,
  commits: GitHubCommitInput[],
  options: { createRef?: boolean } = {},
): Promise<GitHubPushResult> {
  if (commits.length === 0) {
    throw new GitHubApiError(400, 'Nothing to push — no unpushed commits were provided.');
  }
  const api = createApi(config);
  const createRef = options.createRef === true;
  try {
    // The branch must still sit exactly where our commits were built on — if it
    // moved (someone else pushed, or the bot itself pushed elsewhere), the
    // fast-forward below would fail anyway — fail early with a clear message.
    let parentSha: string;
    if (createRef) {
      // New branch: the commit chain simply starts at the parent the caller
      // verified (the default branch tip present in local history).
      parentSha = parentTipSha;
    } else {
      const tipRes = await api.get(`/git/ref/heads/${encodeURIComponent(branch)}`);
      const remoteTip: unknown = tipRes.data?.object?.sha;
      if (typeof remoteTip !== 'string' || remoteTip === '') {
        throw new GitHubApiError(502, `Could not resolve branch "${branch}" on GitHub.`);
      }
      if (remoteTip !== parentTipSha) {
        throw new GitHubApiError(
          409,
          `The branch \`${branch}\` moved on GitHub since the check (remote is ` +
            `\`${remoteTip.slice(0, 7)}\`). Pull the latest changes first, then try again.`,
        );
      }
      parentSha = remoteTip;
    }
    let baseTreeSha: string | null = null;
    let lastSha = parentSha;

    for (const commit of commits) {
      // 1. One blob per changed file (parallel).
      const blobShas = await Promise.all(
        commit.files.map(async (file) => {
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

      // 2. Base tree = the tree of the parent commit (fetched once).
      if (baseTreeSha === null) {
        const headRes = await api.get(`/git/commits/${encodeURIComponent(parentSha)}`);
        const tree: unknown = headRes.data?.tree?.sha;
        if (typeof tree !== 'string') {
          throw new GitHubApiError(502, 'GitHub did not return the parent tree SHA.');
        }
        baseTreeSha = tree;
      }

      // 3. New tree layering the commit's changes (deletes use `sha: null`).
      const entries: Array<Record<string, unknown>> = [
        ...commit.files.map((file, i) => ({
          path: file.path,
          mode: file.mode ?? '100644',
          type: 'blob',
          sha: blobShas[i],
        })),
        ...commit.deletions.map((path) => ({
          path,
          mode: '100644',
          type: 'blob',
          sha: null,
        })),
      ];

      let newTreeSha: string = baseTreeSha;
      if (entries.length > 0) {
        const treeRes = await api.post('/git/trees', {
          base_tree: baseTreeSha,
          tree: entries,
        });
        const treeSha: unknown = treeRes.data?.sha;
        if (typeof treeSha !== 'string') {
          throw new GitHubApiError(502, 'GitHub did not return the new tree SHA.');
        }
        newTreeSha = treeSha;
      }

      // 4. Recreate the commit with its original author/committer so the object
      //    hashes to the same SHA as the local one (when history is linear).
      const commitBody: Record<string, unknown> = {
        message: commit.message,
        tree: newTreeSha,
        parents: [parentSha],
      };
      if (commit.author) commitBody['author'] = commit.author;
      if (commit.committer) commitBody['committer'] = commit.committer;

      const commitRes = await api.post('/git/commits', commitBody);
      const newSha: unknown = commitRes.data?.sha;
      if (typeof newSha !== 'string') {
        throw new GitHubApiError(502, 'GitHub did not return the commit SHA.');
      }
      parentSha = newSha;
      baseTreeSha = newTreeSha;
      lastSha = newSha;
    }

    // 5. Point the branch ref at the new tip once every commit exists.
    if (createRef) {
      try {
        await api.post('/git/refs', {
          ref: `refs/heads/${branch}`,
          sha: lastSha,
        });
      } catch (refErr) {
        if (axios.isAxiosError(refErr) && refErr.response?.status === 422) {
          // The branch appeared on GitHub while we were pushing (someone else
          // created it) — refuse like git would.
          throw new GitHubApiError(
            409,
            `The branch \`${branch}\` was just created on GitHub while pushing — ` +
              'pull the latest changes first, then try again.',
          );
        }
        throw refErr;
      }
    } else {
      await api.patch(`/git/refs/heads/${encodeURIComponent(branch)}`, {
        sha: lastSha,
        force: false,
      });
    }

    return {
      commitSha: lastSha,
      commitUrl: `https://github.com/${config.owner}/${config.repo}/commit/${lastSha}`,
      pushedCount: commits.length,
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
