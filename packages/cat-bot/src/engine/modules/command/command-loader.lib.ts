/**
 * Command Directory Loader
 *
 * Imports every command module in a directory and registers it in the
 * canonical command map. Two module shapes are supported:
 *
 *   1. Single command — exports `meta`, `onCommand`/`onChat`, and optional
 *      lifecycle hooks/buttons. This is the only shape used in production;
 *      every file under `src/app/commands` registers exactly one command.
 *   2. Command family — exports `commands: Array<{ meta, onCommand, ... }>`.
 *      Retained for older/third-party command packs; never used by this repo.
 *
 * Registration rules:
 * - Files are scanned in sorted order and modules are registered after the
 *   concurrent import batch, so the registry (and any duplicate/alias error)
 *   is deterministic across filesystems and runs.
 * - Names, aliases and option names are normalised once at load time.
 * - A duplicate canonical name or alias never silently overwrites the first
 *   registration: the collision is logged with both file names and the later
 *   entry is skipped.
 * - Malformed modules are skipped with an actionable file + reason log; one
 *   bad file cannot abort the rest of the directory.
 * - Imported metadata is cloned rather than mutated, so the module's own
 *   exports stay immutable and a second loader call sees the original casing.
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { commandRegistry } from '@/engine/lib/module-registry.lib.js';

type RawModule = Record<string, unknown>;
type RawMeta = Record<string, unknown> & {
  name?: unknown;
  aliases?: unknown;
  options?: unknown;
};

export interface CommandLoadResult {
  commands: Map<string, RawModule>;
  /** Non-fatal problems discovered while loading (duplicates, bad metadata). */
  errors: string[];
}

function isCommandHandler(mod: RawModule): boolean {
  return (
    typeof mod['onCommand'] === 'function' ||
    typeof mod['onChat'] === 'function'
  );
}

function normalizeMeta(
  rawMeta: unknown,
  file: string,
  errors: string[],
): { meta: RawMeta; aliases: string[] } | null {
  if (typeof rawMeta !== 'object' || rawMeta === null) {
    errors.push(`${file}: missing meta object`);
    return null;
  }
  const meta = rawMeta as RawMeta;
  if (typeof meta.name !== 'string' || meta.name.trim() === '') {
    errors.push(`${file}: meta.name must be a non-empty string`);
    return null;
  }

  const aliases = Array.isArray(meta.aliases)
    ? meta.aliases
        .filter((alias): alias is string => typeof alias === 'string')
        .map((alias) => alias.trim().toLowerCase())
        .filter(Boolean)
    : [];

  const options = Array.isArray(meta.options)
    ? meta.options.map((option) => {
        if (typeof option !== 'object' || option === null) return option;
        const typed = option as { name?: unknown };
        return typeof typed.name === 'string'
          ? { ...typed, name: typed.name.toLowerCase() }
          : option;
      })
    : meta.options;

  return {
    meta: {
      ...meta,
      name: meta.name.trim().toLowerCase(),
      aliases,
      ...(options !== undefined ? { options } : {}),
    },
    aliases,
  };
}

/** Registers one loaded module under its canonical name and aliases. */
function registerModule(
  commands: Map<string, RawModule>,
  owners: Map<string, string>,
  mod: RawModule,
  file: string,
  errors: string[],
): void {
  const normalized = normalizeMeta(mod['meta'], file, errors);
  if (!normalized) return;
  if (!isCommandHandler(mod)) {
    errors.push(`${file}: missing onCommand/onChat handler`);
    return;
  }

  const { meta, aliases } = normalized;
  const canonical = meta.name as string;
  const keys = [canonical, ...aliases];

  for (const key of keys) {
    const existing = owners.get(key);
    if (existing) {
      errors.push(
        `${file}: "${key}" is already registered by ${existing}; skipping this module`,
      );
      return;
    }
  }

  // Clone so the registered module owns its normalised metadata without
  // mutating the imported ES module namespace.
  const registered: RawModule = { ...mod, meta };

  for (const key of keys) {
    commands.set(key, registered);
    owners.set(key, file);
    if (key === canonical) {
      commandRegistry.set(key, registered);
      logger.info(`Loaded command: ${key} (${file})`);
    } else {
      logger.info(`  ↳ Alias: ${key} → ${canonical}`);
    }
  }
}

/** Sorted, filtered list of command source files in `dir`. */
export async function listCommandFiles(dir: string): Promise<string[]> {
  const files = await fs.promises.readdir(dir);
  return files
    .filter(
      (file) =>
        (file.endsWith('.js') || file.endsWith('.ts')) &&
        !file.endsWith('.d.ts'),
    )
    .sort((a, b) => a.localeCompare(b));
}

/**
 * Imports every command file in `dir` and registers it. Broken files are
 * skipped with an actionable error; the returned map is keyed by every
 * canonical name and alias for O(1) dispatch lookup.
 */
export async function loadCommandsWithDiagnostics(
  dir: string,
): Promise<CommandLoadResult> {
  const commands = new Map<string, RawModule>();
  const errors: string[] = [];

  if (!fs.existsSync(dir)) {
    logger.warn(`⚠️  Commands directory not found: ${dir}`);
    return { commands, errors: [`Commands directory not found: ${dir}`] };
  }

  const files = await listCommandFiles(dir);

  // Import concurrently (I/O bound) but register in sorted order so aliases,
  // duplicate detection and log order never depend on import timing.
  const imported = await Promise.all(
    files.map(async (file) => {
      try {
        const mod = (await import(
          pathToFileURL(path.join(dir, file)).href
        )) as RawModule;
        return { file, mod };
      } catch (err) {
        errors.push(
          `${file}: failed to import — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        logger.error(`❌ Failed to load command ${file}`, { error: err });
        return null;
      }
    }),
  );

  const owners = new Map<string, string>();

  for (const entry of imported) {
    if (!entry) continue;
    const { file, mod } = entry;

    if (Array.isArray(mod['commands'])) {
      const family = mod['commands'] as RawModule[];
      if (family.length === 0) {
        errors.push(`${file}: commands array is empty`);
        continue;
      }
      for (const rawEntry of family) {
        if (typeof rawEntry !== 'object' || rawEntry === null) {
          errors.push(`${file}: commands entry is not an object`);
          continue;
        }
        registerModule(commands, owners, rawEntry, file, errors);
      }
      continue;
    }

    registerModule(commands, owners, mod, file, errors);
  }

  for (const message of errors) logger.error(`[commands] ${message}`);
  logger.info(`Loaded ${commands.size} command key(s) from ${files.length} file(s)`);
  return { commands, errors };
}

/**
 * Backwards-compatible entry point used by app.ts and the loader tests.
 * Diagnostics are logged; call `loadCommandsWithDiagnostics` when the caller
 * also needs the structured error list.
 */
export async function loadCommandsFromDirectory(
  dir: string,
): Promise<Map<string, Record<string, unknown>>> {
  const { commands } = await loadCommandsWithDiagnostics(dir);
  return commands;
}
