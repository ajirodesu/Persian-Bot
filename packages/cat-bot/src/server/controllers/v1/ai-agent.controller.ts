import type { Request, Response } from 'express';
import { requireAdmin } from '@/server/validators/auth-session.validator.js';
import {
  getAiAgentSettings,
  saveAiAgentSettings,
  getAiAgentLastSuccess,
  recordAiAgentSuccess,
} from '@/engine/repos/ai-agent-config.repo.js';
import {
  fetchCapabilities,
  resolveNeedleConfig,
} from '@/engine/agent/lib/needle-client.lib.js';

/**
 * AI Agent Controller — Admin API for the external Cactus Needle 3 integration.
 *
 *   GET  /api/v1/admin/ai-agent               — effective settings (secret masked)
 *   PUT  /api/v1/admin/ai-agent               — update URL / token / enabled / limits
 *   POST /api/v1/admin/ai-agent/test          — real authenticated connection test
 *   GET  /api/v1/admin/ai-agent/capabilities  — live capability detection
 *
 * Secret handling: the Needle token is NEVER returned to the browser
 * (`tokenConfigured: true/false` only) and NEVER logged. Writes go through
 * the server-side encrypted store (AES-256-GCM at rest).
 */

function isValidHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

function toPublicSettings(settings: Awaited<ReturnType<typeof getAiAgentSettings>>) {
  return {
    enabled: settings.enabled,
    needleUrl: settings.needleUrl,
    tokenConfigured: settings.tokenConfigured,
    timeoutMs: settings.timeoutMs,
    confidenceThreshold: settings.confidenceThreshold,
    updatedAt: settings.updatedAt,
    lastSuccessAt: getAiAgentLastSuccess(),
  };
}

class AiAgentController {
  /** GET /api/v1/admin/ai-agent */
  async getSettings(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const settings = await getAiAgentSettings();
      res.status(200).json(toPublicSettings(settings));
    } catch (error) {
      console.error('[AiAgentController.getSettings]', error);
      res.status(500).json({ error: 'Failed to load AI Agent settings' });
    }
  }

  /** PUT /api/v1/admin/ai-agent */
  async updateSettings(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { enabled, needleUrl, token, timeoutMs, confidenceThreshold } = body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }
    if (typeof needleUrl !== 'string') {
      res.status(400).json({ error: 'needleUrl must be a string' });
      return;
    }
    const url = needleUrl.trim().replace(/\/+$/, '');
    if (url !== '' && !isValidHttpUrl(url)) {
      res.status(400).json({ error: 'needleUrl must be a valid absolute http(s) URL' });
      return;
    }
    // Omit token = keep existing; empty string = clear; otherwise replace.
    if (token !== undefined && typeof token !== 'string') {
      res.status(400).json({ error: 'token must be a string when provided' });
      return;
    }
    const timeout =
      timeoutMs === undefined ? 30000 : Number(timeoutMs);
    if (!Number.isFinite(timeout) || timeout < 1000 || timeout > 120000) {
      res.status(400).json({ error: 'timeoutMs must be between 1000 and 120000' });
      return;
    }
    const confidence =
      confidenceThreshold === undefined ? 0.7 : Number(confidenceThreshold);
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      res.status(400).json({ error: 'confidenceThreshold must be between 0 and 1' });
      return;
    }

    try {
      const settings = await saveAiAgentSettings({
        enabled,
        needleUrl: url,
        ...(token !== undefined ? { token: token.trim() } : {}),
        timeoutMs: Math.round(timeout),
        confidenceThreshold: confidence,
      });
      res.status(200).json(toPublicSettings(settings));
    } catch (error) {
      console.error('[AiAgentController.updateSettings]', error);
      res.status(500).json({ error: 'Failed to save AI Agent settings' });
    }
  }

  /** POST /api/v1/admin/ai-agent/test — real authenticated probe. */
  async testConnection(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const config = await resolveNeedleConfig();
      const { status, capabilities } = await fetchCapabilities(config);
      if (status === 'Connected') recordAiAgentSuccess();
      res.status(200).json({ status, capabilities });
    } catch (error) {
      console.error('[AiAgentController.testConnection]', error);
      res.status(500).json({ status: 'Unavailable', capabilities: null });
    }
  }

  /** GET /api/v1/admin/ai-agent/capabilities — live detection. */
  async getCapabilities(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const config = await resolveNeedleConfig();
      const { status, capabilities } = await fetchCapabilities(config);
      if (status === 'Connected') recordAiAgentSuccess();
      res.status(200).json({ status, capabilities });
    } catch (error) {
      console.error('[AiAgentController.getCapabilities]', error);
      res.status(500).json({ status: 'Unavailable', capabilities: null });
    }
  }
}

export const aiAgentController = new AiAgentController();
