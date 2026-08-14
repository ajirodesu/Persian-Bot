/**
 * AI Provider Controller — per-user AI provider configuration for the
 * dashboard (AI Integration card).
 *
 * Owns the three endpoints that let a registered user configure the LLM
 * provider + model used exclusively by their own bots:
 *
 *   GET    /api/v1/settings/ai  → { provider, model, providers: {...}, models: {...} }
 *   PUT    /api/v1/settings/ai  → body { provider, model?, apiKey? } — validate +
 *                                 encrypt + store, switch provider/model
 *   DELETE /api/v1/settings/ai  → body { provider } — remove that provider's key
 *
 * Auth model: the user's better-auth session (requireSession) — the returned
 * userId IS the account that owns every bot session, so the config is always
 * scoped to exactly one user and is never shared or reused across accounts.
 */

import type { Request, Response } from 'express';
import { requireSession } from '@/server/validators/auth-session.validator.js';
import {
  getAiSettingsStatus,
  saveUserAiConfig,
  removeUserAiKey,
  AiConfigError,
  type SaveAiConfigPayload,
} from '@/engine/repos/ai-provider.repo.js';
import { isAiProviderId } from '@/engine/repos/ai-provider.constants.js';

class AiProviderController {
  // GET /api/v1/settings/ai
  async get(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      res.json(await getAiSettingsStatus(userId));
    } catch (err) {
      console.error('[AiProviderController.get]', err);
      res.status(500).json({ error: 'Failed to load AI provider settings' });
    }
  }

  // PUT /api/v1/settings/ai — body: { provider, model?, apiKey? }
  async save(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const body = (req.body ?? {}) as Record<string, unknown>;
    const provider = body['provider'];
    if (!isAiProviderId(provider)) {
      res.status(400).json({ error: 'provider is required' });
      return;
    }
    if (
      body['model'] !== undefined &&
      typeof body['model'] !== 'string'
    ) {
      res.status(400).json({ error: 'model must be a string' });
      return;
    }
    if (
      body['apiKey'] !== undefined &&
      typeof body['apiKey'] !== 'string'
    ) {
      res.status(400).json({ error: 'apiKey must be a string' });
      return;
    }

    const payload: SaveAiConfigPayload = { provider };
    if (body['model'] !== undefined) {
      payload.model = body['model'] as string;
    }
    if (body['apiKey'] !== undefined) {
      payload.apiKey = body['apiKey'] as string;
    }

    try {
      res.json(await saveUserAiConfig(userId, payload));
    } catch (err) {
      if (err instanceof AiConfigError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('[AiProviderController.save]', err);
      res.status(500).json({ error: 'Failed to save AI provider settings' });
    }
  }

  // DELETE /api/v1/settings/ai — body: { provider }
  async remove(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const provider = (req.body as { provider?: unknown } | undefined)?.provider;
    if (!isAiProviderId(provider)) {
      res.status(400).json({ error: 'provider is required' });
      return;
    }

    try {
      res.json(await removeUserAiKey(userId, provider));
    } catch (err) {
      if (err instanceof AiConfigError) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error('[AiProviderController.remove]', err);
      res.status(500).json({ error: 'Failed to remove AI provider key' });
    }
  }
}

export const aiProviderController = new AiProviderController();
