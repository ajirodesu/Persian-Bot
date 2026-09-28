import { beforeEach, describe, expect, it, vi } from 'vitest';
import './mock-database.js';
import { resetDbStubs } from './mock-database.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import { Role } from '@/engine/constants/role.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

vi.mock('../lib/needle-client.lib.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../lib/needle-client.lib.js')>();
  return {
    ...actual,
    completeTurn: vi.fn(),
    resetSession: vi.fn(async () => undefined),
  };
});

import { completeTurn } from '../lib/needle-client.lib.js';
import { __clearToolCacheForTests, runAgent } from '../agent.js';

function mockedCompleteTurn() {
  return vi.mocked(completeTurn);
}

interface CapturedReply {
  threadID: string;
  options: Record<string, unknown>;
}

function makeCtx(replies: CapturedReply[]): AppCtx {
  const ping = {
    meta: {
      name: 'ping',
      description: 'Check if bot is alive',
      category: 'info',
      usage: '',
      role: Role.ANYONE,
      cooldown: 0,
      hasPrefix: true,
    },
    onCommand: async (c: AppCtx) => {
      await c.chat.replyMessage({ message: 'pong' });
    },
  };
  const commands = new Map<string, Record<string, unknown>>();
  commands.set('ping', ping as unknown as Record<string, unknown>);

  const api = {
    platform: 'fluxer',
    async replyMessage(threadID: string, options: Record<string, unknown>) {
      replies.push({ threadID, options });
      return 'real-msg-id';
    },
    async sendTypingIndicator() {
      return undefined;
    },
    async reactToMessage() {
      return undefined;
    },
    async editMessage() {
      return undefined;
    },
    async sendMessage() {
      return undefined;
    },
  };

  return {
    event: { senderID: 'user1', threadID: 'thread1', messageID: 'msg1' },
    commands,
    prefix: '/',
    native: { platform: 'fluxer', userId: 'owner1', sessionId: 'sess1' },
    api,
    chat: {
      async replyMessage(options: Record<string, unknown>) {
        return (api as { replyMessage: (t: string, o: unknown) => unknown }).replyMessage(
          'thread1',
          options,
        );
      },
    },
    user: { getName: async () => 'User' },
    db: {},
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
  } as unknown as AppCtx;
}

function turn(
  calls: Array<{ name: string; arguments: Record<string, unknown> }>,
  confidence = 0.95,
) {
  return {
    type: 'call',
    success: true,
    error: null,
    errorCode: null,
    functionCalls: calls.map((c) => ({
      name: c.name,
      arguments: c.arguments,
    })),
    reasoning: 'test',
    confidence,
    suppressedCalls: null,
    validation: null,
  };
}

describe('agent loop (Needle-driven, locally executed tools)', () => {
  beforeEach(() => {
    lruCache.clear();
    vi.clearAllMocks();
    resetDbStubs();
    __clearToolCacheForTests();
    process.env['NEEDLE_ENABLED'] = 'true';
    process.env['NEEDLE_URL'] = 'https://needle.example';
    process.env['NEEDLE_AUTH_TOKEN'] = 'tok';
  });

  it('runs help → test_command → send_result and delivers once', async () => {
    const replies: CapturedReply[] = [];
    const ctx = makeCtx(replies);

    mockedCompleteTurn()
      .mockResolvedValueOnce(
        turn([{ name: 'help', arguments: { query: 'ping' } }]),
      )
      .mockResolvedValueOnce(
        turn([
          {
            name: 'test_command',
            arguments: { commands: [{ command: 'ping', args: [] }] },
          },
        ]),
      )
      .mockResolvedValueOnce(
        turn([{ name: 'send_result', arguments: { message: 'Pong!' } }]),
      );

    const result = await runAgent('is the bot alive?', ctx, 'Persian-Bot', 'User');

    // send_result delivered → suppressed duplicate return.
    expect(result).toBe('');
    expect(mockedCompleteTurn()).toHaveBeenCalledTimes(3);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.options['message']).toBe('Pong!');
  });

  it('answers conversation directly through send_result', async () => {
    const replies: CapturedReply[] = [];
    const ctx = makeCtx(replies);
    mockedCompleteTurn().mockResolvedValueOnce(
      turn([{ name: 'send_result', arguments: { message: 'Hello there!' } }]),
    );
    const result = await runAgent('hello', ctx);
    expect(result).toBe('');
    expect(replies).toHaveLength(1);
  });

  it('treats empty function_calls as refusal without inventing actions', async () => {
    const replies: CapturedReply[] = [];
    const ctx = makeCtx(replies);
    mockedCompleteTurn().mockResolvedValueOnce({
      type: 'respond',
      success: true,
      error: null,
      errorCode: null,
      functionCalls: [],
      reasoning: null,
      confidence: null,
      suppressedCalls: null,
      validation: null,
    });
    const result = await runAgent('do something impossible', ctx);
    expect(result).toContain("can't help");
    expect(replies).toHaveLength(0);
    expect(mockedCompleteTurn()).toHaveBeenCalledTimes(1);
  });

  it('suppresses low-confidence tool calls (never executes them)', async () => {
    const replies: CapturedReply[] = [];
    const ctx = makeCtx(replies);
    mockedCompleteTurn()
      .mockResolvedValueOnce(
        turn(
          [
            {
              name: 'test_command',
              arguments: { commands: [{ command: 'ping', args: [] }] },
            },
          ],
          0.1, // below default 0.7 threshold
        ),
      )
      .mockResolvedValueOnce(
        turn([{ name: 'send_result', arguments: { message: 'Need clarification.' } }]),
      );
    const result = await runAgent('ping?', ctx);
    expect(result).toBe('');
    expect(replies).toHaveLength(1);
    expect(replies[0]?.options['message']).toBe('Need clarification.');
  });

  it('reports unknown tools back instead of crashing', async () => {
    const replies: CapturedReply[] = [];
    const ctx = makeCtx(replies);
    mockedCompleteTurn()
      .mockResolvedValueOnce(
        turn([{ name: 'shell', arguments: { cmd: 'rm -rf /' } }]),
      )
      .mockResolvedValueOnce(
        turn([{ name: 'send_result', arguments: { message: 'Denied.' } }]),
      );
    const result = await runAgent('hack', ctx);
    expect(result).toBe('');
    expect(replies).toHaveLength(1);
  });

  it('degrades gracefully when Needle is unreachable', async () => {
    const replies: CapturedReply[] = [];
    const ctx = makeCtx(replies);
    const { NeedleClientError } = await import('../lib/needle-client.lib.js');
    mockedCompleteTurn().mockRejectedValueOnce(
      new NeedleClientError('UNAVAILABLE', 'down'),
    );
    const result = await runAgent('hi', ctx);
    expect(result).toContain('temporarily unavailable');
    expect(replies).toHaveLength(0);
  });
});
