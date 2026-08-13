import { describe, it, expect, vi } from 'vitest';

vi.mock('@/engine/repos/threads.repo.js', () => ({
  threadExists: vi.fn(),
  getThreadName: vi.fn(),
  getAllGroupThreadIds: vi.fn(),
  getDiscordServerIdByChannel: vi.fn(),
}));

import { run } from '@/engine/agent/tools/group_info.js';
import {
  threadExists,
  getThreadName,
  getAllGroupThreadIds,
  getDiscordServerIdByChannel,
} from '@/engine/repos/threads.repo.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

const LIVE_GROUP = {
  platform: 'telegram',
  threadID: '-100123',
  name: 'My Group',
  isGroup: true,
  memberCount: 342,
  participantIDs: ['1', '2', '3'],
  adminIDs: ['1', '9'],
  avatarUrl: null,
};

/** Adds a fake ctx.thread.getInfo (live platform data) to the context. */
function withLiveThread(
  ctx: AppCtx,
  info: Record<string, unknown> | Error | null,
): AppCtx {
  const getInfo = vi.fn().mockImplementation(() => {
    if (info === null) return Promise.reject(new Error('api down'));
    return info instanceof Error
      ? Promise.reject(info)
      : Promise.resolve(info);
  });
  (ctx as unknown as Record<string, unknown>)['thread'] = { getInfo };
  return ctx;
}

function makeCtx(platform = 'telegram', threadID = 't1'): AppCtx {
  return {
    event: { senderID: 'u1', threadID, messageID: 'm1' },
    native: { userId: 'owner', sessionId: 's1', platform },
    commands: new Map(),
    prefix: '+',
  } as unknown as AppCtx;
}

describe('get_group tool: provided gid', () => {
  it('errors when no gid is provided and no current thread exists', async () => {
    const ctx = makeCtx();
    ctx.event = {};
    const out = await run({}, ctx);
    expect(out).toContain('No gid provided');
  });

  it('reports when the chat is unknown', async () => {
    vi.mocked(threadExists).mockResolvedValueOnce(false);
    const out = await run({ gid: '-100123' }, makeCtx());
    expect(out).toBe('No chat found with thread id: -100123');
  });

  it('returns LIVE member/admin counts for a provided gid', async () => {
    vi.mocked(threadExists).mockResolvedValueOnce(true);
    const ctx = withLiveThread(makeCtx(), LIVE_GROUP);

    const out = await run({ gid: '-100123' }, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['name']).toBe('My Group');
    expect(parsed['isGroup']).toBe(true);
    expect(parsed['memberCount']).toBe(342);
    expect(parsed['participantCount']).toBe(3);
    expect(parsed['adminCount']).toBe(2);
    expect(parsed['source']).toBe('provided');
    expect(parsed['infoSource']).toBe('live');
  });
});

describe('get_group tool: auto-detection', () => {
  it('uses the current thread ID when gid is omitted', async () => {
    vi.mocked(threadExists).mockResolvedValueOnce(true);
    const ctx = withLiveThread(makeCtx('telegram', 't1'), {
      ...LIVE_GROUP,
      threadID: 't1',
      name: 'Current Chat',
    });

    const out = await run({}, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['gid']).toBe('t1');
    expect(parsed['name']).toBe('Current Chat');
    expect(parsed['source']).toBe('current-thread');
    expect(parsed['memberCount']).toBe(342);
  });

  it('treats an explicit null gid exactly like an omitted one (Groq null quirk)', async () => {
    vi.mocked(threadExists).mockResolvedValueOnce(true);
    const ctx = withLiveThread(makeCtx('telegram', 't1'), {
      ...LIVE_GROUP,
      threadID: 't1',
    });

    const out = await run(
      { gid: null } as unknown as { gid?: string },
      ctx,
    );
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['gid']).toBe('t1');
    expect(parsed['source']).toBe('current-thread');
  });

  it('resolves a Discord channel to its server for the current chat', async () => {
    vi.mocked(getDiscordServerIdByChannel).mockResolvedValueOnce('srv-9');
    vi.mocked(threadExists).mockResolvedValueOnce(true);
    const ctx = withLiveThread(makeCtx('discord', 'chan-123'), {
      ...LIVE_GROUP,
      threadID: 'srv-9',
      name: 'Server Name',
    });

    const out = await run({}, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(getDiscordServerIdByChannel).toHaveBeenCalledWith('chan-123');
    expect(parsed['gid']).toBe('srv-9');
    expect(parsed['name']).toBe('Server Name');
    expect(parsed['source']).toBe('current-thread');
  });

  it('explains when the auto-detected chat is not a tracked group', async () => {
    vi.mocked(getDiscordServerIdByChannel).mockResolvedValueOnce(null);
    vi.mocked(threadExists).mockResolvedValueOnce(false);
    const out = await run({}, makeCtx());
    expect(out).toContain('not a tracked group');
  });
});

describe('get_group tool: stored fallback', () => {
  it('uses stored fields when the live fetch is unavailable', async () => {
    vi.mocked(threadExists).mockResolvedValueOnce(true);
    vi.mocked(getThreadName).mockResolvedValueOnce('Stored Group Name');
    vi.mocked(getAllGroupThreadIds).mockResolvedValueOnce(['-100123', 't9']);
    const ctx = withLiveThread(makeCtx(), null); // live rejects

    const out = await run({ gid: '-100123' }, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['name']).toBe('Stored Group Name');
    expect(parsed['isGroup']).toBe(true);
    expect(parsed['memberCount']).toBe(null);
    expect(parsed['infoSource']).toBe('stored');
  });

  it('never throws — returns an error string on DB failure', async () => {
    vi.mocked(getDiscordServerIdByChannel).mockResolvedValueOnce(null);
    vi.mocked(threadExists).mockRejectedValueOnce(new Error('db down'));
    const out = await run({ gid: '-100123' }, makeCtx());
    expect(out).toContain('Group lookup error');
    expect(out).toContain('db down');
  });
});
