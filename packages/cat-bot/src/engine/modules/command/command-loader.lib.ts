/**
 * Command Directory Loader
 *
 * Imports every command module in a directory and registers it in the
 * canonical command map. Two module shapes are supported for backwards
 * compatibility:
 *
 *   1. Single command — exports `meta`, `onCommand`/`onChat`, and optional
 *      lifecycle hooks/buttons.
 *   2. Command family — exports `commands: Array<{ meta, onCommand, ... }>`.
 *
 * The live bot uses the single-command shape for every file. The family shape
 * remains supported so third-party or older command packs keep loading.
 */

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { commandRegistry } from '@/engine/lib/module-registry.lib.js';

/** Imports every command file in `dir`; broken files are skipped with a warning. */
export async function loadCommandsFromDirectory(
  dir: string,
): Promise<Map<string, Record<string, unknown>>> {
  const commands = new Map<string, Record<string, unknown>>();

  if (!fs.existsSync(dir)) {
    logger.warn(`⚠️  Commands directory not found: ${dir}`);
    return commands;
  }

  const files = (await fs.promises.readdir(dir)).filter(
    (f) => (f.endsWith('.js') || f.endsWith('.ts')) && !f.endsWith('.d.ts'),
  );

  await Promise.allSettled(
    files.map(async (file) => {
      try {
        const mod = (await import(
          pathToFileURL(path.join(dir, file)).href
        )) as Record<string, unknown>;

        // Multi-command files export `commands: Array<{ meta, onCommand, ... }>`.
        if (Array.isArray(mod['commands'])) {
          for (const rawEntry of mod['commands'] as Array<
            Record<string, unknown>
          >) {
            const entryCfg = rawEntry['meta'] as
              | {
                  name?: string;
                  aliases?: string[];
                  options?: Array<{ name?: string }>;
                }
              | undefined;

            if (!entryCfg?.name) {
              logger.warn(
                `⚠️  Skipping an entry in ${file}: missing meta.name`,
              );
              continue;
            }
            if (
              typeof rawEntry['onCommand'] !== 'function' &&
              typeof rawEntry['onChat'] !== 'function'
            ) {
              logger.warn(
                `⚠️  Skipping "${entryCfg.name}" in ${file}: missing onCommand/onChat`,
              );
              continue;
            }

            entryCfg.name = entryCfg.name.toLowerCase();
            if (Array.isArray(entryCfg.options)) {
              for (const opt of entryCfg.options) {
                if (opt && typeof opt.name === 'string') {
                  opt.name = opt.name.toLowerCase();
                }
              }
            }

            commands.set(entryCfg.name, rawEntry);
            commandRegistry.set(entryCfg.name, rawEntry);
            logger.info(`Loaded command: ${entryCfg.name} (from ${file})`);

            if (Array.isArray(entryCfg.aliases)) {
              for (const alias of entryCfg.aliases) {
                commands.set(String(alias).toLowerCase(), rawEntry);
                logger.info(`  ↳ Alias: ${String(alias).toLowerCase()}`);
              }
            }
          }
          return;
        }

        const cfg = mod['meta'] as
          { name?: string; aliases?: string[] } | undefined;

        if (!cfg?.name) {
          logger.warn(`⚠️  Skipping ${file}: missing meta.name`);
          return;
        }
        if (
          typeof mod['onCommand'] !== 'function' &&
          typeof mod['onChat'] !== 'function'
        ) {
          logger.warn(`⚠️  Skipping ${file}: missing onStart/onChat`);
          return;
        }

        // Discord requires lowercase command/option names — normalise at load time.
        cfg.name = cfg.name.toLowerCase();
        const rawCfg = mod['meta'] as {
          options?: Array<{ name?: string }>;
        };
        if (Array.isArray(rawCfg.options)) {
          for (const opt of rawCfg.options) {
            if (opt && typeof opt.name === 'string') {
              opt.name = opt.name.toLowerCase();
            }
          }
        }

        commands.set(cfg.name.toLowerCase(), mod);
        commandRegistry.set(cfg.name.toLowerCase(), mod);
        logger.info(`Loaded command: ${cfg.name}`);

        if (Array.isArray(cfg.aliases)) {
          for (const alias of cfg.aliases) {
            commands.set(String(alias).toLowerCase(), mod);
            logger.info(`  ↳ Alias: ${String(alias).toLowerCase()}`);
          }
        }
      } catch (err) {
        logger.error(`❌ Failed to load command ${file}`, { error: err });
      }
    }),
  );

  logger.info(`Loaded ${commands.size} command(s)`);
  return commands;
}
