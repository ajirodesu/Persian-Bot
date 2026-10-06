import { describe, it, expect } from 'vitest';
import { isMentioned, claimMentionReply } from '../service.js';

describe('isMentioned', () => {
  const nicks = ['ShiaBot', 'bot-123'];

  it('matches @-mentions case-insensitively', () => {
    expect(isMentioned('hey @shiabot what time is it?', nicks)).toBe(true);
    expect(isMentioned('hey @SHIABOT!', nicks)).toBe(true);
  });

  it('matches bare nickname words, not substrings', () => {
    expect(isMentioned('shiabot, help me', nicks)).toBe(true);
    expect(isMentioned('is shiabot online?', nicks)).toBe(true);
    expect(isMentioned('shiabots are cool', nicks)).toBe(false);
    expect(isMentioned('I love both options', ['bot'])).toBe(false);
    expect(isMentioned('the bot is great', ['bot'])).toBe(true);
  });

  it('matches platform mention maps', () => {
    expect(isMentioned('hello there', nicks, { '99': '@ShiaBot' })).toBe(true);
    expect(isMentioned('hello there', nicks, { '99': '@someone' })).toBe(false);
    expect(isMentioned('hello', ['x', 'bot-123'], { 'bot-123': 'whatever' })).toBe(true);
  });

  it('handles empty input and no identities', () => {
    expect(isMentioned('   ', nicks)).toBe(false);
    expect(isMentioned('hello @shiabot', [])).toBe(false);
    expect(isMentioned('hello', [], { '1': '@x' })).toBe(false);
  });
});

describe('claimMentionReply', () => {
  it('allows once per window per user per thread', () => {
    const thread = `t-${Date.now()}`;
    expect(claimMentionReply(thread, 'u1')).toBe(true);
    expect(claimMentionReply(thread, 'u1')).toBe(false);
    expect(claimMentionReply(thread, 'u2')).toBe(true);
    expect(claimMentionReply(`other-${Date.now()}`, 'u1')).toBe(true);
  });
});
