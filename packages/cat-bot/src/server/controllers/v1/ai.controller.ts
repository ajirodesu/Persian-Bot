/**
 * AI Controller — dashboard API for the AI Agent subsystem.
 *
 * All endpoints require an authenticated dashboard session (requireSession).
 * Secrets are NEVER returned: API keys are masked on read and only overwritten
 * when a non-empty value is supplied on write.
 */

import type { Request, Response } from 'express';
import { requireSession } from '@/server/validators/auth-session.validator.js';
import {
  getPersistedAiConfig,
  ensureUserAiSnapshot,
  saveUserAiSnapshot,
  describeRouting,
  buildCandidates,
  resolveAgentConfig,
  isAiEnabled,
} from '@/engine/ai/config.js';
import { listProviders } from '@/engine/ai/provider/index.js';
import { listTools } from '@/engine/ai/tools.js';
import { ensureBuiltins } from '@/engine/ai/builtin-tools.js';
import { draftPost, rewritePost } from '@/engine/ai/editor.js';
import { compileOrder, coercePolicyPatch, diffPatch } from '@/engine/ai/policy.js';
import { getPolicy, defaultPolicyFor, recentModerations } from '@/engine/ai/policy-store.js';
import { moderateMessage } from '@/engine/ai/service.js';
import { askAgentText } from '@/engine/ai/runner.js';
import {
  listIntegrationsForUser,
  getIntegrationById,
  createIntegration,
  updateIntegration,
  deleteIntegrationForUser,
  type McpSkillRecord,
} from '@/engine/repos/mcp-skills.repo.js';
import { validateIntegrationInput } from '@/engine/ai/mcp/validate.js';
import { scanIntegration, MAX_INTEGRATIONS_PER_USER } from '@/engine/ai/mcp/scan.js';
import { listMcpTools } from '@/engine/ai/mcp/client.js';
import { probeIntegration, clearIntegrationCache } from '@/engine/ai/mcp/integrations.js';
import { listProviderModels } from '@/engine/ai/models.js';

ensureBuiltins();

/** Ensure the caller's DB snapshot is loaded; fail-open to env-only. */
async function snapshot(userId: string): Promise<void> {
  try {
    await ensureUserAiSnapshot(userId);
  } catch {
    /* env-only fallback */
  }
}

function maskKey(key?: string): string | null {
  if (!key) return null;
  if (key.length <= 8) return '••••••••';
  return `${key.slice(0, 3)}••••••${key.slice(-2)}`;
}

/** Public integration view — sealed secret values are never returned raw. */
function toPublicIntegration(r: McpSkillRecord): Record<string, unknown> {
  const raw = r.config as unknown as Record<string, unknown>;
  const config: Record<string, unknown> = { ...raw };
  const headers = raw.headers;
  if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(headers as Record<string, unknown>)) {
      masked[k] = typeof v === 'string' && v.startsWith('enc:v1:') ? '••••••' : String(v);
    }
    config.headers = masked;
  }
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    config,
    risk: r.risk,
    minRole: r.minRole,
    status: r.status,
    dangerReasons: r.dangerReasons,
    approvedBy: r.approvedBy,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

/** Keep stored secrets when the client sends back masked placeholders. */
function mergeSealedHeaders(
  existing: Record<string, string> | undefined,
  incoming: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!incoming) return existing;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (v.includes('•') && existing?.[k]) out[k] = existing[k]!;
    else out[k] = v;
  }
  return out;
}

async function advertisedTools(
  kind: string,
  url: string | undefined,
  headers: Record<string, string> | undefined,
): Promise<{ names: string[]; descriptions: Record<string, string> }> {
  if (kind !== 'mcp' || !url) return { names: [], descriptions: {} };
  try {
    const defs = await Promise.race([
      listMcpTools(url, headers ?? {}, 8_000),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('listing timed out')), 9_000),
      ),
    ]);
    const descriptions: Record<string, string> = {};
    for (const d of defs) {
      if (d.description) descriptions[d.name] = d.description;
    }
    return { names: defs.map((d) => d.name), descriptions };
  } catch {
    return { names: [], descriptions: {} };
  }
}

function publicConfig(userId: string): Record<string, unknown> {
  const cfg = getPersistedAiConfig(userId);
  const providers: Record<string, Record<string, unknown>> = {};
  for (const [name, p] of Object.entries(cfg.providers ?? {})) {
    providers[name] = {
      ...(p.baseUrl ? { baseUrl: p.baseUrl } : {}),
      ...(p.models ? { models: p.models } : {}),
      apiKeyMasked: maskKey(p.apiKey),
      configured: Boolean(p.apiKey),
    };
  }
  return {
    enabled: isAiEnabled(userId),
    provider: cfg.provider ?? null,
    model: cfg.model ?? null,
    models: cfg.models ?? [],
    baseUrl: cfg.baseUrl ?? null,
    apiKeyMasked: maskKey(cfg.apiKey),
    apiKeyConfigured: Boolean(cfg.apiKey),
    temperature: cfg.temperature ?? 0.3,
    maxTokens: cfg.maxTokens ?? 1024,
    timeout: cfg.timeout ?? 30_000,
    maxRetries: cfg.maxRetries ?? 2,
    providers,
    agents: cfg.agents ?? {},
    memory: {
      enabled: cfg.memory?.enabled ?? true,
      maxRecentTurns: cfg.memory?.maxRecentTurns ?? 10,
      retentionDays: cfg.memory?.retentionDays ?? 30,
      ...(cfg.memory?.summaryMaxChars !== undefined
        ? { summaryMaxChars: cfg.memory.summaryMaxChars }
        : {}),
    },
    execution: {
      maxSteps: cfg.execution?.maxSteps ?? 6,
      timeoutMs: cfg.execution?.timeoutMs ?? 90_000,
      maxToolErrors: cfg.execution?.maxToolErrors ?? 3,
      maxCallsPerStep: cfg.execution?.maxCallsPerStep ?? 3,
    },
    moderation: {
      enabled: cfg.moderation?.enabled ?? false,
      minConfidence: cfg.moderation?.minConfidence ?? 0.75,
      secondOpinion: cfg.moderation?.secondOpinion ?? false,
      dryRun: cfg.moderation?.dryRun ?? true,
    },
    autoReply: {
      mention: cfg.autoReply?.mention ?? true,
      dm: cfg.autoReply?.dm ?? true,
    },
  };
}

const KNOWN_AGENTS = ['default', 'moderator', 'moderator2', 'policy', 'editor'];

function cleanAgentConfig(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof o.provider === 'string' && o.provider.trim()) out.provider = o.provider.trim().toLowerCase();
  if (typeof o.model === 'string' && o.model.trim()) out.model = o.model.trim();
  if (Array.isArray(o.models)) {
    const models = o.models.filter((m): m is string => typeof m === 'string' && m.trim() !== '').map((m) => m.trim());
    if (models.length > 0) out.models = models.slice(0, 8);
  }
  if (Number.isFinite(Number(o.temperature))) {
    out.temperature = Math.min(2, Math.max(0, Number(o.temperature)));
  }
  if (Number.isFinite(Number(o.maxTokens))) {
    out.maxTokens = Math.min(8000, Math.max(64, Math.trunc(Number(o.maxTokens))));
  }
  if (Number.isFinite(Number(o.timeout))) {
    out.timeout = Math.min(120_000, Math.max(5_000, Math.trunc(Number(o.timeout))));
  }
  if (typeof o.json === 'boolean') out.json = o.json;
  if (Array.isArray(o.fallback)) {
    const fb = (o.fallback as unknown[])
      .filter((f): f is Record<string, unknown> => Boolean(f) && typeof f === 'object' && !Array.isArray(f))
      .filter((f) => typeof f.provider === 'string' && typeof f.model === 'string')
      .slice(0, 4)
      .map((f) => ({
        provider: String(f.provider).trim().toLowerCase(),
        model: String(f.model).trim(),
        ...(typeof f.baseUrl === 'string' && f.baseUrl.trim() ? { baseUrl: f.baseUrl.trim() } : {}),
      }));
    if (fb.length > 0) out.fallback = fb;
  }
  return out;
}

class AiController {
  /** GET /api/v1/ai/config — full editable config with masked secrets. */
  async getConfig(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      await snapshot(userId);
      res.json(publicConfig(userId));
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to load AI configuration' });
    }
  }

  /** PUT /api/v1/ai/config — validate + persist. Empty apiKey keeps the stored one. */
  async saveConfig(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    await snapshot(userId);

    const body = (req.body ?? {}) as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if (typeof body.enabled === 'boolean') patch.enabled = body.enabled;
    if (typeof body.provider === 'string' && body.provider.trim()) {
      patch.provider = body.provider.trim().toLowerCase();
    }
    if (typeof body.model === 'string' && body.model.trim()) patch.model = body.model.trim();
    if (Array.isArray(body.models)) {
      patch.models = (body.models as unknown[])
        .filter((m): m is string => typeof m === 'string' && m.trim() !== '')
        .map((m) => m.trim())
        .slice(0, 8);
    }
    if (typeof body.baseUrl === 'string') {
      patch.baseUrl = body.baseUrl.trim() || undefined;
    }
    // Only overwrite the stored key when a real value is supplied — masked
    // placeholders and empty strings keep the existing secret.
    if (typeof body.apiKey === 'string' && body.apiKey.trim() && !body.apiKey.includes('•')) {
      patch.apiKey = body.apiKey.trim();
    }
    if (Number.isFinite(Number(body.temperature))) {
      patch.temperature = Math.min(2, Math.max(0, Number(body.temperature)));
    }
    if (Number.isFinite(Number(body.maxTokens))) {
      patch.maxTokens = Math.min(8000, Math.max(64, Math.trunc(Number(body.maxTokens))));
    }
    if (Number.isFinite(Number(body.timeout))) {
      patch.timeout = Math.min(120_000, Math.max(5_000, Math.trunc(Number(body.timeout))));
    }
    if (Number.isFinite(Number(body.maxRetries))) {
      patch.maxRetries = Math.min(5, Math.max(0, Math.trunc(Number(body.maxRetries))));
    }

    if (body.providers && typeof body.providers === 'object' && !Array.isArray(body.providers)) {
      const providers: Record<string, { apiKey?: string; baseUrl?: string; models?: string[] }> = {};
      for (const [name, raw] of Object.entries(body.providers as Record<string, unknown>)) {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
        const p = raw as Record<string, unknown>;
        const entry: { apiKey?: string; baseUrl?: string; models?: string[] } = {};
        if (typeof p.apiKey === 'string' && p.apiKey.trim() && !p.apiKey.includes('•')) {
          entry.apiKey = p.apiKey.trim();
        } else {
          const existing = getPersistedAiConfig(userId).providers?.[name]?.apiKey;
          if (existing) entry.apiKey = existing;
        }
        if (typeof p.baseUrl === 'string' && p.baseUrl.trim()) entry.baseUrl = p.baseUrl.trim();
        if (Array.isArray(p.models)) {
          const models = (p.models as unknown[])
            .filter((m): m is string => typeof m === 'string' && m.trim() !== '')
            .map((m) => m.trim());
          if (models.length > 0) entry.models = models;
        }
        if (Object.keys(entry).length > 0) providers[name.toLowerCase()] = entry;
      }
      // Merge with existing providers so untouched providers keep their keys.
      patch.providers = { ...(getPersistedAiConfig(userId).providers ?? {}), ...providers };
    }

    if (body.agents && typeof body.agents === 'object' && !Array.isArray(body.agents)) {
      const agents: Record<string, unknown> = { ...(getPersistedAiConfig(userId).agents ?? {}) };
      for (const [name, raw] of Object.entries(body.agents as Record<string, unknown>)) {
        if (!KNOWN_AGENTS.includes(name)) continue;
        const cleaned = cleanAgentConfig(raw);
        if (cleaned && Object.keys(cleaned).length > 0) agents[name] = cleaned;
        else delete agents[name];
      }
      patch.agents = agents;
    }

    for (const section of ['memory', 'execution', 'moderation', 'autoReply'] as const) {
      const raw = body[section];
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
        const current = (getPersistedAiConfig(userId)[section] ?? {}) as Record<string, unknown>;
        const cleaned: Record<string, unknown> = { ...current };
        for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
          // Auto-reply only accepts known boolean flags — never free-form keys.
          if (section === 'autoReply') {
            if ((k === 'mention' || k === 'dm') && typeof v === 'boolean') cleaned[k] = v;
            continue;
          }
          cleaned[k] = v;
        }
        patch[section] = cleaned;
      }
    }

    try {
      await saveUserAiSnapshot(userId, patch as Parameters<typeof saveUserAiSnapshot>[1]);
      res.json(publicConfig(userId));
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to save AI configuration' });
    }
  }

  /** GET /api/v1/ai/status — compact operational status for the overview card. */
  async status(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      await snapshot(userId);
      const cfg = getPersistedAiConfig(userId);
      const routing = describeRouting(userId);
      const defaultCandidates = routing.default?.candidates ?? [];
      res.json({
        enabled: isAiEnabled(userId),
        configured: defaultCandidates.length > 0,
        provider: cfg.provider ?? resolveAgentConfig('default', {}, userId).provider ?? null,
        model: cfg.model ?? resolveAgentConfig('default', {}, userId).model ?? null,
        candidates: defaultCandidates,
        agents: Object.keys(routing).length,
        tools: listTools().map((t) => ({ name: t.name, description: t.description, risk: t.risk ?? 0 })),
        providers: listProviders(),
      });
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to load AI status' });
    }
  }

  /** GET /api/v1/ai/routing — per-agent provider/model candidates (diagnostics). */
  async routing(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      await snapshot(userId);
      res.json(describeRouting(userId));
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to load agent routing' });
    }
  }

  /** GET /api/v1/ai/tools — unified tool registry (built-in + user MCP/Skills). */
  async tools(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      await snapshot(userId);
      const integrations = await listIntegrationsForUser(userId);
      res.json({
        builtIn: listTools().map((t) => ({
          name: t.name,
          description: t.description,
          risk: t.risk ?? 0,
          minRole: t.minRole ?? 0,
          required: t.parameters.required ?? [],
        })),
        mcp: integrations
          .filter((i) => i.kind === 'mcp')
          .map((i) => toPublicIntegration(i)),
        skills: integrations
          .filter((i) => i.kind === 'skill')
          .map((i) => toPublicIntegration(i)),
      });
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to load tools' });
    }
  }

  /** POST /api/v1/ai/test — live provider/model connectivity probe. */
  async testConnection(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      await snapshot(userId);
      const body = (req.body ?? {}) as { agent?: unknown };
      const agent = typeof body.agent === 'string' && body.agent ? body.agent : 'default';
      const routing = describeRouting(userId);
      if ((routing[agent]?.candidates ?? []).length === 0) {
        res.status(400).json({
          ok: false,
          error: 'No provider/model is configured for this agent. Add an API key first.',
        });
        return;
      }
      const started = Date.now();
      try {
        const result = await askAgentText(agent, {
          system: 'You are a connectivity probe. Reply with exactly: ok',
          user: 'Reply with exactly: ok',
          overrides: { maxTokens: 16, temperature: 0 },
          userId,
        });
        res.json({
          ok: true,
          provider: result.provider,
          model: result.model,
          latencyMs: Date.now() - started,
          attempts: result.attempts,
          reply: result.data.slice(0, 200),
        });
      } catch (err) {
        res.status(502).json({
          ok: false,
          error: (err as Error)?.message ?? 'Connection test failed',
          latencyMs: Date.now() - started,
        });
      }
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ ok: false, error: 'Connection test failed' });
    }
  }

  /** POST /api/v1/ai/draft — editor agent (draft only; never publishes). */
  async draft(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    const body = (req.body ?? {}) as { instruction?: unknown; original?: unknown; channelTitle?: unknown };
    if (typeof body.instruction !== 'string' || !body.instruction.trim()) {
      res.status(400).json({ error: 'instruction is required' });
      return;
    }
    try {
      await snapshot(userId);
      const channelTitle = typeof body.channelTitle === 'string' ? body.channelTitle : null;
      const result =
        typeof body.original === 'string' && body.original.trim()
          ? await rewritePost({ original: body.original, instruction: body.instruction, channelTitle, userId })
          : await draftPost({ instruction: body.instruction, channelTitle, userId });
      if (result.error && !result.draft.text) {
        res.status(502).json({ error: result.error });
        return;
      }
      res.json({ text: result.draft.text, summary: result.draft.summary, model: result.model ?? null });
    } catch (err) {
      res.status(502).json({ error: (err as Error)?.message ?? 'Editor agent failed' });
    }
  }

  /** POST /api/v1/ai/moderate — dry-run classification of one message. */
  async moderate(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    const body = (req.body ?? {}) as { text?: unknown; threadId?: unknown };
    if (typeof body.text !== 'string' || !body.text.trim()) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    try {
      await snapshot(userId);
      const outcome = await moderateMessage({
        threadId: typeof body.threadId === 'string' ? body.threadId : 'dashboard-preview',
        senderId: userId,
        text: body.text,
        senderRole: 0,
        isGroup: true,
        userId,
      });
      res.json(outcome);
    } catch (err) {
      res.status(502).json({ error: (err as Error)?.message ?? 'Moderation check failed' });
    }
  }

  /** POST /api/v1/ai/policy/compile — compile an NL order into a patch (no apply). */
  async compilePolicy(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    const body = (req.body ?? {}) as { order?: unknown; threadId?: unknown };
    if (typeof body.order !== 'string' || !body.order.trim()) {
      res.status(400).json({ error: 'order is required' });
      return;
    }
    try {
      await snapshot(userId);
      const threadId = typeof body.threadId === 'string' && body.threadId ? body.threadId : 'default';
      const policy = await getPolicy(threadId);
      const result = await compileOrder(body.order, policy, userId);
      if (result.error && result.changes.length === 0) {
        res.status(502).json({ error: result.error, patch: result.patch, changes: result.changes });
        return;
      }
      res.json({ patch: result.patch, changes: result.changes, model: result.model ?? null });
    } catch (err) {
      res.status(502).json({ error: (err as Error)?.message ?? 'Policy compilation failed' });
    }
  }

  /** GET /api/v1/ai/policy — current policy for a thread (safe fields). */
  async getPolicy(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      const threadId = typeof req.query.threadId === 'string' ? req.query.threadId : 'default';
      const policy = await getPolicy(threadId);
      res.json(policy);
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to load policy' });
    }
  }

  /** GET /api/v1/ai/audit — recent moderation audit entries. */
  async audit(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
      res.json({ entries: recentModerations(limit) });
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to load audit log' });
    }
  }

  /** GET /api/v1/ai/providers/:provider/models — live model catalog. */
  async providerModels(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      await snapshot(userId);
      const provider = String(req.params.provider ?? '');
      if (!provider) {
        res.status(400).json({ error: 'provider is required' });
        return;
      }
      const result = await listProviderModels(provider, userId);
      res.json(result);
    } catch (err) {
      const message = (err as Error)?.message ?? 'Failed to load models';
      const status = /no api key|unknown provider/i.test(message) ? 400 : 502;
      if (status === 502) console.error('[AiController]', err);
      res.status(status).json({ error: message });
    }
  }

  /** GET /api/v1/ai/candidates — model candidates for one agent (debug). */
  async candidates(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      await snapshot(userId);
      const agent = typeof req.query.agent === 'string' ? req.query.agent : 'default';
      const cfg = resolveAgentConfig(agent, {}, userId);
      res.json({ agent, candidates: buildCandidates(cfg, userId) });
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to load candidates' });
    }
  }

  /** GET /api/v1/ai/policy/default — blank policy shape for forms. */
  async defaultPolicy(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    res.json(defaultPolicyFor('default'));
  }

  /** POST /api/v1/ai/policy/validate — validate a raw patch without applying. */
  async validatePolicy(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      const threadId =
        typeof (req.body as Record<string, unknown> | undefined)?.threadId === 'string'
          ? String((req.body as Record<string, unknown>).threadId)
          : 'default';
      const policy = await getPolicy(threadId);
      const patch = coercePolicyPatch((req.body as Record<string, unknown> | undefined)?.patch);
      res.json({ patch, changes: diffPatch(policy, patch) });
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to validate policy patch' });
    }
  }

  // ── MCP & Skills (user-owned) ────────────────────────────────────────────

  /** GET /api/v1/ai/integrations — the caller's own MCP servers and Skills. */
  async listIntegrations(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      const items = await listIntegrationsForUser(userId);
      res.json({ items: items.map(toPublicIntegration) });
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to load integrations' });
    }
  }

  /** POST /api/v1/ai/integrations — add an MCP server or Skill (auto-scanned). */
  async createIntegration(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      const existing = await listIntegrationsForUser(userId);
      if (existing.length >= MAX_INTEGRATIONS_PER_USER) {
        res.status(400).json({
          error: `Integration limit reached (${MAX_INTEGRATIONS_PER_USER}). Delete one first.`,
        });
        return;
      }
      if (existing.some((i) => i.name.toLowerCase() === String((req.body as Record<string, unknown> | undefined)?.name ?? '').toLowerCase())) {
        res.status(400).json({ error: 'An integration with this name already exists.' });
        return;
      }

      const validated = validateIntegrationInput((req.body ?? {}) as unknown);
      if (!validated.ok) {
        res.status(400).json({ error: validated.error });
        return;
      }
      const { kind, name, config } = validated.value;
      const url = (config as { url?: string }).url;
      const headers = (config as { headers?: Record<string, string> }).headers;
      const surface = await advertisedTools(kind, url, headers);
      const verdict = scanIntegration({
        kind,
        name,
        url,
        headers,
        parameters: (config as { parameters?: unknown }).parameters,
        instructions: (config as { instructions?: string }).instructions,
        skillMode: (config as { mode?: 'tool' | 'prompt' }).mode,
        toolNames: surface.names,
        toolDescriptions: surface.descriptions,
      });

      const created = await createIntegration({
        userId,
        kind,
        name,
        config,
        risk: verdict.risk,
        minRole: verdict.minRole,
        status: verdict.status,
        dangerReasons: verdict.reasons,
        approvedBy: null,
      });
      clearIntegrationCache();
      res.status(201).json({
        item: toPublicIntegration(created),
        autoRestricted: verdict.status !== 'active',
        reasons: verdict.reasons,
      });
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to save integration' });
    }
  }

  /** PUT /api/v1/ai/integrations/:id — edit own entry (re-scanned, never de-restricted). */
  async updateIntegration(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      const id = String(req.params.id ?? '');
      const record = await getIntegrationById(id);
      if (!record || record.userId !== userId) {
        res.status(404).json({ error: 'Integration not found.' });
        return;
      }

      const body = (req.body ?? {}) as Record<string, unknown>;
      // Partial update: missing fields keep stored values (masked secrets kept).
      const mergedRaw: Record<string, unknown> = {
        kind: record.kind,
        name: typeof body.name === 'string' ? body.name : record.name,
        config: body.config ?? (record.config as unknown),
      };
      const validated = validateIntegrationInput(mergedRaw);
      if (!validated.ok) {
        res.status(400).json({ error: validated.error });
        return;
      }
      const nextConfig = validated.value.config as unknown as Record<string, unknown>;
      if (nextConfig.headers && typeof nextConfig.headers === 'object') {
        const storedHeaders = (record.config as unknown as Record<string, unknown>).headers as
          | Record<string, string>
          | undefined;
        nextConfig.headers = mergeSealedHeaders(
          storedHeaders,
          nextConfig.headers as Record<string, string>,
        );
      }

      const url = nextConfig.url as string | undefined;
      const headers = nextConfig.headers as Record<string, string> | undefined;
      const surface = await advertisedTools(record.kind, url, headers);
      const verdict = scanIntegration({
        kind: record.kind,
        name: validated.value.name,
        url,
        headers,
        parameters: nextConfig.parameters,
        instructions: nextConfig.instructions as string | undefined,
        skillMode: nextConfig.mode as 'tool' | 'prompt' | undefined,
        toolNames: surface.names,
        toolDescriptions: surface.descriptions,
      });

      // Users can never relax enforcement: risk/minRole only ratchet up, and a
      // flagged entry stays flagged until an admin clears it.
      const wasFlagged = record.status !== 'active';
      const risk = Math.max(verdict.risk, record.risk) as 0 | 1 | 2;
      const minRole = Math.max(verdict.minRole, record.minRole);
      const status =
        verdict.status !== 'active' ? verdict.status : wasFlagged ? record.status : 'active';
      const dangerReasons =
        verdict.status !== 'active' ? verdict.reasons : wasFlagged ? record.dangerReasons : [];

      await updateIntegration(id, {
        name: validated.value.name,
        config: validated.value.config,
        risk,
        minRole,
        status,
        dangerReasons,
        ...(status !== record.status || verdict.status !== 'active' ? { approvedBy: null } : {}),
      });
      clearIntegrationCache();
      const updated = await getIntegrationById(id);
      res.json({
        item: updated ? toPublicIntegration(updated) : null,
        autoRestricted: status !== 'active',
        reasons: dangerReasons,
      });
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to update integration' });
    }
  }

  /** DELETE /api/v1/ai/integrations/:id — delete own entry. */
  async deleteIntegration(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      const id = String(req.params.id ?? '');
      const record = await getIntegrationById(id);
      if (!record || record.userId !== userId) {
        res.status(404).json({ error: 'Integration not found.' });
        return;
      }
      await deleteIntegrationForUser(id, userId);
      clearIntegrationCache();
      res.json({ deleted: true });
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Failed to delete integration' });
    }
  }

  /** POST /api/v1/ai/integrations/:id/test — probe + rescan (auto-restricts new danger). */
  async testIntegration(req: Request, res: Response): Promise<void> {
    const userId = await requireSession(req, res);
    if (!userId) return;
    try {
      const id = String(req.params.id ?? '');
      const record = await getIntegrationById(id);
      if (!record || record.userId !== userId) {
        res.status(404).json({ error: 'Integration not found.' });
        return;
      }
      const probe = await probeIntegration(record);

      let autoRestricted = false;
      const freshDanger = probe.freshScan?.dangerous ?? [];
      if (freshDanger.length > 0 && record.status === 'active') {
        await updateIntegration(id, {
          risk: 2,
          minRole: 4,
          status: 'restricted',
          dangerReasons: [
            ...record.dangerReasons,
            ...freshDanger.map((t) => `advertised tool "${t}" can execute or destroy`),
          ],
          approvedBy: null,
        });
        clearIntegrationCache();
        autoRestricted = true;
      }
      res.json({ ...probe, autoRestricted });
    } catch (err) {
      console.error('[AiController]', err);
      res.status(500).json({ error: 'Integration test failed' });
    }
  }
}

export const aiController = new AiController();
