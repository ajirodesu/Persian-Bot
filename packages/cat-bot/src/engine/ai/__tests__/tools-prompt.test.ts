import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerTool,
  clearTools,
  validateArgs,
  resolveTool,
  executeTool,
  listTools,
  toolDefinitions,
} from '../tools.js';
import { protocolPrompt } from '../loop.js';
import { assemble, section, estimateTokens } from '../prompt-builder.js';
import { buildAgentPrompt } from '../prompt-agent.js';
import { coerceVerdict } from '../agent-types.js';
import { coercePolicyPatch, diffPatch } from '../policy.js';
import { coerceDraft } from '../editor.js';
import { DEFAULT_POLICY } from '../agent-types.js';

const ctx = {
  threadId: 't1',
  senderId: 'u1',
  role: 0,
  isGroup: false,
  platform: 'fluxer',
};

beforeEach(() => {
  clearTools();
});

describe('validateArgs', () => {
  const schema = {
    type: 'object' as const,
    properties: {
      query: { type: 'string' as const },
      limit: { type: 'integer' as const, default: 8, minimum: 1, maximum: 25 },
      verbose: { type: 'boolean' as const },
    },
    required: ['query'],
  };

  it('accepts valid args and applies defaults', () => {
    const r = validateArgs(schema, { query: 'weather' });
    expect(r.ok).toBe(true);
    expect(r.value).toEqual({ query: 'weather', limit: 8 });
  });

  it('rejects missing required fields', () => {
    const r = validateArgs(schema, {});
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toContain('query');
  });

  it('coerces safe model mistakes', () => {
    const r = validateArgs(schema, { query: 'x', limit: '3', verbose: 'true' });
    expect(r.ok).toBe(true);
    expect(r.value.limit).toBe(3);
    expect(r.value.verbose).toBe(true);
  });

  it('enforces ranges and drops unknown props', () => {
    const r = validateArgs(schema, { query: 'x', limit: 99, evil: 'drop me' });
    expect(r.ok).toBe(false);
    expect(r.value).not.toHaveProperty('evil');
  });

  it('rejects bad enums', () => {
    const r = validateArgs(
      { type: 'object', properties: { kind: { type: 'string', enum: ['a', 'b'] } }, required: ['kind'] },
      { kind: 'z' },
    );
    expect(r.ok).toBe(false);
  });
});

describe('tool registry', () => {
  it('resolves near-miss names', () => {
    registerTool({
      name: 'list_commands',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: true, content: 'ok' }),
    });
    expect(resolveTool('list_commands')?.name).toBe('list_commands');
    expect(resolveTool('listCommands')?.name).toBe('list_commands');
    expect(resolveTool('functions.list_commands')?.name).toBe('list_commands');
    expect(resolveTool('nope_nothing')?.name).toBeUndefined();
  });

  it('executeTool returns observations instead of throwing', async () => {
    registerTool({
      name: 'boom',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        throw new Error('kaput');
      },
    });
    const r = await executeTool('boom', {}, ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('kaput');
  });

  it('enforces minRole', async () => {
    registerTool({
      name: 'admin_only',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      minRole: 3,
      handler: async () => ({ ok: true, content: 'secret' }),
    });
    const denied = await executeTool('admin_only', {}, ctx);
    expect(denied.ok).toBe(false);
    const allowed = await executeTool('admin_only', {}, { ...ctx, role: 4 });
    expect(allowed.ok).toBe(true);
  });

  it('reports unknown tools with the known list', async () => {
    registerTool({
      name: 'known_tool',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: true, content: 'ok' }),
    });
    const r = await executeTool('mystery', {}, ctx);
    expect(r.ok).toBe(false);
    expect(r.content).toContain('known_tool');
  });

  it('listTools filters by role and toolDefinitions shapes output', () => {
    registerTool({
      name: 'a',
      description: 'da',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: true, content: 'ok' }),
    });
    registerTool({
      name: 'b',
      description: 'db',
      parameters: { type: 'object', properties: {} },
      minRole: 3,
      handler: async () => ({ ok: true, content: 'ok' }),
    });
    expect(listTools({ role: 0 }).map((t) => t.name)).toEqual(['a']);
    expect(toolDefinitions(listTools())[0]).toMatchObject({
      type: 'function',
      function: { name: 'a' },
    });
  });

  it('protocolPrompt documents every tool', () => {
    registerTool({
      name: 'get_context',
      description: 'ctx',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: true, content: 'ok' }),
    });
    const p = protocolPrompt(listTools());
    expect(p).toContain('get_context');
    expect(p).toContain('TOOL:');
  });
});

describe('prompt builder', () => {
  it('keeps priority-0 sections and drops the least important first', () => {
    const out = assemble(
      [
        section('identity', 0, 'id'),
        section('rules', 0, 'rules'),
        section('examples', 4, 'x'.repeat(500)),
      ],
      { maxChars: 60 },
    );
    expect(out.kept).toContain('identity');
    expect(out.kept).toContain('rules');
    expect(out.dropped).toContain('examples');
    expect(out.overBudget).toBe(false);
  });

  it('flags overBudget when priority-0 alone overflows', () => {
    const out = assemble([section('identity', 0, 'x'.repeat(100))], { maxChars: 10 });
    expect(out.overBudget).toBe(true);
    expect(out.kept).toContain('identity');
  });

  it('estimates tokens', () => {
    expect(estimateTokens('abcd')).toBe(1);
  });

  it('buildAgentPrompt assembles all layers within budget', () => {
    const out = buildAgentPrompt({
      botName: 'TestBot',
      profile: { preferredName: 'Ali', facts: ['Lives in: Tehran'], messageCount: 5 },
      isGroup: true,
      hasTools: true,
    });
    expect(out.text).toContain('TestBot');
    expect(out.text).toContain('Ali');
    expect(out.kept).toContain('identity');
    expect(out.kept).toContain('rules');
  });
});

describe('coerceVerdict', () => {
  it('accepts a clean verdict and clamps confidence', () => {
    expect(
      coerceVerdict({ action: 'DELETE', category: ' Promo ', confidence: 2, reason: 'spam' }),
    ).toEqual({ action: 'delete', category: 'promo', confidence: 1, reason: 'spam' });
  });

  it('degrades garbage to a safe allow', () => {
    expect(coerceVerdict(null)).toMatchObject({ action: 'allow', confidence: 0 });
    expect(coerceVerdict({ action: 'nuke', category: 'weird' })).toMatchObject({
      action: 'allow',
      category: 'unknown',
    });
  });
});

describe('policy patch', () => {
  const base = { ...DEFAULT_POLICY, threadId: 't1' };

  it('accepts a valid patch', () => {
    const p = coercePolicyPatch({
      enabled: true,
      minConfidence: 0.8,
      links: { mode: 'strict', denyCategories: ['promo', 'scam'] },
      note: 'block promos',
    });
    expect(p.enabled).toBe(true);
    expect(p.links?.mode).toBe('strict');
    expect(diffPatch(base, p)).not.toHaveLength(0);
  });

  it('drops invalid and malicious fields', () => {
    const p = coercePolicyPatch({
      links: { mode: 'nuke', denyCategories: ['promo', 'evilcat'], exempt: ['admins', 'root'] },
      dryRun: false,
      whitelist: ['attacker'],
      __proto__: { polluted: true },
    });
    expect(p.links?.mode).toBeUndefined();
    expect(p.links?.denyCategories).toEqual(['promo']);
    expect(p.links?.exempt).toEqual(['admins']);
    expect(p).not.toHaveProperty('dryRun');
    expect(p).not.toHaveProperty('whitelist');
  });

  it('clamps confidence and mute windows', () => {
    const p = coercePolicyPatch({
      minConfidence: 5,
      links: { enforcement: { delete: true, warn: false, muteSeconds: 99999999 } },
    });
    expect(p.minConfidence).toBeUndefined();
    expect(p.links?.enforcement?.muteSeconds).toBe(7 * 86400);
  });
});

describe('coerceDraft', () => {
  it('truncates to the platform limit', () => {
    const d = coerceDraft({ text: 'x'.repeat(9000), summary: 's' });
    expect(d.text.length).toBeLessThanOrEqual(4096);
  });

  it('handles garbage', () => {
    expect(coerceDraft(null).text).toBe('');
  });
});
