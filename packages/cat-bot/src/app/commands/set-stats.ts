/**
 * /setmoney + /setexp — Direct Coin/EXP Balance Override (Bot Admin)
 *
 * Merged multi-command family (single file, config-driven). Both commands are
 * structurally identical — same five sub-command shapes, same DB-collection
 * read/create/write dance, same argument parsing — and differ only in which
 * collection/field they touch and how the amount is formatted, so one
 * STAT_CONFIGS table + one shared runSetStat() covers both. Adding a third
 * "set-a-numeric-user-stat" admin command later means appending one config
 * object, no new onCommand function required.
 *
 * Sub-commands (identical shape for both /setmoney and /setexp):
 *   set___ me <amount>         — set own stat to an exact value
 *   set___ del me              — reset own stat to 0 (other keys in the
 *                                 collection, e.g. lastClaim/streak, survive)
 *   set___ del @mention        — reset a @mentioned user's stat to 0
 *   set___ @mention <amount>   — set a @mentioned user's stat to an exact value
 *   set___ uid <id> <amount>   — set stat by raw platform user ID (works even
 *                                 when the target has left the thread)
 *
 * Storage contracts:
 *   /setmoney → bot_users_session.data → 'money' → { coins: number }
 *               same key read by /balance's button handler and by
 *               currencies.getMoney() — changes are immediately visible
 *               there. Supports "infinity"/"∞" for unlimited coins, stored
 *               via the INFINITY_SENTINEL string (JSON can't encode Infinity).
 *   /setexp   → bot_users_session.data → 'xp' → { exp: number }
 *               same collection read by /rank and written by /rankup onChat
 *               — changes are immediately reflected in rank cards and
 *               level-up notifications. No infinity support (EXP is always
 *               a finite integer).
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand }>` and registers each entry
 * exactly like a standalone command module.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { INFINITY_SENTINEL, formatCoins } from '@/engine/lib/currencies.lib.js';

// ── Config ────────────────────────────────────────────────────────────────────

interface StatConfig {
  name: string;
  description: string;
  /** bot_users_session collection name this stat lives in (e.g. "money", "xp"). */
  collectionName: string;
  /** Field key within that collection (e.g. "coins", "exp"). */
  fieldKey: string;
  /** Whether "infinity"/"∞" is accepted as an amount (money only). */
  allowInfinity: boolean;
  /** Formats a numeric amount for display (formatCoins adds "coins"/∞ handling; EXP is a plain localized number). */
  formatAmount: (amount: number) => string;
  /** Confirmation copy — kept per-config so each command's exact original wording survives the merge. */
  messages: {
    setSelf: (formatted: string) => string;
    setMention: (name: string, formatted: string) => string;
    setUid: (name: string, formatted: string) => string;
    delSelf: (formattedRemoved: string) => string[];
    delMention: (name: string, formattedRemoved: string) => string[];
  };
}

const STAT_CONFIGS: StatConfig[] = [
  {
    name: 'setmoney',
    description:
      'Set the coin balance of yourself, a @mentioned user, or a user by ID. Use "infinity" for ∞ coins.',
    collectionName: 'money',
    fieldKey: 'coins',
    allowInfinity: true,
    formatAmount: formatCoins,
    messages: {
      setSelf: (formatted) => `✅ Set your balance to **${formatted}** coins.`,
      setMention: (name, formatted) => `✅ Set **${name}**'s balance to **${formatted}** coins.`,
      setUid: (name, formatted) => `✅ Set balance of **${name}** to **${formatted}** coins.`,
      delSelf: (removed) => ['✅ Removed all your coins.', `💸 Coins removed: **${removed}**`],
      delMention: (name, removed) => [
        `✅ Removed all coins of **${name}**.`,
        `💸 Coins removed: **${removed}**`,
      ],
    },
  },
  {
    name: 'setexp',
    description: 'Set the EXP of yourself, a @mentioned user, or a user by ID',
    collectionName: 'xp',
    fieldKey: 'exp',
    allowInfinity: false,
    formatAmount: (amount) => amount.toLocaleString(),
    messages: {
      setSelf: (formatted) => `✅ Set your EXP to **${formatted}**.`,
      setMention: (name, formatted) => `✅ Set **${name}**'s EXP to **${formatted}**.`,
      setUid: (name, formatted) => `✅ Set EXP of **${name}** to **${formatted}**.`,
      delSelf: (removed) => ['✅ Removed all your EXP.', `📊 EXP removed: **${removed}**`],
      delMention: (name, removed) => [
        `✅ Removed all EXP of **${name}**.`,
        `📊 EXP removed: **${removed}**`,
      ],
    },
  },
];

// ── Amount parsing / storage helpers ─────────────────────────────────────────

/**
 * Parses an amount from a raw argument slot. Accepts "infinity"/"∞"
 * (case-insensitive) only when the config allows it. Returns NaN when the
 * slot is absent or non-numeric — callers check isNaN() to prevent
 * malformed input from silently writing 0 to someone's stat.
 */
function parseAmount(raw: string | undefined, allowInfinity: boolean): number {
  if (raw === undefined) return NaN;
  if (allowInfinity && (raw.toLowerCase() === 'infinity' || raw === '∞')) return Infinity;
  return parseInt(raw, 10);
}

/** Converts a parsed amount into its storage representation (Infinity needs the sentinel string). */
function toStorageValue(amount: number, allowInfinity: boolean): number | string {
  return allowInfinity && amount === Infinity ? INFINITY_SENTINEL : amount;
}

/** Reads a stored value back out as a number, resolving the infinity sentinel when applicable. */
function fromStorageValue(raw: unknown, allowInfinity: boolean): number {
  if (allowInfinity && raw === INFINITY_SENTINEL) return Infinity;
  return typeof raw === 'number' ? raw : 0;
}

// ── Shared handler ────────────────────────────────────────────────────────────

async function runSetStat(ctx: AppCtx, config: StatConfig): Promise<void> {
  const { chat, event, args, db, user, prefix = '' } = ctx;
  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});
  const sub = args[0]?.toLowerCase();

  const amountUsage = config.allowInfinity ? '<amount|infinity>' : '<amount>';

  // ── set___ me <amount> ──────────────────────────────────────────────────
  if (sub === 'me') {
    const senderID = event['senderID'] as string | undefined;
    const amount = parseAmount(args[1], config.allowInfinity);

    if (!senderID || isNaN(amount)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: \`${prefix}${config.name} me ${amountUsage}\``,
      });
      return;
    }

    const userColl = db.users.collection(senderID);
    if (!(await userColl.isCollectionExist(config.collectionName))) {
      await userColl.createCollection(config.collectionName);
    }
    const stat = await userColl.getCollection(config.collectionName);
    await stat.set(config.fieldKey, toStorageValue(amount, config.allowInfinity));

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: config.messages.setSelf(config.formatAmount(amount)),
    });
    return;
  }

  // ── set___ del me | set___ del @mention ───────────────────────────────
  if (sub === 'del') {
    const delTarget = args[1]?.toLowerCase();

    // set___ del me
    if (delTarget === 'me') {
      const senderID = event['senderID'] as string | undefined;
      if (!senderID) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: '❌ Could not identify your user ID on this platform.',
        });
        return;
      }

      const userColl = db.users.collection(senderID);
      if (!(await userColl.isCollectionExist(config.collectionName))) {
        await userColl.createCollection(config.collectionName);
      }
      const stat = await userColl.getCollection(config.collectionName);
      const raw = await stat.get(config.fieldKey);
      const current = fromStorageValue(raw, config.allowInfinity);
      await stat.set(config.fieldKey, 0);

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: config.messages.delSelf(config.formatAmount(current)).join('\n'),
      });
      return;
    }

    // set___ del @mention
    if (mentionIDs.length === 1) {
      // Non-null assertion safe: length check above guarantees index 0 exists
      const mentionID = mentionIDs[0]!;
      const displayName = (mentions?.[mentionID] ?? mentionID).replace(/^@/, '');

      const userColl = db.users.collection(mentionID);
      if (!(await userColl.isCollectionExist(config.collectionName))) {
        await userColl.createCollection(config.collectionName);
      }
      const stat = await userColl.getCollection(config.collectionName);
      const raw = await stat.get(config.fieldKey);
      const current = fromStorageValue(raw, config.allowInfinity);
      await stat.set(config.fieldKey, 0);

      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: config.messages.delMention(displayName, config.formatAmount(current)).join('\n'),
      });
      return;
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Usage: \`${prefix}${config.name} del me\` or \`${prefix}${config.name} del @mention\``,
    });
    return;
  }

  // ── set___ uid <id> <amount> ────────────────────────────────────────────
  if (sub === 'uid') {
    const targetID = args[1];
    const amount = parseAmount(args[2], config.allowInfinity);

    if (!targetID || isNaN(amount)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: \`${prefix}${config.name} uid <id> ${amountUsage}\``,
      });
      return;
    }

    const name = await user.getName(targetID);
    const userColl = db.users.collection(targetID);
    if (!(await userColl.isCollectionExist(config.collectionName))) {
      await userColl.createCollection(config.collectionName);
    }
    const stat = await userColl.getCollection(config.collectionName);
    await stat.set(config.fieldKey, toStorageValue(amount, config.allowInfinity));

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: config.messages.setUid(name, config.formatAmount(amount)),
    });
    return;
  }

  // ── set___ @mention <amount> ────────────────────────────────────────────
  // Amount is always the last token — the @mention string occupies earlier arg
  // slots depending on how the platform's parser serialises the mention text.
  if (mentionIDs.length === 1) {
    const mentionID = mentionIDs[0]!;
    const displayName = (mentions?.[mentionID] ?? mentionID).replace(/^@/, '');
    // args[args.length - 1] is string | undefined with noUncheckedIndexedAccess
    const amount = parseAmount(args[args.length - 1], config.allowInfinity);

    if (isNaN(amount)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: \`${prefix}${config.name} @mention ${amountUsage}\``,
      });
      return;
    }

    const userColl = db.users.collection(mentionID);
    if (!(await userColl.isCollectionExist(config.collectionName))) {
      await userColl.createCollection(config.collectionName);
    }
    const stat = await userColl.getCollection(config.collectionName);
    await stat.set(config.fieldKey, toStorageValue(amount, config.allowInfinity));

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: config.messages.setMention(displayName, config.formatAmount(amount)),
    });
    return;
  }

  // ── Fallback: no matching sub-command ────────────────────────────────────
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: [
      '❌ Wrong syntax. Available sub-commands:',
      `\`${prefix}${config.name} me ${amountUsage}\``,
      `\`${prefix}${config.name} del me\``,
      `\`${prefix}${config.name} del @mention\``,
      `\`${prefix}${config.name} @mention ${amountUsage}\``,
      `\`${prefix}${config.name} uid <id> ${amountUsage}\``,
    ].join('\n'),
  });
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = STAT_CONFIGS.map((config) => {
  const amountUsage = config.allowInfinity ? '<amount|infinity>' : '<amount>';

  return {
    meta: {
      name: config.name,
      aliases: [] as string[],
      version: '1.0.0',
      // BOT_ADMIN — direct stat mutation bypasses the earn-through-play contract;
      // lower privilege would let anyone print unlimited coins/EXP.
      role: Role.BOT_ADMIN,
      author: 'System',
      description: config.description,
      category: 'Bot Admin',
      usage: `me ${amountUsage} | del me | del @mention | @mention ${amountUsage} | uid <id> ${amountUsage}`,
      cooldown: 5,
      hasPrefix: true,
      options: [
        {
          type: OptionType.string,
          name: 'action',
          description: `me <amount> | del me | del @mention | @mention <amount> | uid <id> <amount>`,
          required: true,
        },
        {
          type: OptionType.string,
          name: 'value',
          description: 'Amount or target user ID (context-dependent)',
          required: false,
        },
      ],
    },
    onCommand: async (ctx: AppCtx) => runSetStat(ctx, config),
  };
});