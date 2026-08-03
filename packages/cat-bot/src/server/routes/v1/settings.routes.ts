import { Router } from 'express';
import { groqKeyController } from '@/server/controllers/v1/groq-key.controller.js';
import { timezoneController } from '@/server/controllers/v1/timezone.controller.js';

const settingsRouter = Router();

// GET /api/v1/settings/groq-key — per-user key status ({ hasKey, keyHint })
settingsRouter.get('/groq-key', (req, res) => {
  void groqKeyController.get(req, res);
});

// PUT /api/v1/settings/groq-key — store the authenticated user's key
settingsRouter.put('/groq-key', (req, res) => {
  void groqKeyController.save(req, res);
});

// DELETE /api/v1/settings/groq-key — remove the authenticated user's key
settingsRouter.delete('/groq-key', (req, res) => {
  void groqKeyController.remove(req, res);
});

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
