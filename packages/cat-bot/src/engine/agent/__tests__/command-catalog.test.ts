import { beforeEach, describe, expect, it, vi } from 'vitest';
import './mock-database.js';
import { dbStubs, resetDbStubs } from './mock-database.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import { buildCommandCatalog } from '../lib/command-catalog.lib.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

function mod(
  name: string,
  extra: Record<string, unknown> = {},
  alias?: string,
) {
  const m: Record<string, unknown> = {
    meta: {
      name,
      description: `${name} does things`,
      category: (extra['category'] as string) ?? 'Fun',
      usage: '',
      role: Role.ANYONE,
      ...extra,
    },
    onCommand: async () => undefined,
  };
  return { m, alias };
}

function makeCtx(mods: Array<Record<string, unknown>>): AppCtx {
  const commands = new Map<string, Record<string, unknown>>();
  for (const m of mods) {
    const name = (m['meta'] as { name: string }).name.toLowerCase();
    commands.set(name, m);
  }
  return {
    event: { senderID: 'user1', threadID: 'thread1', messageID: 'msg1' },
    commands,
    prefix: '/',
    native: { platform: 'fluxer', userId: 'owner1', sessionId: 'sess1' },
  } as unknown as AppCtx;
}

describe('command-catalog', () => {
  beforeEach(() => {
    lruCache.clear();
    vi.clearAllMocks();
    resetDbStubs();
  });

  it('deduplicates aliases (one entry per canonical name)', async () => {
    const a = mod('ping');
    const aliasEntry: Record<string, unknown> = a.m; // same module object
    const ctx = makeCtx([a.m]);
    ctx.commands.set('p', aliasEntry);
    const { allowedNames } = await buildCommandCatalog(ctx);
    expect(allowedNames.filter((n) => n === 'ping')).toHaveLength(1);
  });

  it('respects platform restrictions', async () => {
    const ctx = makeCtx([mod('both').m, mod('donly', { platform: ['discord'] }).m]);
    const { allowedNames } = await buildCommandCatalog(ctx);
    expect(allowedNames).toContain('both');
    expect(allowedNames).not.toContain('donly');
  });

  it('respects dashboard disabled toggles', async () => {
    dbStubs.findSessionCommands.mockResolvedValue([
      { commandName: 'ping', isEnable: false },
    ]);
    const ctx = makeCtx([mod('ping').m, mod('pong').m]);
    const { allowedNames } = await buildCommandCatalog(ctx);
    expect(allowedNames).not.toContain('ping');
    expect(allowedNames).toContain('pong');
  });

  it('hides role-gated commands above the user ceiling', async () => {
    const ctx = makeCtx([
      mod('open').m,
      mod('locked', { role: Role.BOT_ADMIN }).m,
    ]);
    const { allowedNames } = await buildCommandCatalog(ctx);
    expect(allowedNames).toContain('open');
    expect(allowedNames).not.toContain('locked');
  });

  it('reveals admin commands to bot admins', async () => {
    dbStubs.listBotAdmins.mockResolvedValue(['user1']);
    const ctx = makeCtx([mod('locked', { role: Role.BOT_ADMIN }).m]);
    const { allowedNames } = await buildCommandCatalog(ctx);
    expect(allowedNames).toContain('locked');
  });

  it('never lists shell/eval-class commands, even for system admins', async () => {
    dbStubs.listSystemAdmins.mockResolvedValue([{ adminId: 'user1' }]);
    const ctx = makeCtx([
      mod('shell', { role: Role.SYSTEM_ADMIN }).m,
      mod('ping').m,
    ]);
    const { allowedNames } = await buildCommandCatalog(ctx);
    expect(allowedNames).not.toContain('shell');
    expect(allowedNames).toContain('ping');
  });

  it('groups by category with deterministic ordering', async () => {
    const ctx = makeCtx([
      mod('zebra', { category: 'Zoo' }).m,
      mod('alpha', { category: 'Zoo' }).m,
      mod('mid', { category: 'Alpha' }).m,
    ]);
    const { groupedList, allowedNames } = await buildCommandCatalog(ctx);
    expect(allowedNames).toEqual(['alpha', 'mid', 'zebra']);
    const lines = groupedList.split('\n');
    expect(lines[0]?.startsWith('Alpha:')).toBe(true);
    expect(lines[1]).toBe('Zoo: alpha, zebra');
  });
});
