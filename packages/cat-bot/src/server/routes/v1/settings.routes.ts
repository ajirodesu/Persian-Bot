import { Router } from 'express';
import { timezoneController } from '@/server/controllers/v1/timezone.controller.js';

const settingsRouter = Router();

// GET /api/v1/settings/timezone — the authenticated account's saved timezone
// (regular dashboard user OR admin portal user — see requireAnySession)
settingsRouter.get('/timezone', (req, res) => {
  void timezoneController.get(req, res);
});

// PUT /api/v1/settings/timezone — validate + store the authenticated account's timezone
settingsRouter.put('/timezone', (req, res) => {
  void timezoneController.save(req, res);
});

export default settingsRouter;
