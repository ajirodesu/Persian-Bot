import { describe, it, expect, vi } from 'vitest';

vi.mock('@/engine/repos/users.repo.js', () => ({
  getUserById: vi.fn(),
  getUserByUsername: vi.fn(),
}));

import { run } from '@/engine/agent/tools/user_info.js';
import {
  getUserById,
  getUserByUsername,
} from '@/engine/repos/users.repo.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import type { StoredUserProfile } from '@/engine/models/users.model.js';

const ALICE_STORED: StoredUserProfile = {
  id: '123456789',
  name: 'Alice',
  firstName: 'Alice',
  username: 'alice_wonder',
  avatarUrl: 'https://cdn.example/alice.jpg',
};

const ALICE_LIVE = {
  platform: 'telegram',
  id: '123456789',
  name: 'Alice Wonder',
  firstName: 'Alice',
  username: 'alice_wonder',
  avatarUrl: 'https://cdn.example/live-alice.jpg',
};

/** Adds a fake ctx.user.getInfo (live platform data) to the context. */
function withLiveUser(
  ctx: AppCtx,
  info: Record<string, unknown> | Error,
): AppCtx {
  // Echo the requested uid into the result — a real getFullUserInfo returns
  // the profile OF the id asked for, never a fixed one.
  const getInfo = vi.fn().mockImplementation((uid: string) =>
    info instanceof Error
      ? Promise.reject(info)
      : Promise.resolve({ ...info, id: uid }),
  );
  (ctx as unknown as Record<string, unknown>)['user'] = { getInfo };
  return ctx;
}

function makeCtx(overrides: Partial<Record<string, unknown>> = {}): AppCtx {
  return {
    event: { senderID: 'u1', threadID: 't1', messageID: 'm1' },
    native: { userId: 'owner', sessionId: 's1', platform: 'telegram' },
    commands: new Map(),
    prefix: '+',
    ...overrides,
  } as unknown as AppCtx;
}

describe('get_user tool: explicit username lookup', () => {
  it('returns LIVE info of the named user', async () => {
    vi.mocked(getUserByUsername).mockResolvedValueOnce(ALICE_STORED);
    const ctx = withLiveUser(makeCtx(), ALICE_LIVE);

    const out = await run({ username: '@alice_wonder' }, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(getUserByUsername).toHaveBeenCalledWith('telegram', 'alice_wonder');
    expect(parsed['uid']).toBe('123456789');
    expect(parsed['name']).toBe('Alice Wonder');
    expect(parsed['source']).toBe('live');
    expect(parsed['lookupBy']).toBe('username');
  });

  it('reports when the username is unknown on this platform', async () => {
    vi.mocked(getUserByUsername).mockResolvedValueOnce(null);
    const out = await run({ username: 'nobody' }, makeCtx());
    expect(out).toContain('No user found with username: @nobody');
  });
});

describe('get_user tool: explicit uid lookup', () => {
  it('returns LIVE info of the user id', async () => {
    const ctx = withLiveUser(makeCtx(), ALICE_LIVE);
    const out = await run({ uid: '123456789' }, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['uid']).toBe('123456789');
    expect(parsed['name']).toBe('Alice Wonder');
    expect(parsed['source']).toBe('live');
    expect(parsed['lookupBy']).toBe('uid');
  });

  it('falls back to the stored profile when the live fetch is a stub', async () => {
    vi.mocked(getUserById).mockResolvedValueOnce(ALICE_STORED);
    // Live wrapper returns the platform "User {id}" stub — must not be used.
    const ctx = withLiveUser(makeCtx(), {
      platform: 'telegram',
      id: '123456789',
      name: 'User 123456789',
      firstName: null,
      username: null,
      avatarUrl: null,
    });
    const out = await run({ uid: '123456789' }, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['name']).toBe('Alice');
    expect(parsed['source']).toBe('stored');
  });

  it('falls back to the stored profile when the live fetch throws', async () => {
    vi.mocked(getUserById).mockResolvedValueOnce(ALICE_STORED);
    const ctx = withLiveUser(makeCtx(), new Error('api down'));
    const out = await run({ uid: '123456789' }, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['name']).toBe('Alice');
    expect(parsed['source']).toBe('stored');
  });

  it('reports when the uid is unknown both live and stored', async () => {
    vi.mocked(getUserById).mockResolvedValueOnce(null);
    const ctx = withLiveUser(makeCtx(), {
      platform: 'telegram',
      id: '999',
      name: 'User 999',
      firstName: null,
      username: null,
      avatarUrl: null,
    });
    const out = await run({ uid: '999' }, ctx);
    expect(out).toContain('No user found with id: 999');
  });
});

describe('get_user tool: mentioned user resolution', () => {
  it('returns the MENTIONED user (numeric id), not the requester', async () => {
    // u1 asks about 123456789 — the tool must resolve the mention, not u1.
    const ctx = withLiveUser(makeCtx(), ALICE_LIVE);
    ctx.event['mentions'] = { '123456789': '@alice_wonder' };

    const out = await run({}, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['lookupBy']).toBe('mention');
    expect(parsed['uid']).toBe('123456789');
    expect(parsed['mention']).toBe('@alice_wonder');
    expect(parsed['name']).toBe('Alice Wonder');
  });

  it('resolves an @handle mention via username lookup', async () => {
    vi.mocked(getUserByUsername).mockResolvedValueOnce(ALICE_STORED);
    const ctx = withLiveUser(makeCtx(), ALICE_LIVE);
    ctx.event['mentions'] = { '@alice_wonder': '@alice_wonder' };

    const out = await run({}, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(getUserByUsername).toHaveBeenCalledWith('telegram', 'alice_wonder');
    expect(parsed['lookupBy']).toBe('mention');
    expect(parsed['uid']).toBe('123456789');
  });

  it('excludes the bot itself from mention resolution', async () => {
    const ctx = withLiveUser(makeCtx(), ALICE_LIVE);
    ctx.event['mentions'] = { '999': '@my_bot', '123456789': '@alice_wonder' };
    (ctx as unknown as Record<string, unknown>)['bot'] = {
      getID: vi.fn().mockResolvedValue('999'),
    };

    const out = await run({}, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['lookupBy']).toBe('mention');
    expect(parsed['uid']).toBe('123456789');
  });

  it('falls back to the current sender when nothing was mentioned', async () => {
    const ctx = withLiveUser(makeCtx(), {
      ...ALICE_LIVE,
      id: 'u1',
      name: 'Requester',
    });
    const out = await run({}, ctx);
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['lookupBy']).toBe('current-sender');
    expect(parsed['uid']).toBe('u1');
    expect(parsed['name']).toBe('Requester');
  });
});

describe('get_user tool: edge cases', () => {
  it('treats explicit null args exactly like omitted ones (Groq null quirk)', async () => {
    const ctx = withLiveUser(makeCtx(), ALICE_LIVE);
    ctx.event['mentions'] = { '123456789': '@alice_wonder' };
    const out = await run(
      { uid: null, username: null } as unknown as {
        uid?: string;
        username?: string;
      },
      ctx,
    );
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed['lookupBy']).toBe('mention');
    expect(parsed['uid']).toBe('123456789');
  });

  it('errors when there is no identifier, no mention, and no sender', async () => {
    const ctx = makeCtx();
    ctx.event = { threadID: 't1' };
    const out = await run({}, ctx);
    expect(out).toContain('No user id or username provided');
  });

  it('never throws — returns an error string on DB failure', async () => {
    vi.mocked(getUserById).mockRejectedValueOnce(new Error('db down'));
    const out = await run({ uid: '123456789' }, makeCtx());
    expect(out).toContain('User lookup error');
    expect(out).toContain('db down');
  });
});
