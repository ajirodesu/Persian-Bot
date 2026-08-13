import { describe, it, expect, vi, beforeEach } from 'vitest';

// The Groq SDK is mocked entirely — the tests drive the agent loop's response
// sequence, not real API calls.
const { mockCreate } = vi.hoisted(() => ({ mockCreate: vi.fn() }));

vi.mock('groq-sdk', () => {
  class APIError extends Error {}
  class RateLimitError extends Error {}
  return {
    default: class GroqMock {
      chat = { completions: { create: mockCreate } };
    },
    APIError,
    RateLimitError,
  };
});

vi.mock('@/engine/repos/credentials.repo.js', () => ({
  isBotAdmin: vi.fn().mockResolvedValue(false),
  isBotPremium: vi.fn().mockResolvedValue(false),
}));

vi.mock('@/engine/repos/system-admin.repo.js', () => ({
  isSystemAdmin: vi.fn().mockResolvedValue(false),
}));

import { runAgent } from '@/engine/agent/agent.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

function makeCtx(): AppCtx {
  return {
    event: {
      type: 'message',
      senderID: 'u1',
      threadID: 't1',
      messageID: 'm1',
      message: 'hello bot',
    },
    native: { userId: 'owner', sessionId: 's1', platform: 'telegram' },
    commands: new Map(),
    prefix: '+',
    api: {
      platform: 'telegram',
      replyMessage: vi.fn().mockResolvedValue('mid'),
    },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  } as unknown as AppCtx;
}

function bareTextResponse(content: string) {
  return {
    choices: [{ message: { role: 'assistant', content, tool_calls: null } }],
  };
}

function sendResultToolCall(message = 'done') {
  return {
    choices: [
      {
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'c1',
              type: 'function',
              function: {
                name: 'send_result',
                arguments: JSON.stringify({ message }),
              },
            },
          ],
        },
      },
    ],
  };
}

describe('agent: bare-text response delivery', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it('delivers the text when the model finishes WITHOUT send_result (no more silence)', async () => {
    // Regression: the agent previously returned '' for ANY bare-text finish,
    // assuming send_result had delivered — but when the model answers a simple
    // conversational prompt with plain text, nothing was sent and the user got
    // total silence.
    mockCreate.mockResolvedValueOnce(bareTextResponse('Hello there!'));
    const result = await runAgent('hi', makeCtx(), null, null, null, 'gsk_test_1234567890123456789012345');
    expect(result).toBe('Hello there!');
  });

  it('unwraps a Harmony commentary/final JSON envelope to the actual value', async () => {
    // Regression: gpt-oss-120b occasionally finishes with the Harmony
    // "commentary/final json" envelope as bare content — the user must see the
    // answer text, not raw JSON.
    const envelope = JSON.stringify({
      commentary: 'User wants a quick greeting.',
      final: 'Hello! How can I help you today?',
    });
    mockCreate.mockResolvedValueOnce(bareTextResponse(envelope));
    const result = await runAgent('hi', makeCtx(), null, null, null, 'gsk_test_1234567890123456789012345');
    expect(result).toBe('Hello! How can I help you today?');
  });

  it('suppresses the text when send_result already delivered (no duplicates)', async () => {
    const ctx = makeCtx();
    mockCreate
      .mockResolvedValueOnce(sendResultToolCall('Here you go'))
      .mockResolvedValueOnce(bareTextResponse('Done!'));
    const result = await runAgent('give me a meme', ctx, null, null, null, 'gsk_test_1234567890123456789012345');
    // send_result delivered the real reply — the trailing text must not re-send it.
    expect(result).toBe('');
    expect((ctx.api as unknown as { replyMessage: ReturnType<typeof vi.fn> }).replyMessage).toHaveBeenCalledTimes(1);
  });

  it('surfaces the follow-up text when send_result FAILED to deliver', async () => {
    const ctx = makeCtx();
    (ctx.api as unknown as { replyMessage: ReturnType<typeof vi.fn> }).replyMessage.mockRejectedValueOnce(
      new Error('network down'),
    );
    mockCreate
      .mockResolvedValueOnce(sendResultToolCall('Here you go'))
      .mockResolvedValueOnce(bareTextResponse('I could not send it right now.'));
    const result = await runAgent('give me a meme', ctx, null, null, null, 'gsk_test_1234567890123456789012345');
    // Delivery failed → the model's explanation must reach the user.
    expect(result).toBe('I could not send it right now.');
  });
});
