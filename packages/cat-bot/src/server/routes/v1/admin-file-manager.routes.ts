/**
 * Admin File Manager Routes — v1
 *
 * Mounted at /api/v1/admin/files by routes/v1/index.ts (BEFORE the generic
 * /admin router so the more specific file paths win). Every handler enforces
 * adminAuth session + role internally via requireAdmin().
 */

import { Router } from 'express';
import { adminFileManagerController } from '@/server/controllers/v1/admin-file-manager.controller.js';

const adminFileManagerRouter = Router();

// GET /api/v1/admin/files/meta — repo identity, default branch, configured flag
adminFileManagerRouter.get('/meta', (req, res) => {
  void adminFileManagerController.getMeta(req, res);
});

// GET /api/v1/admin/files?path=packages — list a folder ('' = repo root)
adminFileManagerRouter.get('/', (req, res) => {
  void adminFileManagerController.list(req, res);
});

// GET /api/v1/admin/files/content?path=README.md — read a file
adminFileManagerRouter.get('/content', (req, res) => {
  void adminFileManagerController.read(req, res);
});

// POST /api/v1/admin/files — create a file or folder (committed to the repo)
adminFileManagerRouter.post('/', (req, res) => {
  void adminFileManagerController.create(req, res);
});

// PUT /api/v1/admin/files — save/overwrite a file (committed to the repo)
adminFileManagerRouter.put('/', (req, res) => {
  void adminFileManagerController.save(req, res);
});

// PUT /api/v1/admin/files/rename — rename/move a file or folder
adminFileManagerRouter.put('/rename', (req, res) => {
  void adminFileManagerController.rename(req, res);
});

// DELETE /api/v1/admin/files?path=foo.ts — delete a file or folder
adminFileManagerRouter.delete('/', (req, res) => {
  void adminFileManagerController.delete(req, res);
});

export default adminFileManagerRouter;
