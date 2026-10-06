import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  guard,
  recordAdminContext,
  getAdminContext,
  pruneGuardianContext,
  clearGuardianState,
  MAX_ENFORCEMENTS_PER_MINUTE,
} from '../guardian.js';
import { savePolicy, clearPolicyCache } from '../policy-store.js';
import { DEFAULT_POLICY } from '../agent-types.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

vi.mock('../service.js', () => ({
  moderateMessage: vi.fn(),
  resolveSenderRole: vi.fn(async () => 0),
  threadPolicyHandles: () => ({
    loadThreadPolicy: async () => null,
    saveThreadPolicy: async () => {},
  }),
  threadAuditPersister: () => async () => {},
}));

vi.mock('@/engine/lib/auth-cache.lib.js', () => ({
  cachedIsThreadAdmin: vi.fn(async () => false),
}));

const { moderateMessage } = await import('../service.js');
const { cachedIsThreadAdmin } = await import('@/engine/lib/auth-cache.lib.js');
const mockModerate = vi.mocked(moderateMessage);
const mockIsThreadAdmin = vi.mocked(cachedIsThreadAdmin);

function ctx(over: Partial<Record<string, unknown>> = {}): AppCtx {
  return {
    event: {
      threadID: 't1',
      senderID: 'u1',
      message: 'hello',
      messageID: 'm1',
      isGroup: true,
      ...(over.event as Record<string, unknown> | undefined),
    },
    native: { platform: 'fluxer', userId: 'owner', sessionId: 's1' },
    bot: { getID: () => 'bot-1' },
    chat: {
      unsendMessage: vi.fn(async () => {}),
      replyMessage: vi.fn(async () => 'sent-1'),
    },
    db: {
      threads: {
        collection: () => ({
          isCollectionExist: async () => false,
          createCollection: async () => {},
          getCollection: async () => ({ get: async () => null, set: async () => {} }),
        }),
      },
    },
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    ...(over.ctx as Record<string, unknown> | undefined),
  } as unknown as AppCtx;
}

function enablePolicy(dryRun = true): void {
  void savePolicy(
    {
      ...DEFAULT_POLICY,
      threadId: 't1',
      enabled: true,
      dryRun,
      links: { ...DEFAULT_POLICY.links, enforcement: { ...DEFAULT_POLICY.links.enforcement } },
      whitelist: [],
      notes: [],
    },
    undefined,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  clearGuardianState();
  clearPolicyCache();
  mockIsThreadAdmin.mockResolvedValue(false);
});

describe('guard gate', () => {
  it('skips non-groups, empty text, and ai-initiated events', async () => {
    expect((await guard(ctx({ event: { isGroup: false } }))).skipReason).toBe('not a group');
    expect((await guard(ctx({ event: { message: '   ' } }))).skipReason).toBe('no text');
    expect((await guard(ctx({ event: { aiInitiated: true } }))).skipReason).toBe('ai-initiated');
  });

  it('skips when the policy is disabled (default)', async () => {
    const out = await guard(ctx());
    expect(out.checked).toBe(false);
    expect(out.skipReason).toBe('moderation disabled for this chat');
    expect(mockModerate).not.toHaveBeenCalled();
  });

  it('skips the bot own messages', async () => {
    enablePolicy();
    const out = await guard(ctx({ event: { senderID: 'bot-1' } }));
    expect(out.skipReason).toBe('own message');
  });

  it('records admin context and skips thread admins', async () => {
    enablePolicy();
    mockIsThreadAdmin.mockResolvedValueOnce(true);
    const c = ctx({ event: { senderID: 'admin1', message: 'New release v2 is out' } });
    const out = await guard(c);
    expect(out.skipReason).toBe('admin');
    expect(getAdminContext(c, 't1')).toEqual(['New release v2 is out']);
  });
});

describe('guard enforcement', () => {
  it('does not enforce in dry-run mode', async () => {
    enablePolicy(true);
    mockModerate.mockResolvedValueOnce({
      action: 'flag',
      category: 'promo',
      confidence: 0.9,
      reason: 'dry-run preview',
      stage: 'agent' as const,
    });
    const c = ctx({ event: { message: 'buy now http://spam.example' } });
    const out = await guard(c);
    expect(out.checked).toBe(true);
    expect(out.enforced).toBe(false);
    expect(c.chat.unsendMessage).not.toHaveBeenCalled();
  });

  it('deletes and warns on confident verdicts', async () => {
    enablePolicy(false);
    mockModerate.mockResolvedValueOnce({
      action: 'delete',
      category: 'promo',
      confidence: 0.95,
      reason: 'spam link',
      stage: 'rules' as const,
    });
    const c = ctx({ event: { message: 'buy now http://spam.example' } });
    const out = await guard(c);
    expect(out.enforced).toBe(true);
    expect(c.chat.unsendMessage).toHaveBeenCalledWith('m1');
    expect(c.chat.replyMessage).toHaveBeenCalled();
  });

  it('stands down above the rate cap', async () => {
    enablePolicy(false);
    mockModerate.mockResolvedValue({
      action: 'delete',
      category: 'promo',
      confidence: 0.95,
      reason: 'spam',
      stage: 'rules' as const,
    });
    const c = ctx();
    for (let i = 0; i < MAX_ENFORCEMENTS_PER_MINUTE; i++) {
      const out = await guard(c);
      expect(out.enforced).toBe(true);
    }
    const stoodDown = await guard(c);
    expect(stoodDown.enforced).toBe(false);
    expect(stoodDown.dryRun).toBe(true);
  });

  it('degrades to warn-only when deletion is not permitted', async () => {
    enablePolicy(false);
    mockModerate.mockResolvedValueOnce({
      action: 'delete',
      category: 'promo',
      confidence: 0.95,
      reason: 'spam',
      stage: 'rules' as const,
    });
    const c = ctx();
    (c.chat.unsendMessage as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('forbidden'));
    const out = await guard(c);
    expect(out.enforced).toBe(false);
    expect(c.chat.replyMessage).toHaveBeenCalled();
  });

  it('never throws on pipeline failure', async () => {
    enablePolicy(false);
    mockModerate.mockRejectedValueOnce(new Error('agent down'));
    const out = await guard(ctx());
    expect(out.checked).toBe(false);
  });
});

describe('admin context buffer', () => {
  it('scopes, bounds, and prunes context', () => {
    const c = ctx();
    for (let i = 0; i < 12; i++) recordAdminContext(c, 't1', `msg ${i}`);
    const kept = getAdminContext(c, 't1');
    expect(kept).toHaveLength(8);
    expect(kept[0]).toBe('msg 4');
    expect(getAdminContext(ctx({ event: { threadID: 'other' } }), 'other')).toEqual([]);
    expect(pruneGuardianContext()).toBe(0);
  });
});
