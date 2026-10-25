/**
 * Command loader compatibility.
 *
 * The live command directory uses only the single-command shape, but the
 * loader still promises to accept the legacy `commands` array. These fixtures
 * exercise both paths (including alias registration, lowercasing, and
 * skipping malformed entries) without booting a platform session.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadCommandsFromDirectory } from '@/engine/modules/command/command-loader.lib.js';
import { commandRegistry } from '@/engine/lib/module-registry.lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixtureDir = path.join(__dirname, '..', 'fixtures', 'loader-modules');

describe('loadCommandsFromDirectory', () => {
  it('registers single-command modules and their aliases', async () => {
    const commands = await loadCommandsFromDirectory(fixtureDir);

    expect(commands.has('solo')).toBe(true);
    expect(commands.has('s')).toBe(true);
    expect(commands.get('solo')).toBe(commands.get('s'));

    const mod = commands.get('solo') as {
      meta: { name: string; options: Array<{ name: string }> };
    };
    expect(mod.meta.name).toBe('solo');
    expect(mod.meta.options[0]?.name).toBe('query');
    expect(commandRegistry.has('solo')).toBe(true);
  });

  it('registers legacy commands arrays, including onChat-only entries', async () => {
    const commands = await loadCommandsFromDirectory(fixtureDir);

    expect(commands.has('first')).toBe(true);
    expect(commands.has('f')).toBe(true);
    expect(commands.has('second')).toBe(true);
    expect(commands.get('first')).toBe(commands.get('f'));

    const second = commands.get('second') as { onChat?: unknown };
    expect(typeof second.onChat).toBe('function');
  });

  it('skips malformed family entries instead of failing the directory', async () => {
    const commands = await loadCommandsFromDirectory(fixtureDir);

    expect(commands.has('broken')).toBe(false);
    expect(commands.size).toBe(5); // solo + s + first + f + second
  });

  it('returns an empty map for a missing directory', async () => {
    const commands = await loadCommandsFromDirectory(
      path.join(fixtureDir, 'does-not-exist'),
    );
    expect(commands.size).toBe(0);
  });
});
