/**
 * Command routing helpers.
 *
 * These cover the pure pieces the dispatch pipeline relies on: zero-copy
 * prefix parsing, canonical-only suggestions with disabled filtering, the
 * onChat module index, and the immutability assumptions behind its caches.
 */
import { describe, expect, it } from 'vitest';
import { parseCommand } from '@/engine/modules/command/command-parser.util.js';
import { findSimilarCommand } from '@/engine/modules/command/command-suggest.util.js';
import { getOnChatModules } from '@/engine/controllers/on-chat-runner.js';
import { OptionsMap } from '@/engine/modules/options/options-map.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMap, CommandModule } from '@/engine/types/controller.types.js';
import inventory from '../fixtures/command-inventory.json';

/** Reference implementation of Dice's coefficient used to prove parity. */
function diceReference(first: string, second: string): number {
  const f = first.replace(/\s+/g, '');
  const s = second.replace(/\s+/g, '');
  if (f === s) return 1;
  if (f.length < 2 || s.length < 2) return 0;
  const bigrams = new Map<string, number>();
  for (let i = 0; i < f.length - 1; i += 1) {
    const bigram = f.substring(i, i + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }
  let intersection = 0;
  for (let i = 0; i < s.length - 1; i += 1) {
    const bigram = s.substring(i, i + 2);
    const count = bigrams.get(bigram) ?? 0;
    if (count > 0) {
      bigrams.set(bigram, count - 1);
      intersection += 1;
    }
  }
  return (2 * intersection) / (f.length + s.length - 2);
}

function command(
  name: string,
  extra: Partial<CommandModule> = {},
): CommandModule {
  return {
    meta: { name },
    onCommand: async () => undefined,
    ...extra,
  } as CommandModule;
}

describe('parseCommand', () => {
  it('strips the prefix and returns the remaining tokens without mutating input', () => {
    const input = ['!ping', 'one', 'two'];
    expect(parseCommand(input, '!')).toEqual({
      name: 'ping',
      args: ['one', 'two'],
    });
    expect(input).toEqual(['!ping', 'one', 'two']);
  });

  it('handles a standalone prefix token and lowercases the name', () => {
    expect(parseCommand(['!', 'HeLp', 'x'], '!')).toEqual({
      name: 'help',
      args: ['x'],
    });
    expect(parseCommand(['!'], '!')).toBeNull();
  });

  it('strips a matching Telegram bot mention and rejects another bot', () => {
    expect(parseCommand(['/help@ShiaBot', 'a'], '/', 'ShiaBot')).toEqual({
      name: 'help',
      args: ['a'],
    });
    expect(parseCommand(['/help@OtherBot'], '/', 'ShiaBot')).toBeNull();
    expect(parseCommand(['plain text'], '/')).toBeNull();
  });
});

describe('findSimilarCommand', () => {
  const commands: CommandMap = new Map();
  commands.set('help', command('help'));
  commands.set('h', commands.get('help')!); // alias: must not be a suggestion target
  commands.set('ping', command('ping'));
  commands.set('play', command('play'));

  it('suggests the closest canonical command', () => {
    expect(findSimilarCommand('hepl', commands)).toBe('help');
    expect(findSimilarCommand('pgin', commands)).toBe('ping');
  });

  it('returns an exact canonical match immediately', () => {
    expect(findSimilarCommand('ping', commands)).toBe('ping');
  });

  it('omits disabled names', () => {
    expect(findSimilarCommand('hepl', commands, new Set(['help']))).not.toBe('help');
  });

  it('does not suggest an alias', () => {
    const onlyAlias = new Map() as CommandMap;
    onlyAlias.set('h', command('help'));
    const mod = onlyAlias.get('h') as CommandModule;
    onlyAlias.set('help', mod);
    expect(findSimilarCommand('h', onlyAlias)).not.toBe('h');
  });

  it('returns null for unrelated input', () => {
    expect(findSimilarCommand('zzzzzz', commands)).toBeNull();
  });
});

describe('onChat index', () => {
  it('deduplicates aliases and caches the platform-filtered list', () => {
    const map: CommandMap = new Map();
    const passive = command('passive', { onChat: async () => undefined });
    const filtered = command('telegram-only', {
      meta: { name: 'telegram-only', platform: [Platforms.Telegram] },
      onChat: async () => undefined,
    });
    const plain = command('plain');
    map.set('passive', passive);
    map.set('p', passive); // alias pointing at the same module
    map.set('telegram-only', filtered);
    map.set('plain', plain);

    const discord = getOnChatModules(map, Platforms.Discord);
    expect(discord).toHaveLength(1);
    expect(discord[0]).toBe(passive);
    // Repeated calls reuse the cached array.
    expect(getOnChatModules(map, Platforms.Discord)).toBe(discord);

    const telegram = getOnChatModules(map, Platforms.Telegram);
    expect(telegram).toHaveLength(2);
    expect(telegram).toContain(passive);
    expect(telegram).toContain(filtered);
  });
});

describe('OptionsMap.empty', () => {
  it('returns one shared immutable instance', () => {
    const a = OptionsMap.empty();
    const b = OptionsMap.empty();
    expect(a).toBe(b);
    expect(a.has('anything')).toBe(false);
  });
});


describe('suggestion parity with the previous brute-force matcher', () => {
  it('returns the same canonical name for real misspellings', () => {
    const real: CommandMap = new Map();
    for (const entry of inventory) {
      real.set(entry.meta.name, command(entry.meta.name));
    }

    const reference = (query: string): string | null => {
      const ratings: Array<{ target: string; rating: number }> = [];
      for (const mod of real.values()) {
        const canonical = (mod.meta as { name?: string }).name?.toLowerCase();
        if (!canonical) continue;
        if (ratings.some((r) => r.target === canonical)) continue;
        ratings.push({ target: canonical, rating: diceReference(query, canonical) });
      }
      ratings.sort((a, b) => b.rating - a.rating);
      return ratings[0] && ratings[0].rating >= 0.3 ? ratings[0].target : null;
    };

    for (const query of ['hepl', 'pgin', 'menuu', 'dowload', 'quize', 'starrt', 'ban', 'gogle']) {
      expect(findSimilarCommand(query, real), query).toBe(reference(query));
    }
  });
});
