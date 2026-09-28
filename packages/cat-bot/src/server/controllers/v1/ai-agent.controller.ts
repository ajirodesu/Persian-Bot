import type { Request, Response } from 'express';
import { requireAdmin } from '@/server/validators/auth-session.validator.js';
import {
  getAiAgentSettings,
  saveAiAgentSettings,
  getAiAgentLastSuccess,
  recordAiAgentSuccess,
} from '@/engine/repos/ai-agent-config.repo.js';
import {
  probeConnection,
  resolveNeedleConfig,
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_NEW_TOKENS,
  MAX_TIMEOUT_MS,
} from '@/engine/agent/lib/needle-client.lib.js';
import type { ConnectionProbe } from '@/engine/agent/lib/needle-client.lib.js';

/**
 * AI Agent Controller — Admin API for the standalone Needle 3 Render API.
 *
 *   GET  /api/v1/admin/ai-agent               — effective settings (secret masked)
 *   PUT  /api/v1/admin/ai-agent               — update URL / key / enabled / limits
 *   POST /api/v1/admin/ai-agent/test          — REAL probe: /health + /v1/complete
 *   GET  /api/v1/admin/ai-agent/capabilities  — live detection (5-min cache)
 *
 * Authentication model: the standalone service requires NEEDLE_API_KEY
 * (sent as `Authorization: Bearer`). There is NO "Cactus Platform API key"
 * concept here: a Platform key is only for Platform fine-tuning/jobs and
 * is never sent to /v1/complete.
 *
 * Secret handling: the API key is NEVER returned to the browser
 * (`tokenConfigured` / `authMode` only) and NEVER logged. Writes go through
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
    authMode: settings.tokenConfigured ? 'token' : 'none',
    timeoutMs: settings.timeoutMs,
    maxNewTokens: settings.maxNewTokens,
    confidenceThreshold: settings.confidenceThreshold,
    updatedAt: settings.updatedAt,
    lastSuccessAt: getAiAgentLastSuccess(),
  };
}

function toProbeResponse(probe: ConnectionProbe) {
  return probe;
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
    const { enabled, needleUrl, token, timeoutMs, maxNewTokens, confidenceThreshold } = body;

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
      timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : Number(timeoutMs);
    if (!Number.isFinite(timeout) || timeout < 1000 || timeout > MAX_TIMEOUT_MS) {
      res.status(400).json({ error: `timeoutMs must be between 1000 and ${MAX_TIMEOUT_MS}` });
      return;
    }
    const tokens =
      maxNewTokens === undefined ? DEFAULT_MAX_NEW_TOKENS : Number(maxNewTokens);
    if (!Number.isFinite(tokens) || tokens < 1 || tokens > 512) {
      res.status(400).json({ error: 'maxNewTokens must be between 1 and 512' });
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
        maxNewTokens: Math.round(tokens),
        confidenceThreshold: confidence,
      });
      res.status(200).json(toPublicSettings(settings));
    } catch (error) {
      console.error('[AiAgentController.updateSettings]', error);
      res.status(500).json({ error: 'Failed to save AI Agent settings' });
    }
  }

  /** POST /api/v1/admin/ai-agent/test — REAL probe, cache bypassed. */
  async testConnection(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const config = await resolveNeedleConfig();
      const probe = await probeConnection({ config, bypassCache: true });
      if (probe.status === 'Connected') recordAiAgentSuccess();
      res.status(200).json(toProbeResponse(probe));
    } catch (error) {
      console.error('[AiAgentController.testConnection]', error);
      res.status(500).json({
        status: 'Service unavailable',
        detail: 'Connection test failed unexpectedly.',
        capabilities: null,
        model: null,
        endpoint: null,
        latencyMs: null,
        lastCheckedAt: new Date().toISOString(),
      });
    }
  }

  /** GET /api/v1/admin/ai-agent/capabilities — live detection (5-min cache). */
  async getCapabilities(req: Request, res: Response): Promise<void> {
    if (!(await requireAdmin(req, res))) return;
    try {
      const config = await resolveNeedleConfig();
      const probe = await probeConnection({ config });
      if (probe.status === 'Connected') recordAiAgentSuccess();
      res.status(200).json(toProbeResponse(probe));
    } catch (error) {
      console.error('[AiAgentController.getCapabilities]', error);
      res.status(500).json({
        status: 'Service unavailable',
        detail: 'Capability check failed unexpectedly.',
        capabilities: null,
        model: null,
        endpoint: null,
        latencyMs: null,
        lastCheckedAt: new Date().toISOString(),
      });
    }
  }
}

export const aiAgentController = new AiAgentController();
