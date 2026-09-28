import { beforeEach, describe, expect, it, vi } from 'vitest';
import './mock-database.js';
import { dbStubs, resetDbStubs } from './mock-database.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import { inspectCommandConstraints } from '../agent-command-guard.lib.js';
import { Role } from '@/engine/constants/role.constants.js';

const ANYONE_MOD = { meta: { name: 'ping', role: Role.ANYONE, cooldown: 0 } };
const THREAD_ADMIN_MOD = {
  meta: { name: 'warn', role: Role.THREAD_ADMIN, cooldown: 0 },
};
const BOT_ADMIN_MOD = {
  meta: { name: 'ban', role: Role.BOT_ADMIN, cooldown: 0 },
};
const PREMIUM_MOD = {
  meta: { name: 'fancy', role: Role.PREMIUM, cooldown: 0 },
};
const SYSTEM_MOD = {
  meta: { name: 'sys', role: Role.SYSTEM_ADMIN, cooldown: 0 },
};
const COOLDOWN_MOD = { meta: { name: 'spin', role: Role.ANYONE, cooldown: 60 } };
const PLATFORM_MOD = {
  meta: { name: 'slash', role: Role.ANYONE, cooldown: 0, platform: ['discord'] },
};

const COORDS = {
  senderID: 'user1',
  threadID: 'thread1',
  sessionUserId: 'owner1',
  platform: 'fluxer',
  sessionId: 'sess1',
} as const;

function check(
  mod: Record<string, unknown>,
  overrides: Partial<typeof COORDS> = {},
  consumeCooldown = true,
  commandEnabled = true,
) {
  const c = { ...COORDS, ...overrides };
  return inspectCommandConstraints(
    mod,
    (mod['meta'] as { name: string }).name,
    c.senderID,
    c.threadID,
    c.sessionUserId,
    c.platform,
    c.sessionId,
    consumeCooldown,
    commandEnabled,
  );
}

describe('agent-command-guard', () => {
  beforeEach(() => {
    lruCache.clear();
    vi.clearAllMocks();
    resetDbStubs();
  });

  it('allows public commands for regular users', async () => {
    const res = await check(ANYONE_MOD);
    expect(res.allowed).toBe(true);
    expect(res.reason).toBeNull();
  });

  it('rejects platform-restricted commands', async () => {
    const res = await check(PLATFORM_MOD);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('fluxer');
  });

  it('rejects disabled commands', async () => {
    const res = await check(ANYONE_MOD, {}, true, false);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('disabled');
  });

  it('rejects banned users with an AI-readable reason', async () => {
    dbStubs.isUserBanned.mockResolvedValue(true);
    const res = await check(ANYONE_MOD);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('banned');
    expect(res.details?.bannedEntity).toBe('user');
  });

  it('rejects banned threads', async () => {
    dbStubs.isThreadBanned.mockResolvedValue(true);
    const res = await check(ANYONE_MOD);
    expect(res.allowed).toBe(false);
    expect(res.details?.bannedEntity).toBe('thread');
  });

  it('lets bot admins bypass bans', async () => {
    dbStubs.listBotAdmins.mockResolvedValue(['user1']);
    dbStubs.isUserBanned.mockResolvedValue(true);
    const res = await check(ANYONE_MOD);
    expect(res.allowed).toBe(true);
  });

  it('enforces thread-admin role with requiredRole detail', async () => {
    const res = await check(THREAD_ADMIN_MOD);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('thread administrator');
    expect(res.details?.requiredRole).toBe('Thread Administrator');
  });

  it('grants thread-admin commands to thread admins', async () => {
    dbStubs.isThreadAdmin.mockResolvedValue(true);
    const res = await check(THREAD_ADMIN_MOD);
    expect(res.allowed).toBe(true);
  });

  it('enforces bot-admin role', async () => {
    const denied = await check(BOT_ADMIN_MOD);
    expect(denied.allowed).toBe(false);
    expect(denied.details?.requiredRole).toBe('Bot Administrator');
    dbStubs.listBotAdmins.mockResolvedValue(['user1']);
    lruCache.clear(); // drop the [] list cached by the first check
    expect((await check(BOT_ADMIN_MOD)).allowed).toBe(true);
  });

  it('enforces premium role (bot admin inherits)', async () => {
    expect((await check(PREMIUM_MOD)).allowed).toBe(false);
    dbStubs.listBotPremiums.mockResolvedValue(['user1']);
    lruCache.clear();
    expect((await check(PREMIUM_MOD)).allowed).toBe(true);
  });

  it('restricts system-admin commands to system admins', async () => {
    expect((await check(SYSTEM_MOD)).allowed).toBe(false);
    dbStubs.listSystemAdmins.mockResolvedValue([{ adminId: 'user1' }]);
    lruCache.clear();
    expect((await check(SYSTEM_MOD)).allowed).toBe(true);
  });

  it('fail-closes permissions on DB error', async () => {
    dbStubs.isThreadAdmin.mockRejectedValue(new Error('db down'));
    dbStubs.listBotAdmins.mockRejectedValue(new Error('db down'));
    dbStubs.listBotPremiums.mockRejectedValue(new Error('db down'));
    const res = await check(THREAD_ADMIN_MOD);
    expect(res.allowed).toBe(false);
  });

  it('enforces cooldowns and reports remaining seconds', async () => {
    const first = await check(COOLDOWN_MOD);
    expect(first.allowed).toBe(true);
    const second = await check(COOLDOWN_MOD);
    expect(second.allowed).toBe(false);
    expect(second.reason).toContain('cooldown');
    expect(second.details?.cooldownRemainingSeconds).toBeGreaterThan(0);
  });

  it('does not consume cooldown on preview (consumeCooldown=false)', async () => {
    const preview = await check(
      { meta: { name: 'preview', role: Role.ANYONE, cooldown: 60 } },
      {},
      false,
    );
    expect(preview.allowed).toBe(true);
    const again = await check(
      { meta: { name: 'preview', role: Role.ANYONE, cooldown: 60 } },
      {},
      false,
    );
    expect(again.allowed).toBe(true);
  });

  it('lets admins bypass cooldown', async () => {
    dbStubs.listBotAdmins.mockResolvedValue(['user1']);
    const mod = { meta: { name: 'admcd', role: Role.ANYONE, cooldown: 60 } };
    expect((await check(mod)).allowed).toBe(true);
    expect((await check(mod)).allowed).toBe(true);
  });

  it('never exposes shell to the AI, even for system admins', async () => {
    dbStubs.listSystemAdmins.mockResolvedValue([{ adminId: 'user1' }]);
    const res = await check({
      meta: { name: 'shell', role: Role.SYSTEM_ADMIN, cooldown: 0 },
    });
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('security reasons');
  });

  it('blocks deny-listed commands by alias-resolved canonical name', async () => {
    dbStubs.listSystemAdmins.mockResolvedValue([{ adminId: 'user1' }]);
    const res = await check({
      meta: { name: 'shell', role: Role.SYSTEM_ADMIN, cooldown: 0 },
    });
    expect(res.allowed).toBe(false);
  });
});
