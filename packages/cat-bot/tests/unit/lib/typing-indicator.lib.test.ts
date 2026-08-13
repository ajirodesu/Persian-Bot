import { describe, it, expect, vi } from 'vitest';
import {
  actionFromAttachments,
  switchTypingIndicator,
  withTypingIndicator,
} from '@/engine/lib/typing-indicator.lib.js';
import type { UnifiedApi } from '@/engine/adapters/models/api.model.js';

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

function makeMockApi(): {
  api: UnifiedApi;
  send: ReturnType<typeof vi.fn>;
} {
  const send = vi.fn().mockResolvedValue(undefined);
  const api = {
    platform: 'telegram',
    sendTypingIndicator: send,
  } as unknown as UnifiedApi;
  return { api, send };
}

describe('typing-indicator: actionFromAttachments', () => {
  it('returns null for text-only replies (keeps default typing notice)', () => {
    expect(actionFromAttachments([], [])).toBeNull();
  });

  it('maps photo extensions to the photo action', () => {
    expect(
      actionFromAttachments([{ name: 'meme.png', stream: Buffer.from('x') }], []),
    ).toBe('photo');
  });

  it('maps video and audio URL attachments to their actions', () => {
    expect(
      actionFromAttachments([], [{ name: 'clip.mp4', url: 'https://x/clip.mp4' }]),
    ).toBe('video');
    expect(
      actionFromAttachments([], [{ name: 'track.mp3', url: 'https://x/track.mp3' }]),
    ).toBe('audio');
  });

  it('falls back to document for unknown or extension-less filenames', () => {
    expect(
      actionFromAttachments([{ name: 'archive.zip', stream: Buffer.from('x') }], []),
    ).toBe('document');
    expect(
      actionFromAttachments([{ name: 'no-ext', stream: Buffer.from('x') }], []),
    ).toBe('document');
  });

  it('prioritises video over audio over photo over document in mixed replies', () => {
    const photo = [{ name: 'a.png', stream: Buffer.from('x') }];
    const video = [{ name: 'b.mp4', stream: Buffer.from('x') }];
    const audio = [{ name: 'c.mp3', stream: Buffer.from('x') }];
    const doc = [{ name: 'd.pdf', stream: Buffer.from('x') }];
    expect(actionFromAttachments([...photo, ...video], [])).toBe('video');
    expect(actionFromAttachments([...photo, ...audio], [])).toBe('audio');
    expect(actionFromAttachments([...doc, ...photo], [])).toBe('photo');
  });

  it('strips query strings and URL paths before extension detection', () => {
    expect(
      actionFromAttachments(
        [],
        [{ name: 'https://cdn.example.com/videos/promo.mp4?token=abc#frag', url: 'x' }],
      ),
    ).toBe('video');
  });
});

describe('typing-indicator: switchTypingIndicator', () => {
  it('is a no-op when no indicator is active on the thread', () => {
    expect(() => switchTypingIndicator('999', 'video')).not.toThrow();
  });

  it('switches the live indicator action the moment media is about to be sent', async () => {
    const { api, send } = makeMockApi();

    await withTypingIndicator(api, '123', async () => {
      // Let the initial 'typing' signal flush.
      await tick();
      switchTypingIndicator('123', 'video');
      await tick();
    });

    const actions = send.mock.calls.map((call: unknown[]) => call[1]);
    expect(actions).toContain('typing');
    expect(actions).toContain('video');
    // 'video' must appear after 'typing' — the switch pivots, never replaces the start.
    expect(actions.indexOf('video')).toBeGreaterThan(actions.indexOf('typing'));
  });

  it('stops firing after the wrapped function settles', async () => {
    const { api, send } = makeMockApi();

    await withTypingIndicator(api, '123', async () => {
      await tick();
    });
    const callsAfter = send.mock.calls.length;

    // A switch after teardown must not resurrect the indicator.
    switchTypingIndicator('123', 'photo');
    await tick();
    expect(send.mock.calls.length).toBe(callsAfter);
  });
});
