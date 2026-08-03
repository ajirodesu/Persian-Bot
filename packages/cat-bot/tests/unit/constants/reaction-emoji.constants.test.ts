import { describe, it, expect } from 'vitest';
import {
  DEFAULT_COMMAND_REACT_EMOJI,
  TELEGRAM_REACTION_EMOJIS,
  isTelegramReactionEmoji,
  isDiscordReactionEmoji,
  isValidReactionEmoji,
} from '@/engine/constants/reaction-emoji.constants.js';

describe('Reaction Emoji Constants', () => {
  it('defaults to the fire emoji', () => {
    expect(DEFAULT_COMMAND_REACT_EMOJI).toBe('🔥');
  });

  it('default emoji is valid on both Discord and Telegram', () => {
    expect(isTelegramReactionEmoji(DEFAULT_COMMAND_REACT_EMOJI)).toBe(true);
    expect(isDiscordReactionEmoji(DEFAULT_COMMAND_REACT_EMOJI)).toBe(true);
  });

  it('exposes the full documented Telegram supported set', () => {
    expect(TELEGRAM_REACTION_EMOJIS.length).toBeGreaterThan(50);
    // Spot-check representative entries across the list
    expect(isTelegramReactionEmoji('👍')).toBe(true);
    expect(isTelegramReactionEmoji('\u2764\u200D\u{1F525}')).toBe(true);
    expect(isTelegramReactionEmoji('\u{1F937}\u200D\u2642')).toBe(true);
  });

  it('rejects unsupported emoji on Telegram', () => {
    expect(isTelegramReactionEmoji('🍕')).toBe(false);
    expect(isTelegramReactionEmoji('🔥🔥')).toBe(false);
    expect(isTelegramReactionEmoji('')).toBe(false);
  });

  it('accepts unicode emoji on Discord', () => {
    expect(isDiscordReactionEmoji('🔥')).toBe(true);
    expect(isDiscordReactionEmoji('👍')).toBe(true);
    expect(isDiscordReactionEmoji('🇺🇸')).toBe(true);
    expect(isDiscordReactionEmoji('\u{1F468}\u200D\u{1F469}\u200D\u{1F467}')).toBe(true);
  });

  it('accepts Discord custom emoji references', () => {
    expect(isDiscordReactionEmoji('<:cat:123456789012345678>')).toBe(true);
    expect(isDiscordReactionEmoji('<a:party:123456789012345678>')).toBe(true);
  });

  it('rejects malformed Discord custom emoji references', () => {
    expect(isDiscordReactionEmoji('<:cat:>')).toBe(false);
    expect(isDiscordReactionEmoji('<:cat:123>')).toBe(false);
    expect(isDiscordReactionEmoji('cat:123456789012345678')).toBe(false);
    expect(isDiscordReactionEmoji('plain text')).toBe(false);
    expect(isDiscordReactionEmoji('')).toBe(false);
  });

  it('routes platform validation through isValidReactionEmoji', () => {
    expect(isValidReactionEmoji('telegram', '🔥')).toBe(true);
    expect(isValidReactionEmoji('telegram', '🍕')).toBe(false);
    expect(isValidReactionEmoji('discord', '<:cat:123456789012345678>')).toBe(
      true,
    );
    expect(isValidReactionEmoji('discord', 'plain text')).toBe(false);
  });
});
