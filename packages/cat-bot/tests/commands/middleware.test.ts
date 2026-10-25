/**
 * Middleware fast paths.
 *
 * The hot-path guards now return synchronously for the common case. These
 * tests pin the two behaviours that makes safe: a guard that calls next()
 * without returning still waits for the rest of the chain, and the no-op
 * guards genuinely delegate without doing extra work.
 */
import { describe, expect, it, vi } from 'vitest';
import { runMiddlewareChain } from '@/engine/lib/middleware.lib.js';
import {
  enforceCooldown,
  enforcePermission,
  validateCommandOptions,
} from '@/engine/middleware/on-command.middleware.js';
import type { MiddlewareFn } from '@/engine/types/middleware.types.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import type { OnCommandCtx } from '@/engine/types/middleware.types.js';

function ctx(overrides: Record<string, unknown> = {}): OnCommandCtx {
  return {
    mod: { meta: { name: 'ping', role: 0, cooldown: 0 } },
    parsed: { name: 'ping', args: [] },
    event: {
      senderID: `sender-${Math.random()}`,
      threadID: 'thread-1',
      message: '/ping',
    },
    native: { platform: 'discord', userId: 'owner', sessionId: 'session' },
    chat: {
      replyMessage: vi.fn(async () => 'm'),
      editMessage: vi.fn(async () => undefined),
    },
    options: OptionsMap.empty(),
    db: {},
    ...overrides,
  } as unknown as OnCommandCtx;
}

describe('runMiddlewareChain', () => {
  it('waits for next() even when a sync middleware does not return it', async () => {
    const order: string[] = [];
    const first: MiddlewareFn<Record<string, never>> = (_c, next) => {
      order.push('first');
      void next();
    };
    const second: MiddlewareFn<Record<string, never>> = async (_c, next) => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('second');
      await next();
    };

    await runMiddlewareChain([first, second], {}, async () => {
      order.push('handler');
    });

    expect(order).toEqual(['first', 'second', 'handler']);
  });

  it('honours a middleware that short-circuits without next()', async () => {
    const handler = vi.fn(async () => undefined);
    const block: MiddlewareFn<Record<string, never>> = () => undefined;
    await runMiddlewareChain([block], {}, handler);
    expect(handler).not.toHaveBeenCalled();
  });
});

describe('hot-path guards', () => {
  it('enforcePermission delegates immediately for ANYONE commands', async () => {
    const next = vi.fn(async () => undefined);
    await enforcePermission(ctx(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('enforcePermission blocks without calling next for a SYSTEM_ADMIN command', async () => {
    const next = vi.fn(async () => undefined);
    const c = ctx({
      mod: { meta: { name: 'secret', role: 4 } },
    });
    // No system-admin cache in this unit context: the guard must fail closed
    // for a normal sender and reply instead of delegating.
    await enforcePermission(c, next);
    expect(next).not.toHaveBeenCalled();
    expect(c.chat.replyMessage).toHaveBeenCalled();
  });

  it('validateCommandOptions assigns the shared empty map for no-option commands', async () => {
    const c = ctx();
    const next = vi.fn(async () => undefined);
    await validateCommandOptions(c, next);
    expect(c.options).toBe(OptionsMap.empty());
    expect(next).toHaveBeenCalledTimes(1);
  });

  it('enforceCooldown allows once, then blocks the immediate retry', async () => {
    const next = vi.fn(async () => undefined);
    const c = ctx({
      mod: { meta: { name: `cooldown-${Math.random()}`, role: 0, cooldown: 5 } },
    });
    await enforceCooldown(c, next);
    expect(next).toHaveBeenCalledTimes(1);

    await enforceCooldown(c, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(c.chat.replyMessage).toHaveBeenCalled();
  });
});
