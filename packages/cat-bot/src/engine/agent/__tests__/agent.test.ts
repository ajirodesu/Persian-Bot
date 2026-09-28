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
  // Unique sender/message per context so the shared in-memory AI rate
  // limiter never bleeds cadence state across test cases.
  const n = (makeCtx as { seq?: number }).seq = ((makeCtx as { seq?: number }).seq ?? 0) + 1;
  const sender = `user${n}`;
  const msgId = `msg${n}`;
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
    event: { senderID: sender, threadID: 'thread1', messageID: msgId },
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
    turn: {
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
    },
    latencyMs: 5,
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
    process.env['NEEDLE_API_KEY'] = 'tok';
    delete process.env['NEEDLE_AUTH_TOKEN'];
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
      turn: {
        type: 'respond',
        success: true,
        error: null,
        errorCode: null,
        functionCalls: [],
        reasoning: null,
        confidence: null,
        suppressedCalls: null,
        validation: null,
      },
      latencyMs: 5,
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
      new NeedleClientError('SERVICE_UNAVAILABLE', 'down'),
    );
    const result = await runAgent('hi', ctx);
    expect(result).toContain('currently unavailable');
    expect(replies).toHaveLength(0);
  });

  it('maps auth failure to a configuration message and timeout distinctly', async () => {
    const replies: CapturedReply[] = [];
    const ctx = makeCtx(replies);
    const { NeedleClientError } = await import('../lib/needle-client.lib.js');
    mockedCompleteTurn().mockRejectedValueOnce(
      new NeedleClientError('UNAUTHORIZED', 'bad key'),
    );
    expect(await runAgent('hi', ctx)).toContain('not configured correctly');

    mockedCompleteTurn().mockRejectedValueOnce(
      new NeedleClientError('TIMEOUT', 'slow'),
    );
    expect(await runAgent('hi', ctx)).toContain('timed out');
    expect(replies).toHaveLength(0);
  });

  it('denies restricted tools for unauthorized users (executor never runs)', async () => {
    const replies: CapturedReply[] = [];
    const ctx = makeCtx(replies);
    let executed = false;
    ctx.commands.set('restart', {
      meta: {
        name: 'restart',
        description: 'Restart the bot',
        category: 'admin',
        usage: '',
        role: Role.SYSTEM_ADMIN,
        cooldown: 0,
        hasPrefix: true,
      },
      onCommand: async () => {
        executed = true;
      },
    } as unknown as Record<string, unknown>);

    mockedCompleteTurn()
      .mockResolvedValueOnce(
        turn([
          {
            name: 'test_command',
            arguments: { commands: [{ command: 'restart', args: [] }] },
          },
        ]),
      )
      .mockResolvedValueOnce(
        turn([{ name: 'send_result', arguments: { message: 'Blocked: admins only.' } }]),
      );
    const result = await runAgent('restart the bot', ctx);
    expect(result).toBe('');
    expect(executed).toBe(false);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.options['message']).toBe('Blocked: admins only.');
  });

  it('rejects malformed tool arguments without executing anything', async () => {
    const replies: CapturedReply[] = [];
    const ctx = makeCtx(replies);
    let executed = false;
    const ping = ctx.commands.get('ping') as Record<string, unknown>;
    const orig = ping['onCommand'];
    ping['onCommand'] = async (...args: unknown[]) => {
      executed = true;
      return (orig as (...a: unknown[]) => unknown)(...args);
    };

    mockedCompleteTurn()
      .mockResolvedValueOnce(
        turn([{ name: 'test_command', arguments: { bogus: 'hello' } }]),
      )
      .mockResolvedValueOnce(
        turn([{ name: 'send_result', arguments: { message: 'Understood.' } }]),
      );
    const result = await runAgent('ping?', ctx);
    expect(result).toBe('');
    expect(executed).toBe(false);
    expect(replies).toHaveLength(1);
  });

  it('executes multiple function calls through validation in order', async () => {
    const replies: CapturedReply[] = [];
    const ctx = makeCtx(replies);
    const order: string[] = [];
    const origPing = (ctx.commands.get('ping') as Record<string, unknown>)['onCommand'];
    (ctx.commands.get('ping') as Record<string, unknown>)['onCommand'] = async (
      c: AppCtx,
    ) => {
      order.push((c.event['message'] as string) ?? 'ping');
      return (origPing as (c: AppCtx) => unknown)(c);
    };

    mockedCompleteTurn()
      .mockResolvedValueOnce(
        turn([
          { name: 'help', arguments: { query: 'ping' } },
          {
            name: 'test_command',
            arguments: { commands: [{ command: 'ping', args: [] }] },
          },
        ]),
      )
      .mockResolvedValueOnce(
        turn([{ name: 'send_result', arguments: { message: 'Pong!' } }]),
      );
    const result = await runAgent('ping twice', ctx);
    expect(result).toBe('');
    expect(order).toHaveLength(1);
    expect(replies).toHaveLength(1);
    expect(replies[0]?.options['message']).toBe('Pong!');
  });
});
