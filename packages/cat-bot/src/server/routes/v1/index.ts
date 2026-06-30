import { Router } from 'express';
import botRouter from './bot.routes.js';
import validationRouter from './validation.routes.js';
import adminRouter from './admin.routes.js';

const v1Router = Router();

// Mount domain routers here — adding new resources requires one line; app.ts stays stable.
v1Router.use('/bots', botRouter);
// Credential validation before DB write — Discord/Telegram REST
v1Router.use('/validate', validationRouter);
// Admin-only routes — each handler enforces adminAuth session + role check internally
v1Router.use('/admin', adminRouter);

export default v1Router;
