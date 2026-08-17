import { Router } from 'express';
import { aiProviderController } from '@/server/controllers/v1/ai-provider.controller.js';
import { timezoneController } from '@/server/controllers/v1/timezone.controller.js';

const settingsRouter = Router();

// GET /api/v1/settings/ai — per-user AI provider status
// ({ provider, model, providers: { openrouter, groq, nvidia, openai, gemini }, models })
settingsRouter.get('/ai', (req, res) => {
  void aiProviderController.get(req, res);
});

// PUT /api/v1/settings/ai — validate + encrypt + store the provider key,
// and/or switch the active provider + model
settingsRouter.put('/ai', (req, res) => {
  void aiProviderController.save(req, res);
});

// DELETE /api/v1/settings/ai — remove the authenticated user's key for one provider
settingsRouter.delete('/ai', (req, res) => {
  void aiProviderController.remove(req, res);
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
