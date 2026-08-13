import { describe, it, expect } from 'vitest';
import {
  extractHumanText,
  renderSystemPrompt,
} from '@/engine/agent/agent.util.js';

describe('renderSystemPrompt', () => {
  const variables = {
    '{{BOT_NAME}}': 'Kitty',
    '{{USER_NAME}}': 'Alice',
    '{{COMMAND_PREFIX}}': '/',
  };

  it('replaces every occurrence of repeated placeholders (not just the first)', () => {
    const template =
      '{{BOT_NAME}} is {{BOT_NAME}}. {{BOT_NAME}} helps {{USER_NAME}}, {{USER_NAME}}.';
    const out = renderSystemPrompt(template, variables);
    expect(out).toBe('Kitty is Kitty. Kitty helps Alice, Alice.');
    expect(out).not.toContain('{{');
  });

  it('never substitutes a token twice, even when a value contains one', () => {
    // A value that itself contains '{{BOT_NAME}}' must NOT be substituted a
    // second time — the first pass inserts it verbatim and the safety net
    // strips the residual token, so the model never sees (or echoes) a
    // placeholder.
    const out = renderSystemPrompt('Hi {{USER_NAME}}', {
      '{{USER_NAME}}': '{{BOT_NAME}}',
    });
    expect(out).toBe('Hi ');
    expect(out).not.toContain('{{');
    expect(out).not.toContain('Kitty');
  });

  it('strips unknown placeholders so a literal token can never reach the LLM', () => {
    const out = renderSystemPrompt(
      '{{BOT_NAME}} and {{NOT_WIRED}} and {{USER_NAME}}',
      variables,
    );
    expect(out).toBe('Kitty and  and Alice');
    expect(out).not.toContain('{{NOT_WIRED}}');
  });

  it('strips placeholders introduced by inserted values as a safety net', () => {
    const out = renderSystemPrompt('{{BOT_NAME}}', {
      '{{BOT_NAME}}': 'Weird {{mixed}} name',
    });
    expect(out).toBe('Weird  name');
    expect(out).not.toContain('{{');
  });

  it('leaves text without placeholders untouched', () => {
    const template = 'Plain text, no tokens.';
    expect(renderSystemPrompt(template, variables)).toBe(template);
  });
});

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
