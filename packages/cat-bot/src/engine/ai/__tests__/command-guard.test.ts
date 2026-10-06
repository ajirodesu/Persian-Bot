import { describe, it, expect, vi, beforeEach } from 'vitest';
import { inspectPreviewConstraints } from '../command-guard.js';
import { cooldownStore } from '@/engine/lib/cooldown.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

vi.mock('@/engine/repos/banned.repo.js', () => ({
  isUserBanned: vi.fn(async () => false),
  isThreadBanned: vi.fn(async () => false),
}));

vi.mock('@/engine/repos/credentials.repo.js', () => ({
  isBotAdmin: vi.fn(async () => false),
  isBotPremium: vi.fn(async () => false),
  listBotPremiums: vi.fn(async () => []),
}));

vi.mock('@/engine/repos/threads.repo.js', () => ({
  isThreadAdmin: vi.fn(async () => false),
}));

vi.mock('@/engine/repos/system-admin.repo.js', () => ({
  isSystemAdmin: vi.fn(async () => false),
}));

vi.mock('@/engine/modules/session/bot-session-commands.repo.js', () => ({
  isCommandEnabled: vi.fn(async () => true),
}));

vi.mock('@/engine/repos/maintenance-mode.repo.js', () => ({
  getMaintenanceModeEnabled: vi.fn(async () => false),
}));

const { isThreadAdmin } = await import('@/engine/repos/threads.repo.js');
const { isCommandEnabled } = await import(
  '@/engine/modules/session/bot-session-commands.repo.js'
);
const { getMaintenanceModeEnabled } = await import(
  '@/engine/repos/maintenance-mode.repo.js'
);

function ctx(over: { event?: Record<string, unknown> } = {}): AppCtx {
  return {
    event: { senderID: 'u1', threadID: 't1', messageID: 'm1', ...(over.event ?? {}) },
    native: { platform: 'fluxer', userId: 'owner', sessionId: 's1' },
    db: {
      bot: { isCollectionExist: async () => false },
      threads: { collection: () => ({ isCollectionExist: async () => false }) },
    },
  } as unknown as AppCtx;
}

function mod(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    meta: { name: 'pic', role: 0, cooldown: 0, ...(over.meta as Record<string, unknown> | undefined) },
    onCommand: async () => {},
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isThreadAdmin).mockResolvedValue(false);
  vi.mocked(isCommandEnabled).mockResolvedValue(true);
  vi.mocked(getMaintenanceModeEnabled).mockResolvedValue(false);
});

describe('inspectPreviewConstraints', () => {
  it('allows public commands', async () => {
    const r = await inspectPreviewConstraints(ctx(), mod(), 'pic');
    expect(r).toEqual({ allowed: true, reason: null });
  });

  it('blocks platform-excluded commands', async () => {
    const m = mod();
    (m.meta as Record<string, unknown>).platform = ['discord'];
    const r = await inspectPreviewConstraints(ctx(), m, 'pic');
    expect(r.allowed).toBe(false);
  });

  it('blocks dashboard-disabled commands', async () => {
    vi.mocked(isCommandEnabled).mockResolvedValueOnce(false);
    const r = await inspectPreviewConstraints(ctx(), mod(), 'pic');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('disabled');
  });

  it('blocks non-admins in maintenance mode', async () => {
    vi.mocked(getMaintenanceModeEnabled).mockResolvedValueOnce(true);
    const r = await inspectPreviewConstraints(ctx(), mod(), 'pic');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('maintenance');
  });

  it('enforces the role matrix fail-closed', async () => {
    const denied = await inspectPreviewConstraints(
      ctx(),
      mod({ meta: { name: 'kick', role: 1 } }),
      'kick',
    );
    expect(denied.allowed).toBe(false);
    expect(denied.details?.requiredRole).toBe('Thread Administrator');

    vi.mocked(isThreadAdmin).mockResolvedValueOnce(true);
    const allowed = await inspectPreviewConstraints(
      ctx(),
      mod({ meta: { name: 'kick', role: 1 } }),
      'kick',
    );
    expect(allowed.allowed).toBe(true);
  });

  it('checks cooldowns without consuming them', async () => {
    const key = 'pic:u1';
    cooldownStore.record(key, Date.now(), 60_000);
    const blocked = await inspectPreviewConstraints(
      ctx(),
      mod({ meta: { name: 'pic', role: 0, cooldown: 60 } }),
      'pic',
    );
    expect(blocked.allowed).toBe(false);
    expect(blocked.details?.cooldownRemainingSeconds).toBeGreaterThan(0);

    const fresh = `fresh:${Date.now()}`;
    const ok = await inspectPreviewConstraints(
      ctx({ event: { senderID: fresh, threadID: 't1' } }),
      mod({ meta: { name: 'pic', role: 0, cooldown: 60 } }),
      'pic',
    );
    expect(ok.allowed).toBe(true);
    // Preview must not consume: a second check for the same user still passes.
    const again = await inspectPreviewConstraints(
      ctx({ event: { senderID: fresh, threadID: 't1' } }),
      mod({ meta: { name: 'pic', role: 0, cooldown: 60 } }),
      'pic',
    );
    expect(again.allowed).toBe(true);
  });

  it('blocks admin-only sessions for non-admins', async () => {
    const c = ctx();
    (c.db as unknown as Record<string, unknown>).bot = {
      isCollectionExist: async () => true,
      getCollection: async () => ({
        getAll: async () => ({ adminOnlyEnabled: true, adminOnlyIgnoreList: [] }),
      }),
    };
    const r = await inspectPreviewConstraints(c, mod(), 'pic');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('admin-only');
  });
});
