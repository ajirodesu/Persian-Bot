/**
 * Groq Key Controller — per-user Groq API key management for the dashboard.
 *
 * Owns the three endpoints that let a registered user configure the Groq API key
 * used exclusively by their own bots:
 *
 *   GET    /api/v1/settings/groq-key  → { hasKey, keyHint } (never the key itself)
 *   PUT    /api/v1/settings/groq-key  → validate + encrypt + store the key
 *   DELETE /api/v1/settings/groq-key  → remove the stored key
 *
 * Auth model: the user's better-auth session (requireSession) — the returned
 * userId IS the account that owns every bot session, so the key is always scoped
 * to exactly one user and is never shared or reused across accounts.
 */

import type { Request, Response } from 'express';
import { requireSession } from '@/server/validators/auth-session.validator.js';
import {
  getUserGroqKeyStatus,
  saveUserGroqApiKey,
  removeUserGroqApiKey,
  getGroqKeyHint,
  isValidGroqApiKey,
} from '@/engine/repos/groq-key.repo.js';

export class GroqKeyController {
  // GET /api/v1/settings/groq-key
  async get(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      const status = await getUserGroqKeyStatus(userId);
      res.json(status);
    } catch (err) {
      console.error('[GroqKeyController.get]', err);
      res.status(500).json({ error: 'Failed to load Groq key status' });
    }
  }

  // PUT /api/v1/settings/groq-key — body: { apiKey: string }
  async save(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;

    const apiKey = (req.body as { apiKey?: unknown } | undefined)?.apiKey;
    if (typeof apiKey !== 'string' || !apiKey.trim()) {
      res.status(400).json({ error: 'apiKey is required' });
      return;
    }

    const trimmed = apiKey.trim();
    if (!isValidGroqApiKey(trimmed)) {
      res.status(400).json({
        error:
          'Invalid Groq API key. Keys start with "gsk_" and are at least 20 characters long.',
      });
      return;
    }

    try {
      await saveUserGroqApiKey(userId, trimmed);
      res.json({ hasKey: true, keyHint: getGroqKeyHint(trimmed) });
    } catch (err) {
      console.error('[GroqKeyController.save]', err);
      res.status(500).json({ error: 'Failed to save Groq API key' });
    }
  }

  // DELETE /api/v1/settings/groq-key
  async remove(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      await removeUserGroqApiKey(userId);
      res.json({ hasKey: false, keyHint: null });
    } catch (err) {
      console.error('[GroqKeyController.remove]', err);
      res.status(500).json({ error: 'Failed to remove Groq API key' });
    }
  }
}

export const groqKeyController = new GroqKeyController();
