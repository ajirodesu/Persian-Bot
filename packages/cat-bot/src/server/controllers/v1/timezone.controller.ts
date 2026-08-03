/**
 * Timezone Controller — per-user dashboard timezone preference.
 *
 * Owns the two endpoints that let an account (regular dashboard user OR admin
 * portal user — see requireAnySession) choose the IANA timezone used to render
 * every time-based display in the dashboard, plus bot-facing timestamps (e.g.
 * ban notices) for sessions that account owns:
 *
 *   GET /api/v1/settings/timezone → { timezone } (null when unset — the client
 *                                    falls back to the browser's local timezone)
 *   PUT /api/v1/settings/timezone → validate + store the timezone
 *
 * Auth model: requireAnySession accepts either the regular user session cookie
 * or the admin-portal session cookie, since both authUserClient and
 * authAdminClient hit this same route through apiClient.
 */

import type { Request, Response } from 'express';
import { requireAnySession } from '@/server/validators/auth-session.validator.js';
import {
  getUserTimezone,
  saveUserTimezone,
  isValidTimezone,
} from '@/engine/repos/timezone.repo.js';

export class TimezoneController {
  // GET /api/v1/settings/timezone
  async get(req: Request, res: Response): Promise<void> {
    const userId = await requireAnySession(req, res);
    if (!userId) return;
    try {
      const timezone = await getUserTimezone(userId);
      res.json({ timezone });
    } catch (err) {
      console.error('[TimezoneController.get]', err);
      res.status(500).json({ error: 'Failed to load timezone setting' });
    }
  }

  // PUT /api/v1/settings/timezone — body: { timezone: string }
  async save(req: Request, res: Response): Promise<void> {
    const userId = await requireAnySession(req, res);
    if (!userId) return;

    const timezone = (req.body as { timezone?: unknown } | undefined)
      ?.timezone;
    if (typeof timezone !== 'string' || !timezone.trim()) {
      res.status(400).json({ error: 'timezone is required' });
      return;
    }

    const trimmed = timezone.trim();
    if (!isValidTimezone(trimmed)) {
      res.status(400).json({
        error: 'Invalid timezone. Choose a value from the timezone list.',
      });
      return;
    }

    try {
      await saveUserTimezone(userId, trimmed);
      res.json({ timezone: trimmed });
    } catch (err) {
      console.error('[TimezoneController.save]', err);
      res.status(500).json({ error: 'Failed to save timezone setting' });
    }
  }
}

export const timezoneController = new TimezoneController();
