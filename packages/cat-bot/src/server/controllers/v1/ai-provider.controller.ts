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
import { invalidateAgentConfig } from '@/engine/lib/ai-agent/agent-config.lib.js';

/** Numeric agent-setting fields validated against sane bounds. */
const NUMERIC_SETTING_KEYS = [
  'maxToolIterations',
  'maxHistory',
  'threadTtl',
] as const;

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

    // Agent behavior settings — validated field-by-field so a malformed body
    // returns a clear 400 instead of silently saving garbage.
    const rawSettings = body['settings'];
    if (rawSettings !== undefined) {
      if (rawSettings === null || typeof rawSettings !== 'object') {
        res.status(400).json({ error: 'settings must be an object' });
        return;
      }
      const s = rawSettings as Record<string, unknown>;
      const settings: NonNullable<SaveAiConfigPayload['settings']> = {};
      if (
        s['agentName'] !== undefined &&
        (typeof s['agentName'] !== 'string' ||
          s['agentName'].trim().length === 0)
      ) {
        res.status(400).json({ error: 'agentName must be a non-empty string' });
        return;
      }
      if (s['agentName'] !== undefined) {
        settings.agentName = s['agentName'] as string;
      }
      for (const key of NUMERIC_SETTING_KEYS) {
        const v = s[key];
        if (v === undefined) continue;
        if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
          res.status(400).json({ error: `${key} must be a positive number` });
          return;
        }
        settings[key] = v;
      }
      payload.settings = settings;
    }

    try {
      const status = await saveUserAiConfig(userId, payload);
      // Drop the engine's per-user config cache so the change applies on the
      // next agent turn (not up to 30s later).
      invalidateAgentConfig(userId);
      res.json(status);
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
      const status = await removeUserAiKey(userId, provider);
      invalidateAgentConfig(userId);
      res.json(status);
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
