import { Router } from 'express';
import botRouter from './bot.routes.js';
import validationRouter from './validation.routes.js';
import adminRouter from './admin.routes.js';
import adminFileManagerRouter from './admin-file-manager.routes.js';
import adminMcpServersRouter from './mcp-servers.routes.js';
import settingsRouter from './settings.routes.js';

const v1Router = Router();

// Mount domain routers here — adding new resources requires one line; app.ts stays stable.
v1Router.use('/bots', botRouter);
// Credential validation before DB write — Discord/Telegram REST
v1Router.use('/validate', validationRouter);
// Admin-only file manager — mounted BEFORE the generic /admin router so its
// more specific paths win the match.
v1Router.use('/admin/files', adminFileManagerRouter);
// Admin-only MCP server registry — mounted BEFORE the generic /admin router.
v1Router.use('/admin/mcp-servers', adminMcpServersRouter);
// Admin-only routes — each handler enforces adminAuth session + role check internally
v1Router.use('/admin', adminRouter);
// Account-level settings — each handler enforces the regular user session internally
v1Router.use('/settings', settingsRouter);

export default v1Router;
