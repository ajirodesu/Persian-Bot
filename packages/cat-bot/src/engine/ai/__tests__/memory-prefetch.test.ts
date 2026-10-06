import { describe, it, expect, beforeEach } from 'vitest';
import {
  upsertProfile,
  getProfile,
  recordMessage,
  detectPreferredName,
  extractFacts,
  mergeFacts,
  rememberUserFact,
  getConversation,
  appendTurn,
  maybeCompressHistory,
  buildMemoryContext,
  clearMemory,
} from '../memory.js';
import { prefetch, renderPrefetch, __test } from '../prefetch.js';
import { registerTool, clearTools } from '../tools.js';

beforeEach(() => {
  clearMemory();
  clearTools();
});

describe('profiles', () => {
  it('creates and updates profiles', () => {
    const p = upsertProfile('u1', { displayName: 'Ali' });
    expect(p.messageCount).toBe(0);
    recordMessage('u1');
    expect(getProfile('u1')?.messageCount).toBe(1);
    expect(getProfile('u1')?.displayName).toBe('Ali');
  });

  it('detects preferred names', () => {
    expect(detectPreferredName('call me Reza')).toBe('Reza');
    expect(detectPreferredName('hello there')).toBeNull();
  });
});

describe('facts', () => {
  it('extracts explicit self-statements', () => {
    expect(extractFacts('I live in Tehran')).toEqual(['Lives in: Tehran']);
    expect(extractFacts('I am 25 years old')).toEqual(['Age: 25']);
  });

  it('refuses secrets and forget requests', () => {
    expect(extractFacts('my password is hunter2')).toEqual([]);
    expect(extractFacts('forget that I live in Tehran')).toEqual([]);
  });

  it('replaces duplicate labels and caps at 12', () => {
    const p = upsertProfile('u1');
    mergeFacts(p, ['Lives in: Tehran']);
    mergeFacts(p, ['Lives in: Mashhad']);
    expect(p.facts).toEqual(['Lives in: Mashhad']);
    mergeFacts(p, Array.from({ length: 20 }, (_, i) => `K${i}: v`));
    expect(p.facts.length).toBe(12);
  });

  it('rememberUserFact guards secrets', () => {
    const p = upsertProfile('u1');
    expect(rememberUserFact(p, 'Lives in: Shiraz')).toBe(true);
    expect(rememberUserFact(p, 'my api key is sk-123')).toBe(false);
    expect(rememberUserFact(p, '')).toBe(false);
  });
});

describe('conversation history', () => {
  it('truncates and keeps a summary without losing everything', async () => {
    const turns = Array.from({ length: 14 }, (_, i) => ({
      role: 'user' as const,
      content: `message ${i}`,
    }));
    const state = await appendTurn('k1', turns, { maxTurns: 10, keepRecent: 4, summarize: false });
    expect(state.messages.length).toBeLessThanOrEqual(10);
    expect(state.summary).toBeTruthy();
  });

  it('falls back to a digest when summarisation fails', async () => {
    const state = getConversation('k2');
    state.messages = Array.from({ length: 8 }, (_, i) => ({
      role: 'user' as const,
      content: `hello ${i}`,
    }));
    // No provider keys in this env → summariser throws → digest fallback.
    const out = await maybeCompressHistory('k2', { keepRecent: 2, summarize: true });
    expect(out.messages.length).toBe(2);
    expect(out.summary).toContain('hello');
  });

  it('builds prompt-ready memory context', () => {
    const p = upsertProfile('u9');
    mergeFacts(p, ['Likes: tea']);
    const out = buildMemoryContext('missing-key', p);
    expect(out).toContain('tea');
    expect(buildMemoryContext('missing-key', null)).toBeNull();
  });
});

describe('prefetch rules', () => {
  const toolCtx = {
    threadId: 't1',
    senderId: 'u1',
    role: 4,
    isGroup: true,
    platform: 'fluxer',
  };

  it('matches capability questions', () => {
    expect(__test.CAPABILITIES.some((re) => re.test('what can you do?'))).toBe(true);
  });

  it('runs list_commands for capability questions', async () => {
    registerTool({
      name: 'list_commands',
      description: 'd',
      parameters: { type: 'object', properties: {} },
      handler: async () => ({ ok: true, content: 'ping, weather' }),
    });
    const out = await prefetch('what can you do?', toolCtx);
    expect(out).toHaveLength(1);
    expect(out[0]?.tool).toBe('list_commands');
    expect(renderPrefetch(out)).toContain('Use it to answer directly');
  });

  it('runs server lookup for explicit ids in follow-ups', async () => {
    registerTool({
      name: 'get_server_info',
      description: 'd',
      parameters: { type: 'object', properties: { server_id: { type: 'string' } } },
      handler: async (args) => ({ ok: true, content: `info for ${String(args.server_id)}` }),
    });
    const out = await prefetch('check access or not', toolCtx, ['tell me about 123456789012']);
    expect(out[0]?.content).toContain('123456789012');
  });

  it('ignores unrelated follow-ups', async () => {
    registerTool({
      name: 'get_server_info',
      description: 'd',
      parameters: { type: 'object', properties: { server_id: { type: 'string' } } },
      handler: async () => ({ ok: true, content: 'should not run' }),
    });
    const out = await prefetch('what is the weather today', toolCtx, ['tell me about 123456789012']);
    expect(out).toHaveLength(0);
  });

  it('stays silent on normal chatter', async () => {
    const out = await prefetch('hello, how are you?', toolCtx);
    expect(out).toHaveLength(0);
    expect(renderPrefetch(out)).toBe('');
  });
});
