/**
 * Restriction Service — shared implementation for /restrict and /unrestrict.
 *
 * Both commands resolve the same target (named option → reply → mention →
 * positional ID), validate that the target is neither the bot nor the caller,
 * and delegate to UnifiedApi's restrictUser/unrestrictUser. Only the direction
 * of the operation and its user-facing copy differ.
 */

import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

export interface RestrictionConfig {
  /** Canonical command name — used verbatim in self-target error copy. */
  name: string;
  /** True for /restrict, false for /unrestrict. */
  restrict: boolean;
  /** Past-tense label used in the success message ("restricted"/"unrestricted"). */
  label: string;
}

// ── Duration parsing (same convention as remind.ts: 5s, 10m, 2h, 1d) ──────────

const TIME_MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

function parseDuration(str: string): number | null {
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const multiplier = TIME_MULTIPLIERS[match[2]!.toLowerCase()];
  if (multiplier === undefined) return null;
  const ms = parseInt(match[1]!, 10) * multiplier;
  return ms > 0 ? ms : null;
}

// ── Target resolution ─────────────────────────────────────────────────────────

function resolveTargetID(ctx: AppCtx): string | undefined {
  const optUser = ctx.options.get('user');
  if (optUser) return optUser;

  const reply = ctx.event['messageReply'] as
    Record<string, unknown> | undefined;
  const fromReply = reply?.['senderID'] as string | undefined;
  if (fromReply) return fromReply;

  const mentions = ctx.event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});
  if (mentionIDs.length > 0) return mentionIDs[0];

  return ctx.args[0];
}

function hasExplicitTarget(ctx: AppCtx): boolean {
  if (ctx.options.has('user')) return true;
  const reply = ctx.event['messageReply'] as
    Record<string, unknown> | undefined;
  const mentions = ctx.event['mentions'] as Record<string, string> | undefined;
  return Boolean(reply?.['senderID']) || Object.keys(mentions ?? {}).length > 0;
}

/** Runs the shared /restrict and /unrestrict flow. */
export async function runRestriction(
  ctx: AppCtx,
  config: RestrictionConfig,
): Promise<void> {
  const { chat, api, bot, user, event, args, usage } = ctx;

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
    await usage();
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
      const durationNote = durationMs
        ? ` for **${durationArgs[0]}**`
        : ' indefinitely';
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
