import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/engine/services/threads.service.js', () => ({
  syncThreadAndParticipants: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/engine/services/users.service.js', () => ({
  syncUser: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/engine/repos/threads.repo.js', () => ({
  getThreadSessionUpdatedAt: vi.fn(),
  upsertThreadSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/engine/repos/users.repo.js', () => ({
  getUserSessionUpdatedAt: vi.fn(),
  upsertUserSession: vi.fn().mockResolvedValue(undefined),
}));

import { chatPassthrough } from '@/engine/middleware/on-chat.middleware.js';
import {
  syncThreadAndParticipants,
} from '@/engine/services/threads.service.js';
import { syncUser } from '@/engine/services/users.service.js';
import {
  getThreadSessionUpdatedAt,
  upsertThreadSession,
} from '@/engine/repos/threads.repo.js';
import {
  getUserSessionUpdatedAt,
  upsertUserSession,
} from '@/engine/repos/users.repo.js';

const typed = <T>(v: unknown) => v as T;

function makeCtx(event: Record<string, unknown>) {
  return typed<import('@/engine/types/middleware.types.js').OnChatCtx>({
    native: {
      platform: 'telegram',
      userId: 'owner-1',
      sessionId: 'session-1',
    },
    event,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
}

describe('on-chat.middleware: DM sender sync', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getThreadSessionUpdatedAt.mockResolvedValue(null);
    getUserSessionUpdatedAt.mockResolvedValue(null);
  });

  it('syncs the sender for a Telegram DM (isGroup=false) but skips thread sync', async () => {
    const ctx = makeCtx({
      type: 'message',
      threadID: '12345',
      senderID: 'brand-new-user',
      isGroup: false,
    });

    await chatPassthrough(ctx, vi.fn());

    // Thread sync must be skipped for known DMs
    expect(syncThreadAndParticipants).not.toHaveBeenCalled();
    expect(upsertThreadSession).not.toHaveBeenCalled();

    // Sender must still be persisted to bot_users
    expect(syncUser).toHaveBeenCalledWith(
      ctx,
      'brand-new-user',
      'owner-1',
      'session-1',
    );
  });

  it('still syncs thread AND sender for a Telegram group (isGroup=true)', async () => {
    getThreadSessionUpdatedAt.mockResolvedValue(null);
    const ctx = makeCtx({
      type: 'message',
      threadID: '67890',
      senderID: 'group-member',
      isGroup: true,
    });

    await chatPassthrough(ctx, vi.fn());

    expect(syncThreadAndParticipants).toHaveBeenCalledWith(
      ctx,
      '67890',
      'owner-1',
      'session-1',
    );
    expect(syncUser).toHaveBeenCalledWith(
      ctx,
      'group-member',
      'owner-1',
      'session-1',
    );
  });

  it('skips sender sync when senderUpdatedAt is fresh (within SYNC_INTERVAL)', async () => {
    getUserSessionUpdatedAt.mockResolvedValue(new Date());
    const ctx = makeCtx({
      type: 'message',
      threadID: '12345',
      senderID: 'brand-new-user',
      isGroup: false,
    });

    await chatPassthrough(ctx, vi.fn());

    expect(syncUser).not.toHaveBeenCalled();
  });

  it('optimistically stamps an existing user session and re-syncs a stale sender', async () => {
    const stale = new Date(Date.now() - 2 * 60 * 60 * 1000);
    getUserSessionUpdatedAt.mockResolvedValue(stale);
    const ctx = makeCtx({
      type: 'message',
      threadID: '12345',
      senderID: 'existing-user',
      isGroup: false,
    });

    await chatPassthrough(ctx, vi.fn());

    expect(upsertUserSession).toHaveBeenCalledWith(
      'owner-1',
      'telegram',
      'session-1',
      'existing-user',
    );
    expect(syncUser).toHaveBeenCalledWith(
      ctx,
      'existing-user',
      'owner-1',
      'session-1',
    );
  });
});
