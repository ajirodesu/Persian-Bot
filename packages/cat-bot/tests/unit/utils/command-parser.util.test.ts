import { describe, it, expect } from 'vitest';
import { parseCommand } from '@/engine/modules/command/command-parser.util.js';

describe('Command Parser Utility', () => {
  it('should parse a standard prefixed command', () => {
    // WHY: Verify standard tokenization splits the command correctly
    const result = parseCommand(['/ping', 'arg1', 'arg2'], '/');
    expect(result).toEqual({ name: 'ping', args: ['arg1', 'arg2'] });
  });

  it('should return null when prefix is missing', () => {
    // WHY: Ensures messages without the trigger prefix are ignored
    const result = parseCommand(['ping', 'arg1'], '/');
    expect(result).toBeNull();
  });

  it('should return null if the token is ONLY the prefix', () => {
    // WHY: Edge case where user types just "/" and hits enter
    const result = parseCommand(['/'], '/');
    expect(result).toBeNull();
  });

  it('should handle spaced prefixes (prefix as independent token)', () => {
    // WHY: Some platforms split symbols and letters differently
    const result = parseCommand(['/', 'ping', 'arg1'], '/');
    expect(result).toEqual({ name: 'ping', args: ['arg1'] });
  });

  it('should force command name to lowercase', () => {
    // WHY: Commands must be case-insensitive for reliable routing
    const result = parseCommand(['/PiNg'], '/');
    expect(result?.name).toBe('ping');
  });

  describe('Telegram "@BotUsername" mention suffix', () => {
    it('strips a stuck @BotUsername suffix when no bot username is known', () => {
      // WHY: Non-Telegram callers (or Telegram before bot info resolves) pass no botUsername —
      // the mention should still be stripped so the command resolves.
      const result = parseCommand(['+help@ShiaBot', 'arg1'], '+');
      expect(result).toEqual({ name: 'help', args: ['arg1'] });
    });

    it('strips the suffix and matches when it targets this bot (case-insensitive)', () => {
      const result = parseCommand(['+help@ShiaBot'], '+', 'ShiaBot');
      expect(result).toEqual({ name: 'help', args: [] });
    });

    it('returns null when the mention targets a different bot', () => {
      // WHY: Mirrors Telegram's native /command@OtherBot behavior in multi-bot groups —
      // a command addressed to another bot must not misfire on this one.
      const result = parseCommand(['+help@OtherBot'], '+', 'ShiaBot');
      expect(result).toBeNull();
    });

    it('returns null when the mention is empty (command was just "@")', () => {
      const result = parseCommand(['+@ShiaBot'], '+');
      expect(result).toBeNull();
    });

    it('preserves remaining args when stripping the mention', () => {
      const result = parseCommand(['/start@ShiaBot', 'foo', 'bar'], '/', 'ShiaBot');
      expect(result).toEqual({ name: 'start', args: ['foo', 'bar'] });
    });
  });
});
