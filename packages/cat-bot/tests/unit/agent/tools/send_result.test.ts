import { describe, it, expect, vi } from 'vitest';
import { run as sendResultRun } from '@/engine/agent/tools/send_result.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

function makeCtx() {
  const replyMessage = vi.fn().mockResolvedValue('mid');
  return {
    event: { type: 'message', senderID: 'u1', threadID: 't1', messageID: 'm1' },
    api: { platform: 'telegram', replyMessage },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as AppCtx;
}

describe('send_result: actual value, never raw JSON', () => {
  it('delivers the real message from Harmony commentary/final quirk args', async () => {
    const ctx = makeCtx();
    const result = await sendResultRun(
      {
        commentary: 'The user asked for a meme, I will provide one.',
        final: 'Here is your meme! 🐱',
      },
      ctx,
    );
    expect(result).toBe('Message delivered.');
    const replyMessage = (ctx.api as unknown as { replyMessage: ReturnType<typeof vi.fn> })
      .replyMessage;
    expect(replyMessage).toHaveBeenCalledTimes(1);
    const opts = replyMessage.mock.calls[0]?.[1] as { message?: string };
    expect(opts?.message).toBe('Here is your meme! 🐱');
  });

  it('unwraps a double-encoded JSON message string', async () => {
    const ctx = makeCtx();
    await sendResultRun({ message: JSON.stringify({ final: 'value inside' }) }, ctx);
    const replyMessage = (ctx.api as unknown as { replyMessage: ReturnType<typeof vi.fn> })
      .replyMessage;
    const opts = replyMessage.mock.calls[0]?.[1] as { message?: string };
    expect(opts?.message).toBe('value inside');
  });

  it('fails visibly when there is no text and no attachments (no empty send)', async () => {
    const ctx = makeCtx();
    const result = await sendResultRun(
      { status: 'ok', note: 'no user-facing text anywhere' },
      ctx,
    );
    expect(result).toContain('Delivery failed');
    const replyMessage = (ctx.api as unknown as { replyMessage: ReturnType<typeof vi.fn> })
      .replyMessage;
    expect(replyMessage).not.toHaveBeenCalled();
  });
});
