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

// GET /api/v1/admin/files/meta — repo identity, branch, configured flag
adminFileManagerRouter.get('/meta', (req, res) => {
  void adminFileManagerController.getMeta(req, res);
});

// GET /api/v1/admin/files?path=packages — list a folder ('' = repo root)
adminFileManagerRouter.get('/', (req, res) => {
  void adminFileManagerController.list(req, res);
});

// GET /api/v1/admin/files/tree — recursive index of every file/folder
adminFileManagerRouter.get('/tree', (req, res) => {
  void adminFileManagerController.tree(req, res);
});

// GET /api/v1/admin/files/content?path=README.md — read a file
adminFileManagerRouter.get('/content', (req, res) => {
  void adminFileManagerController.read(req, res);
});

// POST /api/v1/admin/files — create a file or folder (working tree only)
adminFileManagerRouter.post('/', (req, res) => {
  void adminFileManagerController.create(req, res);
});

// PUT /api/v1/admin/files — save/overwrite a file (working tree only)
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

// ── Git routes (working-tree / sync panel) ────────────────────────────────────

// GET /api/v1/admin/files/git/status — branch, upstream, ahead/behind, changes
adminFileManagerRouter.get('/git/status', (req, res) => {
  void adminFileManagerController.gitStatus(req, res);
});

// GET /api/v1/admin/files/git/diff?path=a.ts&staged=1 — unified diff
adminFileManagerRouter.get('/git/diff', (req, res) => {
  void adminFileManagerController.gitDiff(req, res);
});

// POST /api/v1/admin/files/git/stage {paths?} — stage paths (all when empty)
adminFileManagerRouter.post('/git/stage', (req, res) => {
  void adminFileManagerController.gitStage(req, res);
});

// POST /api/v1/admin/files/git/unstage {paths?} — unstage paths
adminFileManagerRouter.post('/git/unstage', (req, res) => {
  void adminFileManagerController.gitUnstage(req, res);
});

// POST /api/v1/admin/files/git/commit {message} — commit the staged changes
adminFileManagerRouter.post('/git/commit', (req, res) => {
  void adminFileManagerController.gitCommit(req, res);
});

// GET /api/v1/admin/files/git/identity — verify the GitHub API key and return
// the authenticated user's GitHub identity (login/name/email/avatar).
adminFileManagerRouter.post('/git/identity', (req, res) => {
  void adminFileManagerController.gitIdentity(req, res);
});

// GET /api/v1/admin/files/git/config — global GitHub token status + identity
adminFileManagerRouter.get('/git/config', (req, res) => {
  void adminFileManagerController.gitConfig(req, res);
});

// DELETE /api/v1/admin/files/git/config — disconnect the global GitHub token
adminFileManagerRouter.delete('/git/config', (req, res) => {
  void adminFileManagerController.gitConfigDelete(req, res);
});

// POST /api/v1/admin/files/git/push — push the current branch upstream
adminFileManagerRouter.post('/git/push', (req, res) => {
  void adminFileManagerController.gitPush(req, res);
});

// POST /api/v1/admin/files/git/pull — pull the current branch from upstream
adminFileManagerRouter.post('/git/pull', (req, res) => {
  void adminFileManagerController.gitPull(req, res);
});

// GET /api/v1/admin/files/git/log?limit=15 — recent commit history
adminFileManagerRouter.get('/git/log', (req, res) => {
  void adminFileManagerController.gitLog(req, res);
});

// GET /api/v1/admin/files/git/branches — local branch names
adminFileManagerRouter.get('/git/branches', (req, res) => {
  void adminFileManagerController.gitBranches(req, res);
});

// POST /api/v1/admin/files/git/checkout {branch} — switch to a local branch
adminFileManagerRouter.post('/git/checkout', (req, res) => {
  void adminFileManagerController.gitCheckout(req, res);
});

// POST /api/v1/admin/files/git/discard {paths} — discard working-tree changes
adminFileManagerRouter.post('/git/discard', (req, res) => {
  void adminFileManagerController.gitDiscard(req, res);
});

// POST /api/v1/admin/files/git/branches {name} — create + switch to a new branch
adminFileManagerRouter.post('/git/branches', (req, res) => {
  void adminFileManagerController.gitCreateBranch(req, res);
});

export default adminFileManagerRouter;