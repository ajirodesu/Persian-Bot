/**
 * Admin File Manager Controller — /api/v1/admin/files
 *
 * A GitHub-native repository file manager for system admins. Every operation
 * hits the configured GitHub repo directly (Contents / Trees / Commits APIs)
 * and every mutation produces a real commit on the default branch — the repo is
 * the source of truth, mirroring GitHub's own web file manager.
 *
 * Auth: every handler calls requireAdmin() (adminAuth session + role check)
 * before touching the repository, matching the pattern of admin.controller.ts.
 */

import type { Request, Response } from 'express';
import { requireAdmin } from '@/server/validators/auth-session.validator.js';
import {
  RepoFileManagerError,
  createFile,
  createFolder,
  deleteEntry,
  getRepoMeta,
  listDirectory,
  readFile,
  renameEntry,
  saveFile,
} from '@/server/lib/github-file-manager.lib.js';

export class AdminFileManagerController {
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

  // POST /api/v1/admin/files — create a file (optionally with content) or folder.
  async create(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const path = typeof req.body?.path === 'string' ? req.body.path : '';
      const type = req.body?.type === 'folder' ? 'folder' : 'file';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      const message = typeof req.body?.message === 'string' ? req.body.message : '';
      if (!path) {
        res.status(400).json({ error: 'Missing path' });
        return;
      }
      const result =
        type === 'folder'
          ? await createFolder(path, message)
          : await createFile(path, content, message);
      res.status(201).json({ path, type, ...result });
    } catch (err) {
      this.#handleError(res, err, 'Failed to create entry');
    }
  }

  // PUT /api/v1/admin/files — overwrite a file and commit it.
  async save(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const path = typeof req.body?.path === 'string' ? req.body.path : '';
      const content = typeof req.body?.content === 'string' ? req.body.content : '';
      const message = typeof req.body?.message === 'string' ? req.body.message : '';
      if (!path) {
        res.status(400).json({ error: 'Missing path' });
        return;
      }
      const result = await saveFile(path, content, message);
      res.json({ path, ...result });
    } catch (err) {
      this.#handleError(res, err, 'Failed to save file');
    }
  }

  // PUT /api/v1/admin/files/rename — move a file or folder (committed on GitHub).
  async rename(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const from = typeof req.body?.from === 'string' ? req.body.from : '';
      const to = typeof req.body?.to === 'string' ? req.body.to : '';
      const message = typeof req.body?.message === 'string' ? req.body.message : '';
      if (!from || !to) {
        res.status(400).json({ error: 'Missing from/to paths' });
        return;
      }
      const result = await renameEntry(from, to, message);
      res.json({ from, to, ...result });
    } catch (err) {
      this.#handleError(res, err, 'Failed to rename entry');
    }
  }

  // DELETE /api/v1/admin/files?path=foo.ts&message=... — delete a file or folder.
  async delete(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const path = typeof req.query['path'] === 'string' ? req.query['path'] : '';
      const message = typeof req.query['message'] === 'string' ? req.query['message'] : '';
      if (!path) {
        res.status(400).json({ error: 'Missing path' });
        return;
      }
      const result = await deleteEntry(path, message);
      res.json({ path, ...result });
    } catch (err) {
      this.#handleError(res, err, 'Failed to delete entry');
    }
  }

  /** Central error mapping — repo errors keep their status; the rest become 500. */
  #handleError(res: Response, err: unknown, fallback: string): void {
    if (err instanceof RepoFileManagerError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(`[AdminFileManagerController] ${fallback}`, err);
    res.status(500).json({ error: fallback });
  }
}

export const adminFileManagerController = new AdminFileManagerController();
