import { describe, it, expect, vi } from 'vitest';
import { dispatchEvent } from '@/engine/controllers/dispatchers/event.dispatcher.js';

describe('Event Dispatcher', () => {
  it('should route events to registered handlers for matching event type', async () => {
    // WHY: Validates the central pub/sub mechanism for thread events (joins/leaves)
    const mockHandler = vi.fn();
    const eventModules = new Map([
      ['log:subscribe', [{ meta: { name: 'join' }, onEvent: mockHandler }]],
    ]);

    const ctx = {
      native: { platform: 'discord' },
      event: {},
    } as unknown as Parameters<typeof dispatchEvent>[2];

    await dispatchEvent(eventModules, 'log:subscribe', ctx);

    expect(mockHandler).toHaveBeenCalledOnce();
    // The dispatcher enriches the context with the matched module and event type
    expect(mockHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        ...ctx,
        mod: { meta: { name: 'join' }, onEvent: mockHandler },
        eventType: 'log:subscribe',
      }),
    );
  });

  it('should safely ignore event types with no registered handlers', async () => {
    // WHY: System shouldn't crash if a platform emits an administrative event we don't care about
    const eventModules = new Map();

    // No throw
    await dispatchEvent(eventModules, 'unknown_event_type', {
      native: { platform: 'discord' },
    } as unknown as Parameters<typeof dispatchEvent>[2]);
  });

  it('should skip modules if platform is explicitly filtered out', async () => {
    // WHY: Enforces cross-platform structural safety at dispatch layer
    const mockHandler = vi.fn();
    const eventModules = new Map([
      [
        'log:subscribe',
        [
          {
            meta: { name: 'join', platform: ['telegram'] },
            onEvent: mockHandler,
          },
        ],
      ],
    ]);

    const ctx = {
      native: { platform: 'discord' },
      event: {},
    } as unknown as Parameters<typeof dispatchEvent>[2];

    await dispatchEvent(eventModules, 'log:subscribe', ctx);

    expect(mockHandler).not.toHaveBeenCalled(); // Filter blocked it
  });
});
