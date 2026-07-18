/**
 * Discord Platform — Slash Command Registration
 *
 * Single responsibility: register and clear Discord application commands via REST.
 * Adds command-hash idempotency so the REST API is only called when the menu is
 * actually stale — avoiding rate-limit budget waste and latency on every restart.
 *
 * Decision: prefix='/'  → register global commands so Discord's menu appears
 *           prefix≠'/'  → clear global commands so the menu stays empty and
 *                          users discover the text-prefix instead
 *
 * Registration gate (evaluated against the DB credential row before each REST call):
 *   REGISTER when: prefix == '/' AND (!isCommandRegister OR hash ≠ storedHash)
 *   CLEAR    when: prefix != '/' AND (isCommandRegister OR commandHash IS NOT NULL)
 *   SKIP     otherwise — menu is already in the desired state
 */

import { SlashCommandBuilder, REST, Routes } from 'discord.js';
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js'; // Relocated module
import type { Client } from 'discord.js';
import { computeCommandHash } from '@/engine/modules/command/command-hash.util.js';
import {
  findDiscordCredentialState,
  updateDiscordCredentialCommandHash,
} from '@/engine/repos/credentials.repo.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { OptionTypeValue } from '@/engine/modules/command/command-option.constants.js';
import { isPlatformAllowed } from '@/engine/modules/platform/platform-filter.util.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

// Discord API v10 hard cap: a single PUT /applications/{id}/commands with more than 100
// entries is rejected with 400. Named constant so both the guard and any future log messages
// reference the same source of truth rather than a bare magic number.
const DISCORD_SLASH_COMMAND_LIMIT = 100;

// 🔧 Centralized safe truncation utility
function truncate(value: string, max: number): string {
  if (!value) return '';
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + '…'; // keep within limit with ellipsis
}

// Shape of each option entry in a command module's meta.options array
interface SlashOption {
  type: OptionTypeValue;
  name: string;
  description: string;
  required?: boolean;
}

interface SlashCommandOptions {
  client: Client;
  commands: Map<string, Record<string, unknown>>;
  prefix: string;
  clientId: string;
  token: string;
  /** better-auth userId — part of the composite PK in bot_credential_discord */
  userId: string;
  /** Discord session identifier — part of the composite PK in bot_credential_discord */
  sessionId: string;
  sessionLogger: SessionLogger;
  /** Lowercase command names currently disabled for this session — excluded from Discord's '/' menu.
   *  Sourced from bot_session_commands at re-registration time so the menu stays consistent with the DB. */
  disabledNames?: Set<string>;
  /** Bypass the command-hash idempotency check and force a REST round-trip regardless of stored state.
   *  Set true when triggered by a dashboard toggle — the enabled-set changed, not the meta hash. */
  forceRegister?: boolean;
}

/**
 * Builds the slash command JSON array from the loaded commands map.
 * Only commands exporting onCommand get a slash registration — onChat-only
 * commands (e.g. auto-responses) have no slash equivalent.
 */
function buildSlashCommandPayloads(
  commands: Map<string, Record<string, unknown>>,
  disabledNames?: Set<string>,
): ReturnType<InstanceType<typeof SlashCommandBuilder>['toJSON']>[] {
  const payloads: ReturnType<
    InstanceType<typeof SlashCommandBuilder>['toJSON']
  >[] = [];

  // loadCommands() registers one Map key per command name AND one per alias, all
  // pointing to the SAME module object — mirrors the dedupe in on-chat-runner.ts.
  // Without this guard, a module with N aliases registers N+1 separate top-level
  // Discord slash commands for what is really one command, which (a) clutters the
  // '/' menu with duplicate entries, (b) inflates the REST payload and per-guild
  // clear step in registerSlashCommands — directly extending the window before
  // attachEventHandlers is live, and (c) makes it far easier to blow past Discord's
  // 100-global-command cap once a "family" file with several aliased commands is
  // added. Only the canonical meta.name is registered; aliases keep working for
  // prefix-style invocation via the commands Map lookup in event-handlers.ts.
  const seen = new Set<Record<string, unknown>>();

  for (const mod of commands.values()) {
    if (seen.has(mod)) continue;
    seen.add(mod);

    if (typeof mod['onCommand'] !== 'function') continue;
    if (!isPlatformAllowed(mod, Platforms.Discord)) continue;

    const cfg = mod['meta'] as {
      name: string;
      description: string;
      options?: SlashOption[];
    };

    // Discord's displayed ('/') command list is intentionally restricted to the "help"
    // command only — every other command is still invocable via text prefix, it's simply
    // omitted from the displayed slash-command menu.
    if (cfg.name.toLowerCase() !== 'help') continue;

    // Exclude commands disabled by the bot admin
    if (disabledNames?.has(cfg.name.toLowerCase())) continue;

    const builder = new SlashCommandBuilder()
      .setName(truncate(cfg.name, 32)) // Discord hard limit safety
      .setDescription(truncate(cfg.description, 100));

    for (const opt of cfg.options ?? []) {
      if (opt.type === OptionType.string) {
        builder.addStringOption((o) =>
          o
            .setName(truncate(opt.name, 32))
            .setDescription(truncate(opt.description, 100))
            .setRequired(opt.required ?? false),
        );
      } else if (opt.type === OptionType.user) {
        // addUserOption renders a native Discord guild-member picker in the '/' menu
        // instead of a free-text field — Discord resolves the selection to a User object
        // whose .id is extracted downstream in event-handlers.ts via getUser()
        builder.addUserOption((o) =>
          o
            .setName(truncate(opt.name, 32))
            .setDescription(truncate(opt.description, 100))
            .setRequired(opt.required ?? false),
        );
      }
    }

    payloads.push(builder.toJSON());
  }

  return payloads;
}

/**
 * Registers or clears slash commands based on the active prefix, skipping the
 * REST round-trip when the DB shows the menu is already in the desired state.
 *
 * prefix='/'  → wipe per-guild commands (eliminate duplicates), then publish globally
 * prefix≠'/'  → wipe global commands so Discord's '/' menu stays clean
 */
export async function registerSlashCommands(
  options: SlashCommandOptions,
): Promise<void> {
  const {
    client,
    commands,
    prefix,
    clientId,
    token,
    userId,
    sessionId,
    sessionLogger,
    disabledNames,
    forceRegister,
  } = options;

  if (!clientId) {
    sessionLogger.warn(
      '[discord] ⚠️  CLIENT_ID not set — skipping slash command registration',
    );
    return;
  }

  const currentHash = computeCommandHash(commands);
  const credential = await findDiscordCredentialState(userId, sessionId);
  const rest = new REST().setToken(token);

  if (prefix === '/') {
    if (
      !forceRegister &&
      credential?.isCommandRegister &&
      credential?.commandHash === currentHash
    ) {
      sessionLogger.info(
        '[discord] Slash commands up-to-date (hash match) — skipping registration',
      );
      return;
    }

    const slashCommands = buildSlashCommandPayloads(commands, disabledNames);

    // Discord global command limit: 100 slash commands per bot (API v10 hard cap).
    // Attempting to PUT more than 100 entries returns HTTP 400 Bad Request — the entire
    // registration fails and Discord leaves the menu in whatever stale state it was before.
    // Pre-empt by clearing the menu (PUT []) and surfacing a loud warning so the developer
    // knows to either reduce their command count or switch to a non-slash prefix.
    if (slashCommands.length > DISCORD_SLASH_COMMAND_LIMIT) {
      sessionLogger.warn(
        `[discord] ⚠️  ${slashCommands.length} slash commands exceed the Discord global limit of ${DISCORD_SLASH_COMMAND_LIMIT} — clearing slash menu to prevent API errors. Reduce command count or switch to a non-'/' prefix.`,
      );
      try {
        await rest.put(Routes.applicationCommands(clientId), { body: [] });
        await updateDiscordCredentialCommandHash(userId, sessionId, {
          isCommandRegister: false,
          commandHash: currentHash,
        });
      } catch (clearErr) {
        sessionLogger.warn(
          '[discord] Failed to clear commands after limit exceeded (non-fatal)',
          { error: clearErr },
        );
      }
      return;
    }

    try {
      const guildIds = [...client.guilds.cache.keys()];
      if (guildIds.length > 0) {
        await Promise.all(
          guildIds.map((gid) =>
            rest.put(Routes.applicationGuildCommands(clientId, gid), {
              body: [],
            }),
          ),
        );
        sessionLogger.info(
          `[discord] Cleared guild-scoped commands from ${guildIds.length} guild(s)`,
        );
      }

      await rest.put(Routes.applicationCommands(clientId), {
        body: slashCommands,
      });
      sessionLogger.info(
        `[discord] Deployed ${slashCommands.length} global command(s)`,
      );

      await updateDiscordCredentialCommandHash(userId, sessionId, {
        isCommandRegister: true,
        commandHash: currentHash,
      });
    } catch (err) {
      sessionLogger.warn(
        '[discord] Slash command registration failed (non-fatal)',
        { error: err },
      );
    }
  } else {
    if (
      !forceRegister &&
      !credential?.isCommandRegister &&
      credential?.commandHash === currentHash
    ) {
      sessionLogger.info(
        `[discord] Slash commands already cleared (hash match) — skipping`,
      );
      return;
    }

    try {
      await rest.put(Routes.applicationCommands(clientId), { body: [] });
      sessionLogger.info(
        `[discord] Cleared global slash commands (prefix "${prefix}" ≠ "/"; slash menu disabled)`,
      );

      await updateDiscordCredentialCommandHash(userId, sessionId, {
        isCommandRegister: false,
        commandHash: currentHash,
      });
    } catch (err) {
      sessionLogger.warn(
        '[discord] Failed to clear global commands (non-fatal)',
        { error: err },
      );
    }
  }
}

/**
 * Clears guild-scoped commands in a newly joined guild.
 * Called on guildCreate to prevent visible duplicates with the global registration
 * — global commands are already present in new guilds immediately via the global PUT.
 */
export async function clearGuildCommands(
  guildId: string,
  clientId: string,
  token: string,
  sessionLogger: SessionLogger,
): Promise<void> {
  const rest = new REST().setToken(token);
  try {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
      body: [],
    });
    sessionLogger.info(
      `[discord] Cleared guild-scoped commands in new guild: ${guildId}`,
    );
  } catch (err) {
    sessionLogger.warn(
      `[discord] Failed to clear commands in new guild ${guildId}`,
      { error: err },
    );
  }
}
