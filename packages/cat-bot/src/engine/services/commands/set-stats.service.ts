/**
 * Set Stats Service — shared implementation for /setmoney and /setexp.
 *
 * Both commands are structurally identical — same five sub-command shapes,
 * same DB-collection read/create/write dance, same argument parsing — and
 * differ only in which collection/field they touch and how the amount is
 * formatted. One StatConfig table + one runSetStat() covers both.
 *
 * Sub-commands (identical shape for both commands):
 *   set___ me <amount>         — set own stat to an exact value
 *   set___ del me              — reset own stat to 0
 *   set___ del @mention        — reset a @mentioned user's stat to 0
 *   set___ @mention <amount>   — set a @mentioned user's stat to an exact value
 *   set___ uid <id> <amount>   — set stat by raw platform user ID
 */

import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { INFINITY_SENTINEL, formatCoins } from '@/engine/lib/currencies.lib.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

export interface StatConfig {
  name: string;
  /** bot_users_session collection name this stat lives in (e.g. "money", "xp"). */
  collectionName: string;
  /** Field key within that collection (e.g. "coins", "exp"). */
  fieldKey: string;
  /** Whether "infinity"/"∞" is accepted as an amount (money only). */
  allowInfinity: boolean;
  /** Formats a numeric amount for display. */
  formatAmount: (amount: number) => string;
  messages: {
    setSelf: (formatted: string) => string;
    setMention: (name: string, formatted: string) => string;
    setUid: (name: string, formatted: string) => string;
    delSelf: (formattedRemoved: string) => string[];
    delMention: (name: string, formattedRemoved: string) => string[];
  };
}

function parseAmount(raw: string | undefined, allowInfinity: boolean): number {
  if (raw === undefined) return NaN;
  if (allowInfinity && (raw.toLowerCase() === 'infinity' || raw === '∞'))
    return Infinity;
  return parseInt(raw, 10);
}

function toStorageValue(
  amount: number,
  allowInfinity: boolean,
): number | string {
  return allowInfinity && amount === Infinity ? INFINITY_SENTINEL : amount;
}

function fromStorageValue(raw: unknown, allowInfinity: boolean): number {
  if (allowInfinity && raw === INFINITY_SENTINEL) return Infinity;
  return typeof raw === 'number' ? raw : 0;
}

/** Runs the shared /setmoney and /setexp flow. */
export async function runSetStat(
  ctx: AppCtx,
  config: StatConfig,
): Promise<void> {
  const { chat, event, args, db, user, usage } = ctx;
  const mentions = event['mentions'] as Record<string, string> | undefined;
  const mentionIDs = Object.keys(mentions ?? {});
  const sub = args[0]?.toLowerCase();

  // ── set___ me <amount> ──────────────────────────────────────────────────
  if (sub === 'me') {
    const senderID = event['senderID'] as string | undefined;
    const amount = parseAmount(args[1], config.allowInfinity);

    if (!senderID || isNaN(amount)) {
      await usage();
      return;
    }

    const userColl = db.users.collection(senderID);
    if (!(await userColl.isCollectionExist(config.collectionName))) {
      await userColl.createCollection(config.collectionName);
    }
    const stat = await userColl.getCollection(config.collectionName);
    await stat.set(
      config.fieldKey,
      toStorageValue(amount, config.allowInfinity),
    );

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
        message: config.messages
          .delSelf(config.formatAmount(current))
          .join('\n'),
      });
      return;
    }

    // set___ del @mention
    if (mentionIDs.length === 1) {
      const mentionID = mentionIDs[0]!;
      const displayName = (mentions?.[mentionID] ?? mentionID).replace(
        /^@/,
        '',
      );

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
        message: config.messages
          .delMention(displayName, config.formatAmount(current))
          .join('\n'),
      });
      return;
    }

    await usage();
    return;
  }

  // ── set___ uid <id> <amount> ────────────────────────────────────────────
  if (sub === 'uid') {
    const targetID = args[1];
    const amount = parseAmount(args[2], config.allowInfinity);

    if (!targetID || isNaN(amount)) {
      await usage();
      return;
    }

    const name = await user.getName(targetID);
    const userColl = db.users.collection(targetID);
    if (!(await userColl.isCollectionExist(config.collectionName))) {
      await userColl.createCollection(config.collectionName);
    }
    const stat = await userColl.getCollection(config.collectionName);
    await stat.set(
      config.fieldKey,
      toStorageValue(amount, config.allowInfinity),
    );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: config.messages.setUid(name, config.formatAmount(amount)),
    });
    return;
  }

  // ── set___ @mention <amount> ────────────────────────────────────────────
  if (mentionIDs.length === 1) {
    const mentionID = mentionIDs[0]!;
    const displayName = (mentions?.[mentionID] ?? mentionID).replace(/^@/, '');
    const amount = parseAmount(args[args.length - 1], config.allowInfinity);

    if (isNaN(amount)) {
      await usage();
      return;
    }

    const userColl = db.users.collection(mentionID);
    if (!(await userColl.isCollectionExist(config.collectionName))) {
      await userColl.createCollection(config.collectionName);
    }
    const stat = await userColl.getCollection(config.collectionName);
    await stat.set(
      config.fieldKey,
      toStorageValue(amount, config.allowInfinity),
    );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: config.messages.setMention(
        displayName,
        config.formatAmount(amount),
      ),
    });
    return;
  }

  await usage();
}

export const setMoneyConfig: StatConfig = {
  name: 'setmoney',
  collectionName: 'money',
  fieldKey: 'coins',
  allowInfinity: true,
  formatAmount: formatCoins,
  messages: {
    setSelf: (formatted) => `✅ Set your balance to **${formatted}** dollars.`,
    setMention: (name, formatted) =>
      `✅ Set **${name}**'s balance to **${formatted}** dollars.`,
    setUid: (name, formatted) =>
      `✅ Set balance of **${name}** to **${formatted}** dollars.`,
    delSelf: (removed) => [
      '✅ Removed all your dollars.',
      `💸 Dollars removed: **${removed}**`,
    ],
    delMention: (name, removed) => [
      `✅ Removed all dollars of **${name}**.`,
      `💸 Dollars removed: **${removed}**`,
    ],
  },
};

export const setExpConfig: StatConfig = {
  name: 'setexp',
  collectionName: 'xp',
  fieldKey: 'exp',
  allowInfinity: false,
  formatAmount: (amount) => amount.toLocaleString(),
  messages: {
    setSelf: (formatted) => `✅ Set your EXP to **${formatted}**.`,
    setMention: (name, formatted) =>
      `✅ Set **${name}**'s EXP to **${formatted}**.`,
    setUid: (name, formatted) =>
      `✅ Set EXP of **${name}** to **${formatted}**.`,
    delSelf: (removed) => [
      '✅ Removed all your EXP.',
      `📊 EXP removed: **${removed}**`,
    ],
    delMention: (name, removed) => [
      `✅ Removed all EXP of **${name}**.`,
      `📊 EXP removed: **${removed}**`,
    ],
  },
};
