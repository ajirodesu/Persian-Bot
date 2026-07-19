/**
 * autoban.ts — Keyword-triggered automatic ban, restricted to the system admin.
 *
 * Modeled on badwords.ts (per-message keyword scanning) and detect.ts
 * (session-wide db.bot storage), but the enforcement action is immediate:
 * there is no warning stage — the very first message that matches a
 * configured keyword bans the sender from using the bot outright, via the
 * same banUser() mechanism enforced by enforceNotBanned in
 * on-command.middleware.ts.
 *
 * ── Subcommands (SYSTEM_ADMIN only — enforced by meta.role) ──────────────────
 *   autoban add <word[,word|word]>    — Add trigger keyword(s)
 *   autoban delete <word[,word|word]> — Remove trigger keyword(s)
 *   autoban list [hide]               — Show trigger keywords (masked if 'hide')
 *   autoban on                        — Enable enforcement for this session
 *   autoban off                       — Disable enforcement for this session
 *   autoban (no args)                 — Show current status
 *
 * meta.role = Role.SYSTEM_ADMIN means enforcePermission in
 * on-command.middleware.ts denies every non-system-admin sender before
 * onCommand ever runs — no per-subcommand privilege check is needed here,
 * unlike badwords.ts (which gates per-thread admins, a role tier that has
 * no equivalent at the SYSTEM_ADMIN level).
 *
 * ── Storage (db.bot → 'autoban_settings') ────────────────────────────────────
 *   words:   string[]  — trigger keyword list (default: [])
 *   enabled: boolean   — session-wide enforcement toggle (default: false)
 *
 *   Scoped to db.bot (session-level, mirrors detect.ts / admin-only-mode.ts)
 *   so keywords and the enabled flag apply across every thread of the current
 *   bot session rather than being configured per-thread.
 *
 * ── onChat (passive scanner) ─────────────────────────────────────────────────
 *   Runs on every message across all threads when enabled. On a keyword
 *   match the sender is immediately banned via banUser() (same table
 *   enforceNotBanned reads on every subsequent command) and a single notice
 *   is posted in the thread where the trigger occurred.
 *
 *   System admins and bot admins can never trigger a ban from their own
 *   messages — mirrors the isPrivilegedUser exclusion in badwords.ts so a
 *   privileged tester typing a configured word does not lock themselves out.
 *
 *   Already-banned senders never reach this handler: runOnChat
 *   (on-chat-runner.ts) resolves isUserBanned once per message and skips the
 *   entire onChat fan-out for banned senders before any module runs, so this
 *   handler never re-issues a duplicate ban or a duplicate notice for them.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { banUser } from '@/engine/repos/banned.repo.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

export const meta: CommandMeta = {
  name: 'autoban',
  aliases: [] as string[],
  version: '1.0.0',
  role: Role.SYSTEM_ADMIN,
  author: 'AjiroDesu',
  description:
    'Manage a keyword trigger list — any user whose message matches a keyword is immediately banned from using the bot.',
  category: 'System Admin',
  usage: [
    'add <word[,word|word]> — Add trigger word(s) (system admin only)',
    'delete <word[,word|word]> — Remove trigger word(s)',
    'list [hide] — Show trigger keywords',
    'on — Enable auto-ban enforcement for this session',
    'off — Disable auto-ban enforcement for this session',
  ],
  cooldown: 3,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'action',
      description: 'Subcommand: add, delete, list, on, off',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'value',
      description: "Word(s) to add/delete (comma-separated) or 'hide' for list",
      required: false,
    },
  ],
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Masks the interior characters of a word, preserving first and last. */
function hideWord(str: string): string {
  if (str.length <= 2) return str[0] + '*';
  return str[0] + '*'.repeat(str.length - 2) + str[str.length - 1];
}

/**
 * Builds a Unicode-aware word-boundary regex for the given word.
 *
 * JavaScript's `\b` only recognises ASCII word chars [A-Za-z0-9_], so it
 * silently fails for accented characters and non-Latin scripts. Uses
 * lookahead/lookbehind against a broad Unicode letter/digit class instead,
 * with graceful fallbacks for engines without \p{L} support.
 *
 * Same approach as badwords.ts buildWordPattern — kept as a local copy
 * (rather than a shared import) so this module has no coupling to
 * badwords.ts internals and can evolve independently.
 */
function buildWordPattern(word: string): RegExp {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  try {
    return new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
  } catch {
    try {
      return new RegExp(`(?<![A-Za-z0-9À-ÖØ-öø-ÿ])${escaped}(?![A-Za-z0-9À-ÖØ-öø-ÿ])`, 'gi');
    } catch {
      return new RegExp(escaped, 'gi');
    }
  }
}

// ── DB helper ─────────────────────────────────────────────────────────────────

/**
 * Returns (and lazily creates) the 'autoban_settings' collection in db.bot.
 * Scoped to the current bot session — same pattern as detect.ts's
 * getDetectHandle — so the trigger list and enabled flag persist across
 * every thread without per-thread duplication.
 */
async function getAutobanHandle(db: AppCtx['db']) {
  const coll = db.bot;
  if (!(await coll.isCollectionExist('autoban_settings'))) {
    await coll.createCollection('autoban_settings');
    const fresh = await coll.getCollection('autoban_settings');
    await fresh.set('words', []);
    await fresh.set('enabled', false);
    return fresh;
  }
  return coll.getCollection('autoban_settings');
}

// ── onCommand — subcommand router (SYSTEM_ADMIN gated by meta.role) ─────────

export const onCommand = async ({
  chat,
  args,
  db,
  usage,
}: AppCtx): Promise<void> => {
  const sub = args[0]?.toLowerCase();
  const handle = await getAutobanHandle(db);

  // ── add ──────────────────────────────────────────────────────────────────
  if (sub === 'add') {
    const rawInput = args.slice(1).join(' ').trim();
    if (!rawInput) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: "⚠️ You haven't entered any trigger word(s) to add.",
      });
      return;
    }

    const inputWords = rawInput
      .split(/[,|]/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    const words = ((await handle.get('words')) as string[] | null) ?? [];

    const added: string[] = [];
    const duplicate: string[] = [];
    const tooShort: string[] = [];

    for (const word of inputWords) {
      if (word.length < 2) {
        tooShort.push(word);
      } else if (words.includes(word)) {
        duplicate.push(word);
      } else {
        words.push(word);
        added.push(word);
      }
    }

    await handle.set('words', words);

    const parts: string[] = [];
    if (added.length)
      parts.push(`✅ Added ${added.length} trigger word(s) to the auto-ban list.`);
    if (duplicate.length)
      parts.push(
        `❌ ${duplicate.length} word(s) already in the list: ${duplicate.map(hideWord).join(', ')}`,
      );
    if (tooShort.length)
      parts.push(
        `⚠️ ${tooShort.length} word(s) too short (< 2 chars): ${tooShort.join(', ')}`,
      );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: parts.join('\n') || '⚠️ No changes made.',
    });
    return;
  }

  // ── delete / del / -d ────────────────────────────────────────────────────
  if (['delete', 'del', '-d'].includes(sub ?? '')) {
    const rawInput = args.slice(1).join(' ').trim();
    if (!rawInput) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: "⚠️ You haven't entered any trigger word(s) to delete.",
      });
      return;
    }

    const inputWords = rawInput
      .split(/[,|]/)
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean);

    const words = ((await handle.get('words')) as string[] | null) ?? [];

    const removed: string[] = [];
    const notFound: string[] = [];

    for (const word of inputWords) {
      const idx = words.indexOf(word);
      if (idx !== -1) {
        words.splice(idx, 1);
        removed.push(word);
      } else {
        notFound.push(word);
      }
    }

    await handle.set('words', words);

    const parts: string[] = [];
    if (removed.length)
      parts.push(`✅ Deleted ${removed.length} trigger word(s) from the auto-ban list.`);
    if (notFound.length)
      parts.push(
        `❌ ${notFound.length} word(s) not found in the list: ${notFound.join(', ')}`,
      );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: parts.join('\n') || '⚠️ No changes made.',
    });
    return;
  }

  // ── list / all / -a ──────────────────────────────────────────────────────
  if (['list', 'all', '-a'].includes(sub ?? '')) {
    const words = ((await handle.get('words')) as string[] | null) ?? [];

    if (words.length === 0) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '⚠️ The auto-ban trigger list is currently empty.',
      });
      return;
    }

    const display =
      args[1]?.toLowerCase() === 'hide'
        ? words.map(hideWord).join(', ')
        : words.join(', ');

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `📑 **Auto-ban trigger words** (${words.length}): ${display}`,
    });
    return;
  }

  // ── on ────────────────────────────────────────────────────────────────────
  if (sub === 'on') {
    await handle.set('enabled', true);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✅ Auto-ban enforcement has been **enabled** for this session.',
    });
    return;
  }

  // ── off ───────────────────────────────────────────────────────────────────
  if (sub === 'off') {
    await handle.set('enabled', false);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✅ Auto-ban enforcement has been **disabled** for this session.',
    });
    return;
  }

  // ── status (no args) ──────────────────────────────────────────────────────
  if (!sub) {
    const words = ((await handle.get('words')) as string[] | null) ?? [];
    const enabled = (await handle.get('enabled')) as boolean | null;

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        `🛡️ **Auto-ban — Status**\n\n` +
        `• State: ${enabled ? '🟢 **Online**' : '🔴 **Offline**'}\n` +
        `• Trigger words: **${words.length}**\n` +
        (words.length > 0
          ? `• List: _${words.map(hideWord).join(', ')}_`
          : '• List: _(empty)_'),
    });
    return;
  }

  // ── unrecognised subcommand ───────────────────────────────────────────────
  return usage();
};

// ── onChat — passive keyword scanner ─────────────────────────────────────────
//
// Runs on every incoming message across all threads/platforms when enabled.
// A match bans the sender immediately — no warning stage, unlike badwords.ts.

export const onChat = async ({
  event,
  chat,
  native,
  db,
}: AppCtx): Promise<void> => {
  // ── 1. Guard: only plain text/message-reply events carry a scannable body ──
  const eventType = event['type'] as string | undefined;
  if (eventType && eventType !== 'message' && eventType !== 'message_reply') {
    return;
  }

  const message = event['message'] as string | undefined;
  if (!message || !message.trim()) return;

  const senderID = (event['senderID'] ?? event['userID']) as string | undefined;
  if (!senderID) return;

  // ── 2. Guard: session identity required to scope the ban ───────────────────
  const { userId, platform, sessionId } = native;
  if (!userId || !platform || !sessionId) return;

  // ── 3. Check enforcement is enabled — bail before any further DB work ──────
  const handle = await getAutobanHandle(db);
  const enabled = (await handle.get('enabled')) as boolean | null;
  if (!enabled) return;

  // ── 4. Load the trigger list ────────────────────────────────────────────────
  const words = ((await handle.get('words')) as string[] | null) ?? [];
  if (words.length === 0) return;

  // ── 5. Never auto-ban a system admin or bot admin ───────────────────────────
  // Mirrors badwords.ts's isPrivilegedUser exclusion — a privileged tester
  // typing a configured trigger word must never lock themselves out.
  if (await isSystemAdmin(senderID)) return;
  if (await isBotAdmin(userId, platform, sessionId, senderID)) return;

  // ── 6. Keyword matching (Unicode-aware, whole-word) ─────────────────────────
  const matched = words.find((word) => buildWordPattern(word).test(message));
  if (!matched) return;

  // ── 7. Ban immediately — same table enforceNotBanned reads on every
  //        subsequent command invocation, so the block takes effect at once.
  await banUser(
    userId,
    platform,
    sessionId,
    senderID,
    `autoban: triggered keyword "${matched}"`,
  );

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message:
      '🚫 A prohibited keyword was detected in your message. You have been permanently banned from using this bot.',
  });
};
