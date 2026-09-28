/**
 * Admin File Manager Routes — v1
 *
 * Mounted at /api/v1/admin/files by routes/v1/index.ts (BEFORE the generic
 * /admin router so the more specific file paths win). Every handler enforces
 * adminAuth session + role internally via requireAdmin().
 */

import { Router } from 'express';
import { adminFileManagerController } from '@/server/controllers/v1/admin-file-manager.controller.js';
import { asyncHandler } from '@/server/middleware/async-handler.middleware.js';

const adminFileManagerRouter = Router();

// GET /api/v1/admin/files/meta — repo identity, branch, configured flag
adminFileManagerRouter.get('/meta', asyncHandler((req, res) => adminFileManagerController.getMeta(req, res)));

// GET /api/v1/admin/files/overview — aggregated page-mount payload (see controller).
adminFileManagerRouter.get('/overview', asyncHandler((req, res) => adminFileManagerController.overview(req, res)));

// GET /api/v1/admin/files?path=packages — list a folder ('' = repo root)
adminFileManagerRouter.get('/', asyncHandler((req, res) => adminFileManagerController.list(req, res)));

// GET /api/v1/admin/files/tree — recursive index of every file/folder
adminFileManagerRouter.get('/tree', asyncHandler((req, res) => adminFileManagerController.tree(req, res)));

// GET /api/v1/admin/files/content?path=README.md — read a file
adminFileManagerRouter.get('/content', asyncHandler((req, res) => adminFileManagerController.read(req, res)));

// POST /api/v1/admin/files — create a file or folder (working tree only)
adminFileManagerRouter.post('/', asyncHandler((req, res) => adminFileManagerController.create(req, res)));

// PUT /api/v1/admin/files — save/overwrite a file (working tree only)
adminFileManagerRouter.put('/', asyncHandler((req, res) => adminFileManagerController.save(req, res)));

// PUT /api/v1/admin/files/rename — rename/move a file or folder
adminFileManagerRouter.put('/rename', asyncHandler((req, res) => adminFileManagerController.rename(req, res)));

// DELETE /api/v1/admin/files?path=foo.ts — delete a file or folder
adminFileManagerRouter.delete('/', asyncHandler((req, res) => adminFileManagerController.delete(req, res)));

// ── Git routes (working-tree / sync panel) ────────────────────────────────────

// GET /api/v1/admin/files/git/status — branch, upstream, ahead/behind, changes
adminFileManagerRouter.get('/git/status', asyncHandler((req, res) => adminFileManagerController.gitStatus(req, res)));

// GET /api/v1/admin/files/git/diff?path=a.ts&staged=1 — unified diff
adminFileManagerRouter.get('/git/diff', asyncHandler((req, res) => adminFileManagerController.gitDiff(req, res)));

// POST /api/v1/admin/files/git/stage {paths?} — stage paths (all when empty)
adminFileManagerRouter.post('/git/stage', asyncHandler((req, res) => adminFileManagerController.gitStage(req, res)));

// POST /api/v1/admin/files/git/unstage {paths?} — unstage paths
adminFileManagerRouter.post('/git/unstage', asyncHandler((req, res) => adminFileManagerController.gitUnstage(req, res)));

// POST /api/v1/admin/files/git/commit {message} — commit the staged changes
adminFileManagerRouter.post('/git/commit', asyncHandler((req, res) => adminFileManagerController.gitCommit(req, res)));

// GET /api/v1/admin/files/git/identity — verify the GitHub API key and return
// the authenticated user's GitHub identity (login/name/email/avatar).
adminFileManagerRouter.post('/git/identity', asyncHandler((req, res) => adminFileManagerController.gitIdentity(req, res)));

// GET /api/v1/admin/files/git/config — global GitHub token status + identity
adminFileManagerRouter.get('/git/config', asyncHandler((req, res) => adminFileManagerController.gitConfig(req, res)));

// DELETE /api/v1/admin/files/git/config — disconnect the global GitHub token
adminFileManagerRouter.delete('/git/config', asyncHandler((req, res) => adminFileManagerController.gitConfigDelete(req, res)));

// POST /api/v1/admin/files/git/push — push the current branch upstream
adminFileManagerRouter.post('/git/push', asyncHandler((req, res) => adminFileManagerController.gitPush(req, res)));

// POST /api/v1/admin/files/git/pull — pull the current branch from upstream
adminFileManagerRouter.post('/git/pull', asyncHandler((req, res) => adminFileManagerController.gitPull(req, res)));

// GET /api/v1/admin/files/git/log?limit=15 — recent commit history
adminFileManagerRouter.get('/git/log', asyncHandler((req, res) => adminFileManagerController.gitLog(req, res)));

// GET /api/v1/admin/files/git/branches — local branch names
adminFileManagerRouter.get('/git/branches', asyncHandler((req, res) => adminFileManagerController.gitBranches(req, res)));

// POST /api/v1/admin/files/git/checkout {branch} — switch to a local branch
adminFileManagerRouter.post('/git/checkout', asyncHandler((req, res) => adminFileManagerController.gitCheckout(req, res)));

// POST /api/v1/admin/files/git/discard {paths} — discard working-tree changes
adminFileManagerRouter.post('/git/discard', asyncHandler((req, res) => adminFileManagerController.gitDiscard(req, res)));

// POST /api/v1/admin/files/git/branches {name} — create + switch to a new branch
adminFileManagerRouter.post('/git/branches', asyncHandler((req, res) => adminFileManagerController.gitCreateBranch(req, res)));

export default adminFileManagerRouter;