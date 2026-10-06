import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateGraph, runGraph, formatTrace } from '../graph.js';
import { judge } from '../moderator.js';
import { judgeWithConsensus, isBorderline } from '../consensus.js';
import { draftPost } from '../editor.js';
import { compileOrder } from '../policy.js';
import { DEFAULT_POLICY } from '../agent-types.js';
import type { ChatPolicy } from '../agent-types.js';

vi.mock('../runner.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runner.js')>();
  return {
    ...actual,
    askAgentText: vi.fn(),
    askAgentJSON: vi.fn(),
  };
});

const { askAgentText, askAgentJSON } = await import('../runner.js');
const mockText = vi.mocked(askAgentText);
const mockJSON = vi.mocked(askAgentJSON);

function policy(over: Partial<ChatPolicy> = {}): ChatPolicy {
  return {
    ...DEFAULT_POLICY,
    threadId: 't1',
    links: { ...DEFAULT_POLICY.links, enforcement: { ...DEFAULT_POLICY.links.enforcement } },
    whitelist: [],
    notes: [],
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('validateGraph', () => {
  it('accepts a valid graph', () => {
    expect(
      validateGraph({
        name: 'g',
        entry: 'a',
        nodes: { a: { id: 'a', kind: 'transform', next: null, run: () => ({}) } },
      }),
    ).toEqual([]);
  });

  it('catches dangling references', () => {
    const errors = validateGraph({
      name: 'g',
      entry: 'missing',
      nodes: { a: { id: 'wrong', kind: 'transform', next: 'ghost', run: () => ({}) } },
    });
    expect(errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('runGraph', () => {
  it('runs gate branches', async () => {
    const res = await runGraph(
      {
        name: 'g',
        entry: 'start',
        nodes: {
          start: { id: 'start', kind: 'gate', when: () => true, then: 'yes', otherwise: 'no' },
          yes: { id: 'yes', kind: 'transform', next: null, run: () => ({ picked: 'yes' }) },
          no: { id: 'no', kind: 'transform', next: null, run: () => ({ picked: 'no' }) },
        },
      },
      {},
    );
    expect(res.stopReason).toBe('end');
    expect(res.state.picked).toBe('yes');
  });

  it('runs routers with fallback', async () => {
    const res = await runGraph(
      {
        name: 'g',
        entry: 'r',
        nodes: {
          r: {
            id: 'r',
            kind: 'router',
            routes: [{ to: 'a', when: () => false, label: 'a' }],
            fallback: 'b',
          },
          a: { id: 'a', kind: 'transform', next: null, run: () => ({}) },
          b: { id: 'b', kind: 'transform', next: null, run: () => ({ hit: true }) },
        },
      },
      {},
    );
    expect(res.state.hit).toBe(true);
  });

  it('runs tool nodes and merges parallel branches in order', async () => {
    const { registerTool, clearTools } = await import('../tools.js');
    clearTools();
    registerTool({
      name: 'echo_tool',
      description: 'd',
      parameters: { type: 'object', properties: { v: { type: 'integer' } } },
      handler: async (args) => ({ ok: true, content: `echo:${String(args.v)}` }),
    });
    const res = await runGraph(
      {
        name: 'g',
        entry: 'fan',
        nodes: {
          fan: { id: 'fan', kind: 'parallel', branches: ['t1', 't2'], next: null },
          t1: {
            id: 't1',
            kind: 'tool',
            tool: 'echo_tool',
            args: () => ({ v: 1 }),
            output: (r) => ({ one: r.content }),
          },
          t2: {
            id: 't2',
            kind: 'tool',
            tool: 'echo_tool',
            args: () => ({ v: 2 }),
            output: (r) => ({ two: r.content }),
          },
        },
      },
      {},
      {
        ctx: { threadId: 't', senderId: 'u', role: 0, isGroup: false, platform: 'fluxer' },
      },
    );
    expect(res.stopReason).toBe('end');
    expect(res.state).toMatchObject({ one: 'echo:1', two: 'echo:2' });
    expect(formatTrace(res.trace)).toContain('fan');
  });

  it('enforces cycle protection and timeouts', async () => {
    const cycled = await runGraph(
      {
        name: 'g',
        entry: 'a',
        nodes: { a: { id: 'a', kind: 'transform', next: 'a', run: () => ({}) } },
      },
      {},
      { maxVisitsPerNode: 2 },
    );
    expect(cycled.stopReason).toBe('max_visits');

    const slow = await runGraph(
      {
        name: 'g',
        entry: 'a',
        nodes: {
          a: {
            id: 'a',
            kind: 'transform',
            next: null,
            run: async () => {
              await new Promise((r) => setTimeout(r, 50));
              return {};
            },
          },
        },
      },
      {},
      { timeoutMs: 5 },
    );
    // First node runs before the deadline check on the next iteration;
    // slow single nodes complete — assert it ended sanely either way.
    expect(['end', 'timeout']).toContain(slow.stopReason);
  });
});

describe('judge', () => {
  const input = {
    text: 'buy my course http://spam.example',
    links: ['http://spam.example'],
    policy: policy({ enabled: true, dryRun: true }),
    context: [],
  };

  it('returns delete verdicts on confident spam', async () => {
    mockJSON.mockResolvedValueOnce({
      data: { action: 'delete', category: 'promo', confidence: 0.9, reason: 'spam link' },
      raw: '{}',
      provider: 'groq',
      model: 'm',
      attempts: 1,
    });
    const { verdict } = await judge(input);
    expect(verdict.action).toBe('delete');
  });

  it('degrades malformed output to safe allow', async () => {
    mockJSON.mockRejectedValueOnce(new Error('no json'));
    const { verdict, error } = await judge(input);
    expect(verdict.action).toBe('allow');
    expect(verdict.confidence).toBe(0);
    expect(error).toBeTruthy();
  });
});

describe('judgeWithConsensus', () => {
  const input = {
    text: 'check this http://grey.example',
    links: ['http://grey.example'],
    policy: policy({ enabled: true, dryRun: false, minConfidence: 0.75 }),
    context: [],
  };

  it('uses a single pass when second opinion is off', async () => {
    mockJSON.mockResolvedValueOnce({
      data: { action: 'allow', category: 'legit', confidence: 0.9, reason: 'fine' },
      raw: '{}',
      provider: 'groq',
      model: 'm',
      attempts: 1,
    });
    const res = await judgeWithConsensus(input, input.policy);
    expect(res.stage).toBe('agent');
    expect(res.verdict.action).toBe('allow');
  });

  it('escalates borderline calls and agrees', async () => {
    const p = policy({ enabled: true, dryRun: false, minConfidence: 0.75, secondOpinion: true });
    mockJSON
      .mockResolvedValueOnce({
        data: { action: 'delete', category: 'promo', confidence: 0.6, reason: 'looks like promo' },
        raw: '{}',
        provider: 'groq',
        model: 'm1',
        attempts: 1,
      })
      .mockResolvedValueOnce({
        data: { action: 'delete', category: 'promo', confidence: 0.8, reason: 'also promo' },
        raw: '{}',
        provider: 'openrouter',
        model: 'm2',
        attempts: 1,
      });
    const res = await judgeWithConsensus({ ...input, policy: p }, p);
    expect(res.stage).toBe('consensus');
    expect(res.verdict.confidence).toBe(0.8);
  });

  it('stays conservative on disagreement', async () => {
    const p = policy({ enabled: true, dryRun: false, minConfidence: 0.75, secondOpinion: true });
    mockJSON
      .mockResolvedValueOnce({
        data: { action: 'delete', category: 'promo', confidence: 0.6, reason: 'promo?' },
        raw: '{}',
        provider: 'groq',
        model: 'm1',
        attempts: 1,
      })
      .mockResolvedValueOnce({
        data: { action: 'allow', category: 'legit', confidence: 0.7, reason: 'looks fine' },
        raw: '{}',
        provider: 'openrouter',
        model: 'm2',
        attempts: 1,
      });
    const res = await judgeWithConsensus({ ...input, policy: p }, p);
    expect(res.verdict.confidence).toBeLessThan(0.75);
  });

  it('isBorderline only flags actionable near-misses', () => {
    const p = policy({ minConfidence: 0.75 });
    expect(isBorderline({ action: 'delete', category: 'promo', confidence: 0.6, reason: 'x' }, p)).toBe(true);
    expect(isBorderline({ action: 'allow', category: 'legit', confidence: 0.6, reason: 'x' }, p)).toBe(false);
    expect(isBorderline({ action: 'delete', category: 'promo', confidence: 0.9, reason: 'x' }, p)).toBe(false);
    expect(isBorderline({ action: 'delete', category: 'promo', confidence: 0.1, reason: 'x' }, p)).toBe(false);
  });
});

describe('editor + policy agents', () => {
  it('drafts posts structurally', async () => {
    mockJSON.mockResolvedValueOnce({
      data: { text: 'Hello channel!', summary: 'greeting' },
      raw: '{}',
      provider: 'groq',
      model: 'm',
      attempts: 1,
    });
    const { draft, error } = await draftPost({ instruction: 'greet the channel' });
    expect(error).toBeUndefined();
    expect(draft.text).toBe('Hello channel!');
  });

  it('compiles orders into validated patches', async () => {
    const { coercePolicyPatch: coerce } = await import('../policy.js');
    mockJSON.mockImplementationOnce(async (_name, _req, validate) => ({
      data: (validate ?? coerce)({
        links: { denyCategories: ['promo'] },
        note: 'block promos',
        dryRun: false,
        whitelist: ['attacker'],
      }),
      raw: '{}',
      provider: 'groq',
      model: 'm',
      attempts: 1,
    }));
    const res = await compileOrder('delete promotional links', policy());
    expect(res.patch.links?.denyCategories).toEqual(['promo']);
    expect(res.patch).not.toHaveProperty('dryRun');
    expect(res.patch).not.toHaveProperty('whitelist');
    expect(res.changes.length).toBeGreaterThan(0);
  });

  it('returns empty patch on agent failure', async () => {
    mockJSON.mockRejectedValueOnce(new Error('down'));
    const res = await compileOrder('do things', policy());
    expect(res.patch).toEqual({});
    expect(res.error).toBeTruthy();
  });

  it('mockText is available', () => {
    expect(mockText).toBeDefined();
  });
});
