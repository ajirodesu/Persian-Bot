/**
 * Restrict / Unrestrict — group-admin moderation pair (single file, config-driven)
 *
 * Same architecture as popcat-media.ts / popcat-text.ts: one CONFIGS table
 * declares each command's shape (its name, whether it restricts or lifts a
 * restriction, its description/usage), and one shared runRestriction()
 * dispatches on that config. Adding a related moderation command later means
 * appending one config object — no new onCommand function required.
 *
 * Commands:
 *   /restrict   — mutes a member (blocks sending messages/media) without
 *                 removing them from the group. Provide a user ID, mention
 *                 them, or reply to their message. Optionally add a duration
 *                 (e.g. 10m, 2h, 1d) — omit it to restrict indefinitely.
 *   /unrestrict — lifts a restriction, restoring default send permissions.
 *
 * ── Target resolution ─────────────────────────────────────────────────────
 * Priority (highest → lowest):
 *   1. ctx.options.get('user') — pre-resolved named option
 *   2. event.messageReply.senderID — reply to a message targets its author
 *   3. event.mentions — first @mention in a text-prefix message
 *   4. args[0] — raw ID typed by the user
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta, CommandOption } from '@/engine/types/module-config.types.js';

// ── Duration parsing (same convention as remind.ts: 5s, 10m, 2h, 1d) ──────────

const TIME_MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function parseDuration(str: string): number | null {
  const m = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!m) return null;
  const multiplier = TIME_MULTIPLIERS[m[2]!.toLowerCase()];
  if (multiplier === undefined) return null;
  const ms = parseInt(m[1]!, 10) * multiplier;
  return ms > 0 ? ms : null;
}

// ── Target resolution ─────────────────────────────────────────────────────────

function resolveTargetID(ctx: AppCtx): string | undefined {
  const optUser = ctx.options.get('user');
  if (optUser) return optUser;

  const reply = ctx.event['messageReply'] as Record<string, unknown> | undefined;
  const fromReply = reply?.['senderID'] as string | undefined;
  if (fromReply) return fromReply;

  const mentions = ctx.event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});
  if (mentionIDs.length > 0) return mentionIDs[0];

  return ctx.args[0];
}

function hasExplicitTarget(ctx: AppCtx): boolean {
  if (ctx.options.has('user')) return true;
  const reply = ctx.event['messageReply'] as Record<string, unknown> | undefined;
  const mentions = ctx.event['mentions'] as Record<string, string> | undefined;
  return Boolean(reply?.['senderID']) || Object.keys(mentions ?? {}).length > 0;
}

// ── Config ────────────────────────────────────────────────────────────────────

interface RestrictionConfig {
  name: string;
  restrict: boolean;
  label: string;
  description: string;
  usage: string;
}

const CONFIGS: RestrictionConfig[] = [
  {
    name: 'restrict',
    restrict: true,
    label: 'restricted',
    description:
      'Mute a member so they cannot send messages or media, without removing them from the group. Provide a user ID, mention them, or reply to their message. Optionally add a duration (e.g. 10m, 2h, 1d) — omit it to restrict indefinitely.',
    usage: '<uid | @mention | reply> [duration]',
  },
  {
    name: 'unrestrict',
    restrict: false,
    label: 'unrestricted',
    description:
      'Lift a restriction on a member, restoring their default ability to send messages and media. Provide a user ID, mention them, or reply to their message.',
    usage: '<uid | @mention | reply>',
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runRestriction(ctx: AppCtx, config: RestrictionConfig): Promise<void> {
  const { chat, api, bot, user, event, args } = ctx;

  if (!event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  const explicitTarget = hasExplicitTarget(ctx);
  const targetID = resolveTargetID(ctx);

  if (!targetID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Please provide a user ID, @mention the user, or reply to their message.',
    });
    return;
  }

  const botID = await bot.getID();
  if (targetID === botID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ I cannot ${config.name} myself.`,
    });
    return;
  }

  const senderID = event['senderID'] as string | undefined;
  if (targetID === senderID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ You cannot ${config.name} yourself.`,
    });
    return;
  }

  let durationArgs: string[];
  const namedDuration = ctx.options.get('duration');
  if (namedDuration !== undefined) {
    durationArgs = namedDuration ? [namedDuration] : [];
  } else {
    durationArgs = explicitTarget ? args : args.slice(1);
  }

  let durationMs: number | undefined;
  if (config.restrict && durationArgs.length > 0 && durationArgs[0]) {
    const parsed = parseDuration(durationArgs[0]);
    if (parsed === null) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Invalid duration. Use a format like `10m`, `2h`, or `1d`.',
      });
      return;
    }
    durationMs = parsed;
  }

  const userName = await user.getName(targetID);
  const threadID = event['threadID'] as string;

  try {
    if (config.restrict) {
      await api.restrictUser(threadID, targetID, durationMs);
      const durationNote = durationMs ? ` for **${durationArgs[0]}**` : ' indefinitely';
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `✅ **${userName}** has been ${config.label}${durationNote}.`,
      });
    } else {
      await api.unrestrictUser(threadID, targetID);
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `✅ **${userName}** has been ${config.label}.`,
      });
    }
  } catch {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Failed to ${config.name} ${userName}. Ensure I have admin privileges in this group.`,
    });
  }
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

function buildOptions(config: RestrictionConfig): CommandOption[] {
  const options: CommandOption[] = [
    {
      type: OptionType.user,
      name: 'user',
      description: `User to ${config.name}`,
      required: true,
    },
  ];

  if (config.restrict) {
    options.push({
      type: OptionType.string,
      name: 'duration',
      description: 'Optional duration (e.g. 10m, 2h, 1d) — omit for indefinite',
      required: false,
    });
  }

  return options;
}

export const commands: CommandEntry[] = CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: [] as string[],
    version: '1.0.0',
    role: Role.THREAD_ADMIN,
    author: 'AjiroDesu',
    description: config.description,
    category: 'Thread Admin',
    usage: config.usage,
    cooldown: 5,
    hasPrefix: true,
    platform: [Platforms.Telegram],
    options: buildOptions(config),
  },
  onCommand: async (ctx: AppCtx) => runRestriction(ctx, config),
}));