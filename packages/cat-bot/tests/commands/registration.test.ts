/**
 * Command registration contract.
 *
 * Every command file must expose exactly one canonical command through the
 * loader-compatible single-module shape (`meta` + `onCommand`, optionally
 * `button` and lifecycle hooks). The inventory fixture is the authoritative
 * snapshot taken before the command-family files were split, so this suite
 * fails if any command, alias, metadata field, or hook is dropped.
 */
import { describe, expect, it } from 'vitest';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

interface CommandModule {
  meta?: CommandMeta;
  onCommand?: unknown;
  onChat?: unknown;
  onReply?: unknown;
  onReact?: unknown;
  button?: Record<string, unknown>;
  commands?: unknown;
}

interface InventoryEntry {
  file: string;
  meta: CommandMeta;
  hooks: string[];
}

const modules = import.meta.glob<CommandModule>('../../src/app/commands/*.ts', {
  eager: true,
});

const inventory = (
  await import('../fixtures/command-inventory.json', {
    with: { type: 'json' },
  })
).default as InventoryEntry[];

const entries = Object.entries(modules);

const byCanonicalName = new Map<string, CommandModule>();
for (const [, mod] of entries) {
  if (mod.meta?.name) byCanonicalName.set(mod.meta.name, mod);
}

const BUTTON_IDS: Record<string, string[]> = {
  meme: ['refresh'],
  animeme: ['refresh'],
  cat: ['cat-next'],
  fox: ['fox-next'],
  duck: ['duck-next'],
  dog: ['dog-next'],
  lizard: ['lizard-next'],
  goose: ['goose-next'],
  randomperiodictable: ['periodic-table-reroll'],
  '8ball': ['8ball-again'],
  fact: ['fact-again'],
  wyr: ['wyr-again'],
  pickupline: ['pickupline-again'],
  advice: ['advice-next'],
  catfact: ['catfact-next'],
  dogfact: ['dogfact-next'],
  funfact: ['funfact-next'],
  joke: ['joke-next'],
  quote: ['quote-next'],
  coffee: ['repeat'],
  ba: ['repeat'],
  wallpaper: ['random', 'nature', 'space', 'city', 'sunset', 'anime'],
};

describe('command modules', () => {
  it('has one loader-compatible module per command file', () => {
    expect(entries).toHaveLength(156);

    for (const [file, mod] of entries) {
      expect(
        mod.commands,
        `${file} must not export a commands array`,
      ).toBeUndefined();
      expect(mod.meta, `${file} is missing meta`).toBeDefined();
      expect(typeof mod.onCommand, `${file} is missing onCommand`).toBe(
        'function',
      );
    }
  });

  it('registers every canonical command exactly once', () => {
    const names = entries.map(([, mod]) => mod.meta?.name);
    expect(names).toHaveLength(156);
    expect(new Set(names).size).toBe(156);
    expect(new Set(names)).toEqual(
      new Set(inventory.map((entry) => entry.meta.name)),
    );
  });

  it('keeps the effective alias namespace collision-free', () => {
    const canonicalNames = new Set(
      entries.map(([, mod]) => mod.meta?.name).filter(Boolean),
    );
    expect(canonicalNames.size).toBe(entries.length);

    const seenAliases = new Map<string, string>();

    for (const [, mod] of entries) {
      const name = mod.meta?.name;
      if (!name) continue;

      for (const alias of mod.meta?.aliases ?? []) {
        expect(
          canonicalNames.has(alias),
          `alias "${alias}" of "${name}" collides with a canonical command`,
        ).toBe(false);

        const existing = seenAliases.get(alias);
        expect(
          existing,
          `alias "${alias}" of "${name}" collides with "${existing}"`,
        ).toBeUndefined();
        seenAliases.set(alias, name);
      }
    }
  });

  it('keeps the historical "x" alias on download, not xstalk', () => {
    expect(byCanonicalName.get('download')?.meta?.aliases).toContain('x');
    expect(byCanonicalName.get('xstalk')?.meta?.aliases).toEqual(['twitter']);
  });

  it('preserves every canonical metadata field from the pre-split inventory', () => {
    for (const entry of inventory) {
      const mod = byCanonicalName.get(entry.meta.name);
      expect(mod, `missing command "${entry.meta.name}"`).toBeDefined();

      const expected =
        entry.meta.name === 'xstalk'
          ? { ...entry.meta, aliases: ['twitter'] }
          : entry.meta;

      expect(mod?.meta).toEqual(expected);
    }
  });

  it('preserves lifecycle hooks and button families', () => {
    for (const entry of inventory) {
      const mod = byCanonicalName.get(entry.meta.name);
      expect(mod, `missing command "${entry.meta.name}"`).toBeDefined();
      if (!mod) continue;

      for (const hook of ['onChat', 'onReply', 'onReact']) {
        if (entry.hooks.includes(hook)) {
          expect(
            mod[hook as keyof CommandModule],
            `${entry.meta.name} ${hook}`,
          ).toBeDefined();
        }
      }

      if (entry.hooks.includes('button')) {
        expect(
          Object.keys(mod.button ?? {}).length,
          `${entry.meta.name} must expose at least one button`,
        ).toBeGreaterThan(0);
      } else {
        expect(
          mod.button,
          `${entry.meta.name} must not expose buttons`,
        ).toBeUndefined();
      }

      const expectedButtonIds = BUTTON_IDS[entry.meta.name];
      if (expectedButtonIds) {
        const actualButtonIds = Object.keys(mod.button ?? {}).sort();
        expect(actualButtonIds, `${entry.meta.name} buttons`).toEqual(
          [...expectedButtonIds].sort(),
        );
      }
    }
  });
});
