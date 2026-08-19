/**
 * Admin File Manager Controller — /api/v1/admin/files
 *
 * A LOCAL repository file manager for system admins. The File Manager edits the
 * working tree of a real git checkout (ADMIN_REPO_PATH, or the checkout this
 * process runs in). Reads hit disk; mutations write files but NEVER commit or
 * push. A companion set of git routes (/api/v1/admin/files/git/*) controls the
 * explicit stage → commit → push workflow surfaced by the Git tab.
 *
 * Auth: every handler calls requireAdmin() (adminAuth session + role check)
 * before touching the repository, matching the pattern of admin.controller.ts.
 */

import type { Request, Response } from 'express';
import { requireAdmin } from '@/server/validators/auth-session.validator.js';
import { RepoFileManagerError } from '@/server/lib/local-git.lib.js';
import {
  GitHubApiError,
  getGitHubUserIdentity,
  type GitHubUserIdentity,
} from '@/server/lib/github-contents.lib.js';
import {
  createFile,
  createFolder,
  deleteEntry,
  getRepoMeta,
  listDirectory,
  listTree,
  readFile,
  renameEntry,
  saveFile,
} from '@/server/lib/local-file-manager.lib.js';
import {
  checkoutBranch,
  commitStaged,
  createBranch,
  discardChanges,
  getCommitLog,
  getFileDiff,
  getGitStatus,
  listBranches,
  pullCurrent,
  pushCurrent,
  stagePaths,
  unstagePaths,
} from '@/server/lib/local-git.lib.js';

/** Header the admin's GitHub personal access token is sent in. */
const GITHUB_TOKEN_HEADER = 'x-github-token';

/** Reads the admin's GitHub PAT from the request headers (or falls back to the
 *  server env token). Returns null when neither is present. */
function getGitHubToken(req: Request): string | null {
  const header =
    typeof req.headers[GITHUB_TOKEN_HEADER] === 'string'
      ? (req.headers[GITHUB_TOKEN_HEADER] as string).trim()
      : '';
  if (header !== '') return header;
  return null;
}

class AdminFileManagerController {
  // GET /api/v1/admin/files/meta — repo identity + branch + configured flag.
  async getMeta(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      res.json(await getRepoMeta());
    } catch (err) {
      this.#handleError(res, err, 'Failed to load repository metadata');
    }
  }

  // GET /api/v1/admin/files?path=packages — list a folder ('' = repo root).
  async list(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const dir = typeof req.query['path'] === 'string' ? req.query['path'] : '';
      res.json(await listDirectory(dir));
    } catch (err) {
      this.#handleError(res, err, 'Failed to list folder');
    }
  }

  // GET /api/v1/admin/files/tree — recursive index of every file/folder.
  async tree(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      res.json(await listTree());
    } catch (err) {
      this.#handleError(res, err, 'Failed to load repository tree');
    }
  }

  // GET /api/v1/admin/files/content?path=README.md — read a file.
  async read(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const filePath = typeof req.query['path'] === 'string' ? req.query['path'] : '';
      res.json(await readFile(filePath));
    } catch (err) {
      this.#handleError(res, err, 'Failed to read file');
    }
  }

  // POST /api/v1/admin/files — create a file or folder (working tree only).
  async create(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const path = typeof req.body?.path === 'string' ? req.body.path : '';
      const type = req.body?.type === 'folder' ? 'folder' : 'file';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      if (!path) {
        res.status(400).json({ error: 'Missing path' });
        return;
      }
      const result =
        type === 'folder' ? await createFolder(path) : await createFile(path, content);
      res.status(201).json({ path, type, ...result });
    } catch (err) {
      this.#handleError(res, err, 'Failed to create entry');
    }
  }

  // PUT /api/v1/admin/files — overwrite a file (working tree only).
  async save(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const path = typeof req.body?.path === 'string' ? req.body.path : '';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      if (!path) {
        res.status(400).json({ error: 'Missing path' });
        return;
      }
      const result = await saveFile(path, content);
      res.json({ path, ...result });
    } catch (err) {
      this.#handleError(res, err, 'Failed to save file');
    }
  }

  // PUT /api/v1/admin/files/rename — move a file or folder (working tree only).
  async rename(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const from = typeof req.body?.from === 'string' ? req.body.from : '';
      const to = typeof req.body?.to === 'string' ? req.body.to : '';
      if (!from || !to) {
        res.status(400).json({ error: 'Missing from/to paths' });
        return;
      }
      const result = await renameEntry(from, to);
      res.json({ from, to, ...result });
    } catch (err) {
      this.#handleError(res, err, 'Failed to rename entry');
    }
  }

  // DELETE /api/v1/admin/files?path=foo.ts — delete a file or folder.
  async delete(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const path = typeof req.query['path'] === 'string' ? req.query['path'] : '';
      if (!path) {
        res.status(400).json({ error: 'Missing path' });
        return;
      }
      const result = await deleteEntry(path);
      res.json({ path, ...result });
    } catch (err) {
      this.#handleError(res, err, 'Failed to delete entry');
    }
  }

  // ── Git routes (working-tree/sync panel) ────────────────────────────────────

  // GET /api/v1/admin/files/git/status — branch, upstream, ahead/behind, changes.
  async gitStatus(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      res.json(await getGitStatus());
    } catch (err) {
      this.#handleError(res, err, 'Failed to load git status');
    }
  }

  // GET /api/v1/admin/files/git/diff?path=a.ts&staged=1 — unified diff.
  async gitDiff(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const path = typeof req.query['path'] === 'string' ? req.query['path'] : '';
      const staged = req.query['staged'] === '1' || req.query['staged'] === 'true';
      res.json({ path, staged, diff: await getFileDiff(path, staged) });
    } catch (err) {
      this.#handleError(res, err, 'Failed to load diff');
    }
  }

  // POST /api/v1/admin/files/git/stage {paths?} — stage paths (all when empty).
  async gitStage(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const paths = Array.isArray(req.body?.paths)
        ? (req.body.paths as unknown[]).filter((p): p is string => typeof p === 'string')
        : [];
      await stagePaths(paths);
      res.json({ ok: true });
    } catch (err) {
      this.#handleError(res, err, 'Failed to stage changes');
    }
  }

  // POST /api/v1/admin/files/git/unstage {paths?} — unstage paths (all when empty).
  async gitUnstage(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const paths = Array.isArray(req.body?.paths)
        ? (req.body.paths as unknown[]).filter((p): p is string => typeof p === 'string')
        : [];
      await unstagePaths(paths);
      res.json({ ok: true });
    } catch (err) {
      this.#handleError(res, err, 'Failed to unstage changes');
    }
  }

  // POST /api/v1/admin/files/git/commit {message} — commit the staged changes.
  // Requires the admin's GitHub API key (x-github-token header): the key
  // identifies the authenticated GitHub user and their identity is used as the
  // commit author, so commits carry the real GitHub username/name/email.
  async gitCommit(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const identity = await this.#requireGitHubIdentity(req, res);
    if (!identity) return;
    try {
      const message = typeof req.body?.message === 'string' ? req.body.message : '';
      const email = identity.email ?? `${identity.login}@users.noreply.github.com`;
      const name = identity.name ?? identity.login;
      const result = await commitStaged(message, { name, email });
      res.json({
        ok: true,
        ...result,
        author: { login: identity.login, name: identity.name, email },
      });
    } catch (err) {
      this.#handleError(res, err, 'Failed to commit');
    }
  }

  // POST /api/v1/admin/files/git/push — push unpushed commits to GitHub.
  // Authenticated with the admin's GitHub API key; pushes DIRECTLY to the
  // repository's default branch (main) and never creates another branch.
  async gitPush(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const identity = await this.#requireGitHubIdentity(req, res);
    if (!identity) return;
    try {
      const token = getGitHubToken(req);
      const message = await pushCurrent(token ?? undefined);
      res.json({ ok: true, message, author: identity.login });
    } catch (err) {
      this.#handleError(res, err, 'Failed to push');
    }
  }

  // POST /api/v1/admin/files/git/identity — verify the admin's GitHub API key
  // and return the authenticated user's identity (login/name/email/avatar).
  async gitIdentity(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const identity = await this.#requireGitHubIdentity(req, res);
    if (!identity) return;
    res.json(identity);
  }

  // POST /api/v1/admin/files/git/pull — pull the current branch from upstream.
  async gitPull(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const message = await pullCurrent();
      res.json({ ok: true, message });
    } catch (err) {
      this.#handleError(res, err, 'Failed to pull');
    }
  }

  // GET /api/v1/admin/files/git/log?limit=15 — recent commit history.
  async gitLog(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const limit = Number.parseInt(String(req.query['limit'] ?? '15'), 10) || 15;
      res.json({ commits: await getCommitLog(limit) });
    } catch (err) {
      this.#handleError(res, err, 'Failed to load commit history');
    }
  }

  // GET /api/v1/admin/files/git/branches — local branch names.
  async gitBranches(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      res.json({ branches: await listBranches() });
    } catch (err) {
      this.#handleError(res, err, 'Failed to load branches');
    }
  }

  // POST /api/v1/admin/files/git/checkout {branch} — switch to a local branch.
  async gitCheckout(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const branch = typeof req.body?.branch === 'string' ? req.body.branch : '';
      if (!branch) {
        res.status(400).json({ error: 'Missing branch name' });
        return;
      }
      const message = await checkoutBranch(branch);
      res.json({ ok: true, message });
    } catch (err) {
      this.#handleError(res, err, 'Failed to checkout branch');
    }
  }

  // POST /api/v1/admin/files/git/discard {paths} — discard working-tree changes.
  async gitDiscard(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const paths = Array.isArray(req.body?.paths)
        ? (req.body.paths as unknown[]).filter((p): p is string => typeof p === 'string')
        : [];
      await discardChanges(paths);
      res.json({ ok: true });
    } catch (err) {
      this.#handleError(res, err, 'Failed to discard changes');
    }
  }

  // POST /api/v1/admin/files/git/branches {name} — create + switch to a new branch.
  async gitCreateBranch(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const name = typeof req.body?.name === 'string' ? req.body.name : '';
      if (!name) {
        res.status(400).json({ error: 'Missing branch name' });
        return;
      }
      const message = await createBranch(name);
      res.json({ ok: true, message });
    } catch (err) {
      this.#handleError(res, err, 'Failed to create branch');
    }
  }

  /**
   * Authenticates the admin via their GitHub API key and identifies who they
   * are. Returns the GitHub identity on success, or writes a 401/400 response
   * and returns null. A missing key is a 401; an invalid/expired key (GitHub
   * rejects it) is a 401 with an actionable message.
   */
  async #requireGitHubIdentity(
    req: Request,
    res: Response,
  ): Promise<GitHubUserIdentity | null> {
    const token = getGitHubToken(req);
    if (!token) {
      res.status(401).json({
        error:
          'A GitHub API key is required — send it in the x-github-token header to commit and push.',
      });
      return null;
    }
    try {
      return await getGitHubUserIdentity(token);
    } catch (err) {
      this.#handleError(res, err, 'Failed to verify GitHub API key');
      return null;
    }
  }

  /** Central error mapping — repo errors keep their status; the rest become 500. */
  #handleError(res: Response, err: unknown, fallback: string): void {
    if (err instanceof RepoFileManagerError || err instanceof GitHubApiError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(`[AdminFileManagerController] ${fallback}`, err);
    res.status(500).json({ error: fallback });
  }
}

export const adminFileManagerController = new AdminFileManagerController();