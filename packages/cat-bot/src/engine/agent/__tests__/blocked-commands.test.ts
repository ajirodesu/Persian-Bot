import { describe, expect, it } from 'vitest';
import {
  __clearBlockedCacheForTests,
  getBlockedCommands,
  isBlockedCommand,
} from '../lib/blocked-commands.lib.js';

describe('blocked-commands', () => {
  it('always blocks shell and eval built-ins', () => {
    __clearBlockedCacheForTests();
    expect(isBlockedCommand('shell')).toBe(true);
    expect(isBlockedCommand('eval')).toBe(true);
    expect(isBlockedCommand('SHELL')).toBe(true);
    expect(isBlockedCommand('ping')).toBe(false);
    expect(getBlockedCommands().has('shell')).toBe(true);
  });

  it('extends the deny-list via NEEDLE_BLOCKED_COMMANDS without removing built-ins', () => {
    process.env['NEEDLE_BLOCKED_COMMANDS'] = 'update, restart';
    __clearBlockedCacheForTests();
    try {
      expect(isBlockedCommand('update')).toBe(true);
      expect(isBlockedCommand('restart')).toBe(true);
      expect(isBlockedCommand('shell')).toBe(true);
    } finally {
      delete process.env['NEEDLE_BLOCKED_COMMANDS'];
      __clearBlockedCacheForTests();
    }
  });
});
