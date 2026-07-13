/**
 * /rankup — Passive EXP System + Per-Thread Level-Up Notifications
 *
 * Responsibilities:
 *   onChat    — fires on EVERY message (passive XP accumulation)
 *               +1 EXP per message; notifies the thread when a user levels up,
 *               if rankup notifications are enabled for that thread.
 *
 *   onCommand — /rankup [on | off]
 *               on / off — toggle level-up notifications (THREAD_ADMIN only).
 *
 * EXP collection schema (bot_users_session.data → "xp" key):
 *   { exp: number }  — raw accumulated experience points
 *
 * Thread settings schema (bot_threads_session.data → "rankup_settings" key):
 *   { enabled: boolean }  — defaults to true when key is absent (fail-open)
 *
 * The same DELTA_NEXT and level formula used here must match rank.ts.
 * Extract to a shared utility if additional economy commands are added.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { fetchRankupCanvas, normalizeCanvasPlatform } from '@/engine/lib/aqua-canvas.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Must match the constant in rank.ts — controls EXP-to-level curve. */
const DELTA_NEXT = 5;

/** Name of the collection inside bot_threads_session.data for rankup settings. */
const SETTINGS_COLLECTION = 'rankup_settings';

// ─── Level Maths ──────────────────────────────────────────────────────────────

/** Converts raw EXP to a level number. Mirrors rank.ts implementation. */
function expToLevel(exp: number): number {
  if (exp <= 0) return 0;
  return Math.floor((1 + Math.sqrt(1 + (8 * exp) / DELTA_NEXT)) / 2);
}

/** Minimum EXP required to reach a specific level. Mirrors rank.ts implementation. */
function levelToExp(level: number): number {
  if (level <= 0) return 0;
  return Math.floor(((level * level - level) * DELTA_NEXT) / 2);
}

/**
 * Computes a user's 1-indexed leaderboard position by EXP. Mirrors rank.ts's
 * full-scan approach — only invoked here on an actual level-up (rare
 * relative to onChat's per-message frequency), so the extra query is cheap
 * in aggregate. Fail-open: returns 1 if the session query fails.
 */
async function getLeaderboardRank(
  db: AppCtx['db'],
  targetID: string,
): Promise<number> {
  try {
    const allSessions = await db.users.getAll();
    const leaderboard = allSessions
      .map(({ botUserId, data }) => {
        const xpData = data?.['xp'] as Record<string, unknown> | undefined;
        const userExp =
          xpData && typeof xpData['exp'] === 'number' ? (xpData['exp'] as number) : 0;
        return { botUserId, exp: userExp };
      })
      .sort((a, b) => b.exp - a.exp);

    const pos = leaderboard.findIndex((u) => u.botUserId === targetID);
    return pos === -1 ? 1 : pos + 1;
  } catch {
    return 1;
  }
}

// ─── Module Config ────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'rankup',
  aliases: [] as string[],
  version: '1.1.0',
  role: Role.THREAD_ADMIN,
  author: 'John Lester',
  description:
    'Toggle level-up notifications for this thread (on/off). Gains EXP passively on every message.',
  category: 'Economy',
  usage: '[on | off]',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'action',
      description: 'Toggle state: "on" or "off"',
      required: false,
    },
  ],
};

// ─── Passive EXP (onChat) ─────────────────────────────────────────────────────

/**
 * Passive EXP accumulator — runs for every message before command dispatch.
 *
 * Reads current EXP, increments by 1, writes back. If the new EXP crosses a
 * level boundary AND rankup notifications are enabled for this thread, sends a
 * plain congratulation text message.
 */
export const onChat = async ({ event, db, chat, api, native }: AppCtx): Promise<void> => {
  const senderID = event['senderID'] as string | undefined;
  const threadID = event['threadID'] as string | undefined;
  if (!senderID || !threadID) return;

  const userColl = db.users.collection(senderID);

  try {
    if (!(await userColl.isCollectionExist('xp'))) {
      await userColl.createCollection('xp');
    }

    const xpColl = await userColl.getCollection('xp');
    const oldExp = ((await xpColl.get('exp')) as number | undefined) ?? 0;
    const newExp = oldExp + 1;

    // Write before any notification so EXP is durable even if message.send fails.
    await xpColl.set('exp', newExp);

    const oldLevel = expToLevel(oldExp);
    const newLevel = expToLevel(newExp);
    if (newLevel <= oldLevel || newLevel <= 1) return;

    // Read thread setting — fail-open: treat any error as enabled=true
    let rankupEnabled = true;
    try {
      const threadColl = db.threads.collection(threadID);
      if (await threadColl.isCollectionExist(SETTINGS_COLLECTION)) {
        const settings = await threadColl.getCollection(SETTINGS_COLLECTION);
        rankupEnabled = ((await settings.get('enabled')) as boolean | undefined) ?? true;
      }
    } catch {
      rankupEnabled = true;
    }

    if (!rankupEnabled) return;

    const name = await db.users.getName(senderID);
    const congratsMessage = `🎉 Congratulations **${name}**! You reached **level ${newLevel}**!`;

    // Try the canvas rankup card first (Discord/Telegram only); fall back to
    // the plain-text notification on unsupported platforms or any failure —
    // EXP tracking + notification must never break because the image did.
    const canvasPlatform = normalizeCanvasPlatform(native.platform);

    if (canvasPlatform) {
      try {
        const avatar = await api.getAvatarUrl(senderID);

        if (avatar) {
          const currentBase = levelToExp(newLevel);
          const nextBase = levelToExp(newLevel + 1);
          const rank = await getLeaderboardRank(db, senderID);

          const { buffer, ext } = await fetchRankupCanvas({
            platform: canvasPlatform,
            avatar,
            username: name,
            level: newLevel,
            previousLevel: oldLevel,
            xpText: `${newExp - currentBase} / ${nextBase - currentBase} XP`,
            rank,
          });

          await chat.replyMessage({
            style: MessageStyle.MARKDOWN,
            message: congratsMessage,
            attachment: [{ name: `rankup.${ext}`, stream: buffer }],
          });
          return;
        }
      } catch (err) {
        logger.warn('[rankup] Canvas card failed, falling back to text', {
          senderID,
          platform: native.platform,
          error: err,
        });
      }
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: congratsMessage,
    });
  } catch {
    // Swallow all errors — EXP accumulation must never disrupt normal chat flow
  }
};

// ─── Button handlers ──────────────────────────────────────────────────────────

const BUTTON_ID = { my_level: 'my_level', back: 'back' } as const;

export const button = {
  [BUTTON_ID.my_level]: {
    label: '📊 My Level',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event, db, native, button }: AppCtx) => {
      const senderID = event['senderID'] as string | undefined;
      const backId = button.generateID({ id: BUTTON_ID.back });

      if (!senderID) {
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: event['messageID'] as string,
          message: '❌ Could not identify your user ID on this platform.',
          ...(hasNativeButtons(native.platform) ? { button: [backId] } : {}),
        });
        return;
      }

      const userColl = db.users.collection(senderID);
      let exp = 0;

      if (await userColl.isCollectionExist('xp')) {
        const xpColl = await userColl.getCollection('xp');
        const rawExp = await xpColl.get('exp');
        exp = typeof rawExp === 'number' ? rawExp : 0;
      }

      const level = expToLevel(exp);

      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: `⭐ **Level ${level}** — ${exp} total EXP`,
        ...(hasNativeButtons(native.platform) ? { button: [backId] } : {}),
      });
    },
  },
  [BUTTON_ID.back]: {
    label: '⬅ Back',
    style: ButtonStyle.SECONDARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ─── Command handler (onCommand) ─────────────────────────────────────────────

/**
 * Handles /rankup [on | off]
 *
 *   on / off — toggle rank-up notifications for the current thread (THREAD_ADMIN).
 *   (none)   — shows current setting + 📊 My Level button.
 */
export const onCommand = async ({
  chat,
  args,
  event,
  db,
  native,
  prefix = '',
  button,
}: AppCtx): Promise<void> => {
  const threadID = event['threadID'] as string | undefined;

  if (!threadID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in a thread.',
    });
    return;
  }

  const sub = args[0]?.toLowerCase();

  // ── /rankup on | off ──────────────────────────────────────────────────────
  if (sub === 'on' || sub === 'off') {
    const enabled = sub === 'on';
    const threadColl = db.threads.collection(threadID);

    if (!(await threadColl.isCollectionExist(SETTINGS_COLLECTION))) {
      await threadColl.createCollection(SETTINGS_COLLECTION);
    }

    const settings = await threadColl.getCollection(SETTINGS_COLLECTION);
    await settings.set('enabled', enabled);

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: enabled
        ? '✅ Rankup notifications enabled for this thread.'
        : '🔕 Rankup notifications disabled for this thread.',
    });
    return;
  }

  // ── /rankup (no argument) — status display ────────────────────────────────
  let current = true;
  try {
    const threadColl = db.threads.collection(threadID);
    if (await threadColl.isCollectionExist(SETTINGS_COLLECTION)) {
      const settings = await threadColl.getCollection(SETTINGS_COLLECTION);
      current = ((await settings.get('enabled')) as boolean | undefined) ?? true;
    }
  } catch {
    current = true;
  }

  const payload = {
    style: MessageStyle.MARKDOWN,
    message: [
      `Rankup notifications are currently ${current ? '✅ on' : '🔕 off'} for this thread.`,
      `Usage: \`${prefix}rankup on | off\``,
    ].join('\n'),
    ...(hasNativeButtons(native.platform)
      ? { button: [button.generateID({ id: BUTTON_ID.my_level })] }
      : {}),
  };

  if (event['type'] === 'button_action') {
    await chat.editMessage({
      ...payload,
      message_id_to_edit: event['messageID'] as string,
    });
  } else {
    await chat.replyMessage(payload);
  }
};