/**
 * antispam.ts — Auto-Moderation: Message Flood (Spam) Protection
 *
 * Subcommands:
 *   antispam set <count>   — Set the message-flood threshold (admin only)
 *   antispam on            — Enable spam enforcement in this group (admin only)
 *   antispam off           — Disable spam enforcement in this group (admin only)
 *
 * onChat:
 *   Passively watches every GROUP message when enforcement is enabled. Uses a
 *   sliding time window (see antispam-tracker.lib.ts, ANTISPAM_WINDOW_MS) to
 *   count how many messages a user has sent recently. Once a user's count
 *   within that window reaches the configured threshold, they are
 *   automatically kicked from the group.
 *
 * DB schema (db.threads.collection(threadID) → 'antispam' collection):
 *   {
 *     enabled:   boolean  — enforcement toggle (default false)
 *     threshold: number   — message count within the sliding window that triggers a kick
 *   }
 *
 * Design notes:
 *   - Thread admins, bot admins, and system admins are always exempt from the
 *     scanner (mirrors badwords.ts's isPrivilegedUser guard), so moderators can
 *     never be auto-kicked while actively moderating a busy thread.
 *   - Rate tracking lives in-memory (antispam-tracker.lib.ts) rather than the
 *     DB — it's a high-frequency, ephemeral signal, and per-message DB writes
 *     for a value that resets every ANTISPAM_WINDOW_MS would be wasteful.
 *   - Tracking is reset after every kick attempt, success or failure, so a
 *     permission failure doesn't retry (and re-notify) on the user's very
 *     next message — they get a fresh window instead.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { kickRegistry } from '@/engine/lib/kick-registry.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import {
  recordMessageAndCheckSpam,
  resetSpamTracking,
  ANTISPAM_WINDOW_MS,
} from '@/engine/lib/antispam-tracker.lib.js';

// ── Config ──────────────────────────────────────────────────────────────────

/** Fallback threshold used by `on` when `set` has never been run for this thread. */
const DEFAULT_THRESHOLD = 20;
/** Sanity bounds for `set <count>` — guards against 0/negative (instant-kick) or absurd values. */
const MIN_THRESHOLD = 3;
const MAX_THRESHOLD = 100;

const windowSeconds = Math.round(ANTISPAM_WINDOW_MS / 1000);

export const meta: CommandMeta = {
  name: 'antispam',
  version: '1.0.0',
  role: Role.ANYONE, // per-subcommand admin gate is inside onCommand
  author: 'System',
  description: `Auto-kick members who send too many messages in a short time (${windowSeconds}s window).`,
  category: 'Thread Admin',
  usage: [
    `set <count> — Set the message-flood threshold (${MIN_THRESHOLD}-${MAX_THRESHOLD}, admin only)`,
    'on — Enable spam enforcement (admin only)',
    'off — Disable spam enforcement (admin only)',
  ],
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'action',
      description: 'Subcommand: set, on, off',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'value',
      description: 'Threshold count (only used with "set")',
      required: false,
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Best-effort thread-admin check via thread.getInfo(). */
async function isThreadAdmin(
  thread: AppCtx['thread'],
  senderID: string,
): Promise<boolean> {
  try {
    const info = (await thread.getInfo()) as unknown as Record<string, unknown>;
    const adminIDs = info['adminIDs'] as
      | Array<string | { uid: string }>
      | undefined;
    if (!Array.isArray(adminIDs)) return false;
    return adminIDs.some(
      (a) => (typeof a === 'string' ? a : a.uid) === senderID,
    );
  } catch {
    return false;
  }
}

/** True if the sender is a thread admin, bot admin, OR system admin. */
async function isPrivilegedUser(
  thread: AppCtx['thread'],
  native: AppCtx['native'],
  senderID: string,
): Promise<boolean> {
  if (await isSystemAdmin(senderID)) return true;
  const { userId, platform, sessionId } = native;
  if (userId && platform && sessionId) {
    if (await isBotAdmin(userId, platform, sessionId, senderID)) return true;
  }
  return isThreadAdmin(thread, senderID);
}

/** Returns (and lazily creates) the 'antispam' collection handle for a thread. */
async function getAntispamHandle(db: AppCtx['db'], threadID: string) {
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('antispam'))) {
    await coll.createCollection('antispam');
    const fresh = await coll.getCollection('antispam');
    await fresh.set('enabled', false);
    await fresh.set('threshold', DEFAULT_THRESHOLD);
    return fresh;
  }
  return await coll.getCollection('antispam');
}

// ── onCommand ─────────────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  thread,
  event,
  args,
  db,
  usage,
  native,
}: AppCtx): Promise<void> => {
  const threadID = event['threadID'] as string;
  const senderID = event['senderID'] as string;
  const sub = args[0]?.toLowerCase();

  if (!event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  const handle = await getAntispamHandle(db, threadID);

  // ── set ────────────────────────────────────────────────────────────────────
  if (sub === 'set') {
    if (!(await isPrivilegedUser(thread, native, senderID))) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Only admins can change the spam threshold.',
      });
      return;
    }

    const raw = args[1];
    const count = raw ? Number(raw) : NaN;

    if (
      !raw ||
      !Number.isInteger(count) ||
      count < MIN_THRESHOLD ||
      count > MAX_THRESHOLD
    ) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `⚠️ Please provide a whole number between ${MIN_THRESHOLD} and ${MAX_THRESHOLD}.\nExample: \`antispam set 20\``,
      });
      return;
    }

    await handle.set('threshold', count);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Spam threshold set to **${count}** message(s) within ${windowSeconds}s.`,
    });
    return;
  }

  // ── on ────────────────────────────────────────────────────────────────────
  if (sub === 'on') {
    if (!(await isPrivilegedUser(thread, native, senderID))) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Only admins can enable this feature.',
      });
      return;
    }

    await handle.set('enabled', true);
    const threshold =
      ((await handle.get('threshold')) as number | null) ?? DEFAULT_THRESHOLD;

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Antispam has been **enabled**. Members sending **${threshold}+** messages within ${windowSeconds}s will be auto-kicked.`,
    });
    return;
  }

  // ── off ───────────────────────────────────────────────────────────────────
  if (sub === 'off') {
    if (!(await isPrivilegedUser(thread, native, senderID))) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Only admins can disable this feature.',
      });
      return;
    }

    await handle.set('enabled', false);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✅ Antispam has been **disabled**.',
    });
    return;
  }

  // ── unrecognised subcommand ───────────────────────────────────────────────
  return usage();
};

// ── onChat ────────────────────────────────────────────────────────────────────
// Passive scanner — runs on every message in every thread.

export const onChat = async ({
  chat,
  thread,
  user,
  event,
  db,
  native,
}: AppCtx): Promise<void> => {
  // Only enforce in group threads — DMs have no members to kick.
  if (!event['isGroup']) return;

  // Only handle plain text messages; reactions, unsends, and log events carry
  // no body text and must be skipped before any DB access.
  const eventType = event['type'] as string | undefined;
  if (eventType && eventType !== 'message' && eventType !== 'message_reply')
    return;

  const message = event['message'] as string | undefined;
  const threadID = event['threadID'] as string;
  const senderID = event['senderID'] as string;

  if (!message || !message.trim()) return;
  if (!threadID || !senderID) return;

  // Skip messages from thread admins, bot admins, or system admins — moderators
  // must never be auto-kicked while actively chatting in a busy thread.
  if (await isPrivilegedUser(thread, native, senderID)) return;

  // Bail if the feature has never been configured for this thread.
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('antispam'))) return;

  const handle = await coll.getCollection('antispam');
  const enabled = (await handle.get('enabled')) as boolean | null;
  if (!enabled) return;

  const threshold =
    ((await handle.get('threshold')) as number | null) ?? DEFAULT_THRESHOLD;

  const isSpamming = recordMessageAndCheckSpam(threadID, senderID, threshold);
  if (!isSpamming) return;

  // ── Threshold reached — attempt to kick ─────────────────────────────────
  // Reset tracking immediately regardless of outcome so a permission failure
  // doesn't re-trigger (and re-notify) on the user's very next message.
  resetSpamTracking(threadID, senderID);

  let userName: string;
  try {
    userName = await user.getName(senderID);
  } catch {
    userName = senderID;
  }

  // Register the uid BEFORE removeUser() so on-event.middleware.ts can suppress
  // the generic leave.ts goodbye message for this moderation kick.
  kickRegistry.register(threadID, senderID);

  try {
    await thread.removeUser(senderID);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🚫 **${userName}** was sending messages too quickly (${threshold}+ within ${windowSeconds}s) and has been kicked from the group.`,
    });
  } catch {
    // Bot lacks kick permission — inform the group. Tracking was already reset
    // above, so this notice won't repeat until the user floods again.
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **${userName}** is spamming, but I need admin privileges to kick members.`,
    });
  }
};
