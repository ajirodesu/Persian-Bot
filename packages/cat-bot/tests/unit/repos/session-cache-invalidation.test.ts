import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

vi.mock('database', () => ({
  upsertUser: vi.fn(),
  userExists: vi.fn(),
  userSessionExists: vi.fn(),
  upsertUserSession: vi.fn(),
  getUserName: vi.fn(),
  getUserAvatar: vi.fn(),
  updateUserAvatar: vi.fn(),
  getUserSessionData: vi.fn(),
  setUserSessionData: vi.fn(),
  getAllUserSessionData: vi.fn(),
  getUserSessionUpdatedAt: vi.fn(),
  deleteThread: vi.fn(),
  deleteDiscordServer: vi.fn(),
  upsertThread: vi.fn(),
  threadExists: vi.fn(),
  threadSessionExists: vi.fn(),
  upsertThreadSession: vi.fn(),
  isThreadAdmin: vi.fn(),
  getThreadName: vi.fn(),
  getThreadSessionData: vi.fn(),
  setThreadSessionData: vi.fn(),
  getAllGroupThreadIds: vi.fn(),
  getThreadSessionUpdatedAt: vi.fn(),
  upsertDiscordServer: vi.fn(),
  linkDiscordChannel: vi.fn(),
  getDiscordServerIdByChannel: vi.fn(),
  upsertDiscordServerSession: vi.fn(),
  getDiscordServerSessionUpdatedAt: vi.fn(),
  getDiscordServerSessionData: vi.fn(),
  setDiscordServerSessionData: vi.fn(),
  isDiscordServerAdmin: vi.fn(),
  getDiscordServerName: vi.fn(),
  getAllDiscordServerIds: vi.fn(),
  discordServerExists: vi.fn(),
  discordServerSessionExists: vi.fn(),
}));

import {
  invalidateUserSessionCache,
  getUserSessionUpdatedAt,
} from '@/engine/repos/users.repo.js';
import {
  invalidateThreadSessionCache,
  getThreadSessionUpdatedAt,
} from '@/engine/repos/threads.repo.js';

describe('users.repo.invalidateUserSessionCache', () => {
  beforeEach(() => {
    lruCache.clear();
  });

  it('evicts the stale updatedAt entry so the next read refetches from the DB', async () => {
    // Simulate a user whose session row was deleted from the dashboard while the
    // LRU cache still holds the pre-delete timestamp.
    await getUserSessionUpdatedAt('owner-1', 'telegram', 'session-1', 'user-1');
    lruCache.set(
      'owner-1:telegram:session-1:user:sessionUpdatedAt:user-1',
      new Date(),
    );

    invalidateUserSessionCache('owner-1', 'telegram', 'session-1', 'user-1');

    expect(
      lruCache.get('owner-1:telegram:session-1:user:sessionUpdatedAt:user-1'),
    ).toBeUndefined();
    expect(
      lruCache.get('owner-1:telegram:session-1:user:sessionExists:user-1'),
    ).toBeUndefined();
  });
});

describe('threads.repo.invalidateThreadSessionCache', () => {
  beforeEach(() => {
    lruCache.clear();
  });

  it('evicts the stale updatedAt and groups-list entries for a deleted group session', async () => {
    await getThreadSessionUpdatedAt('owner-1', 'telegram', 'session-1', 't-1');
    lruCache.set(
      'owner-1:telegram:session-1:thread:sessionUpdatedAt:t-1',
      new Date(),
    );
    lruCache.set('owner-1:telegram:session-1:thread:groups', ['t-1']);

    invalidateThreadSessionCache('owner-1', 'telegram', 'session-1', 't-1');

    expect(
      lruCache.get('owner-1:telegram:session-1:thread:sessionUpdatedAt:t-1'),
    ).toBeUndefined();
    expect(
      lruCache.get('owner-1:telegram:session-1:thread:sessionExists:t-1'),
    ).toBeUndefined();
    expect(
      lruCache.get('owner-1:telegram:session-1:thread:groups'),
    ).toBeUndefined();
  });
});
