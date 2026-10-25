/**
 * Command loader compatibility.
 *
 * The live command directory uses only the single-command shape, but the
 * loader still promises to accept the legacy `commands` array. These fixtures
 * exercise both paths (including alias registration, lowercasing, and
 * skipping malformed entries) without booting a platform session.
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import {
  loadCommandsFromDirectory,
  loadCommandsWithDiagnostics,
} from '@/engine/modules/command/command-loader.lib.js';
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


describe('deterministic registration and collision handling', () => {
  it('keeps the first sorted file and reports a duplicate instead of overwriting', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'catbot-cmd-dup-'));
    try {
      // Sorted order is a-first, b-second; the first registration must win.
      await writeFile(
        path.join(dir, 'b-second.command.js'),
        "export const meta = { name: 'dup' }; export const onCommand = async () => {};\n",
      );
      await writeFile(
        path.join(dir, 'a-first.command.js'),
        "export const meta = { name: 'dup' }; export const onCommand = async () => {};\n",
      );

      const { commands, errors } = await loadCommandsWithDiagnostics(dir);

      expect(commands.size).toBe(1);
      expect(errors.some((e) => e.includes('already registered'))).toBe(true);
      expect(errors.some((e) => e.includes('b-second.command.js'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('detects an alias that collides with another file\'s canonical name', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'catbot-cmd-alias-'));
    try {
      await writeFile(
        path.join(dir, 'a.command.js'),
        "export const meta = { name: 'alpha' }; export const onCommand = async () => {};\n",
      );
      await writeFile(
        path.join(dir, 'b.command.js'),
        "export const meta = { name: 'beta', aliases: ['alpha'] }; export const onCommand = async () => {};\n",
      );

      const { commands, errors } = await loadCommandsWithDiagnostics(dir);

      expect(commands.has('alpha')).toBe(true);
      expect(commands.has('beta')).toBe(false);
      expect(errors.some((e) => e.includes('already registered'))).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('normalises a cloned meta without mutating the imported module', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'catbot-cmd-case-'));
    try {
      const file = path.join(dir, 'case.command.js');
      await writeFile(
        file,
        "export const meta = { name: 'MiXeD', aliases: ['Shout'], options: [{ name: 'Query' }] }; export const onCommand = async () => {};\n",
      );

      const { commands } = await loadCommandsWithDiagnostics(dir);
      expect(commands.has('mixed')).toBe(true);
      expect(commands.has('shout')).toBe(true);

      const mod = await import(pathToFileURL(file).href);
      expect(mod.meta.name).toBe('MiXeD');
      expect(mod.meta.aliases).toEqual(['Shout']);
      expect(mod.meta.options[0].name).toBe('Query');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
