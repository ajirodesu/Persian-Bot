import { describe, it, expect } from 'vitest';
import { extractHumanText } from '@/engine/agent/agent.util.js';

describe('extractHumanText', () => {
  it('passes plain text through unchanged (trimmed)', () => {
    expect(extractHumanText('  Hello there!  ')).toBe('Hello there!');
  });

  it('unwraps a Harmony commentary/final envelope to the actual answer', () => {
    const envelope = JSON.stringify({
      commentary: 'The user wants a summary, let me provide one.',
      final: 'Here is your summary: the bot is fast.',
    });
    expect(extractHumanText(envelope)).toBe(
      'Here is your summary: the bot is fast.',
    );
  });

  it('unwraps double-encoded JSON strings down to the real value', () => {
    const doubleEncoded = JSON.stringify(JSON.stringify({ final: 'hi' }));
    expect(extractHumanText(doubleEncoded)).toBe('hi');
  });

  it('prefers message over other envelope keys (send_result contract)', () => {
    expect(
      extractHumanText({ commentary: 'thinking', final: 'answer', message: 'the reply' }),
    ).toBe('the reply');
  });

  it('returns null for JSON objects with no text keys (never leaks raw JSON)', () => {
    expect(extractHumanText('{"status":"ok","count":3}')).toBeNull();
  });

  it('leaves markdown text that merely starts with a brace untouched', () => {
    // JSON.parse throws on trailing content, so this must pass through as-is.
    const code = '{"name": "x"}\n\nHere is the full explanation...';
    expect(extractHumanText(code)).toBe(code);
  });

  it('joins OpenAI-style content-part arrays', () => {
    expect(
      extractHumanText([
        { type: 'text', text: 'First part' },
        { type: 'text', text: 'Second part' },
      ]),
    ).toBe('First part\nSecond part');
  });

  it('returns null for empty / non-text values', () => {
    expect(extractHumanText('')).toBeNull();
    expect(extractHumanText('   ')).toBeNull();
    expect(extractHumanText(null)).toBeNull();
    expect(extractHumanText(42)).toBeNull();
    expect(extractHumanText(undefined)).toBeNull();
  });
});
