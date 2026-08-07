/**
 * /autotrans — Auto-Translate
 *
 * Port of the MiraiBot "autotrans" module for Cat-Bot (all UI text in English).
 *
 * When enabled for a chat, every incoming non-command message is language-
 * detected; anything that is not already English is translated into English,
 * so a multilingual group stays readable to everyone.
 *
 * The on/off setting is persisted per thread in the database (a `autotrans`
 * collection in the thread's namespace) so the flag survives restarts —
 * mirroring the auto-detect setting in `download.ts`.
 *
 * Usage:
 *   /autotrans        — show the current status
 *   /autotrans on     — turn auto-translate ON
 *   /autotrans off    — turn auto-translate OFF
 *
 * Uses the free Google Translate endpoint (`client=gtx` translate_a/single),
 * which supports the full range of GTX languages (en, vi, ja, zh, ko, ru,
 * fr, de, es, ar, hi, th, id, tl, and many more).
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'autotrans',
  aliases: ['autotranslate', 'autotr'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Auto-translate any language into English for this chat.',
  category: 'Utility',
  usage: '[on | off]',
  cooldown: 5,
  hasPrefix: true,
};

// ── Constants ─────────────────────────────────────────────────────────────────

const GTX_ENDPOINT = 'https://translate.googleapis.com/translate_a/single';
const REQUEST_TIMEOUT = 12000;
const TARGET_LANG = 'en';

/**
 * Messages are only processed when they contain at least one letter in any
 * script (Latin, CJK, Cyrillic, Arabic, Devanagari, emoji are excluded).
 */
const HAS_TEXT = /[\p{L}\p{M}]/u;

// ── Per-thread setting (database-backed) ──────────────────────────────────────
// The enabled flag is stored in the thread's `autotrans` collection so it
// survives restarts and stays correct across parallel bot instances.

/**
 * Gets or creates the per-thread auto-translate setting collection.
 *
 * @param db - Database instance.
 * @param threadID - Thread ID used as the collection namespace.
 * @returns The collection handle for the thread setting.
 */
async function getAutoTransHandle(db: AppCtx['db'], threadID: string) {
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('autotrans'))) {
    await coll.createCollection('autotrans');
    const fresh = await coll.getCollection('autotrans');
    await fresh.set('enabled', false);
    return fresh;
  }
  return coll.getCollection('autotrans');
}

/**
 * Reads the persisted auto-translate flag for a thread.
 *
 * @param db - Database instance.
 * @param threadID - Thread ID used as the collection namespace.
 * @returns True when auto-translate is enabled for the thread.
 */
async function isAutoTransEnabled(db: AppCtx['db'], threadID: string): Promise<boolean> {
  const handle = await getAutoTransHandle(db, threadID);
  const enabled = (await handle.get('enabled')) as boolean | null;
  return enabled === true;
}

/**
 * Best-effort thread admin check using thread.getInfo().
 *
 * @param thread - Thread context.
 * @param senderID - Sender to validate.
 * @returns True when the sender is an admin in the thread.
 */
async function isThreadAdmin(thread: AppCtx['thread'], senderID: string): Promise<boolean> {
  try {
    const info = (await thread.getInfo()) as unknown as Record<string, unknown>;
    const adminIDs = info['adminIDs'] as Array<string | { uid: string }> | undefined;
    if (!Array.isArray(adminIDs)) return false;
    return adminIDs.some((a) => (typeof a === 'string' ? a : a.uid) === senderID);
  } catch {
    return false;
  }
}

/**
 * Checks whether a user may change thread-level auto-translate settings.
 *
 * @param thread - Thread context.
 * @param native - Native platform context.
 * @param senderID - Sender to validate.
 * @returns True when the sender is privileged.
 */
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

// ── Google Translate helper ───────────────────────────────────────────────────

/** Translates `text` from `source` to `target`; null on any error / odd shape. */
async function translate(text: string, source: string, target: string): Promise<string | null> {
  try {
    const { data } = await axios.get<unknown>(GTX_ENDPOINT, {
      timeout: REQUEST_TIMEOUT,
      params: { client: 'gtx', sl: source, tl: target, dt: 't', q: text },
    });
    const segments = (data as Array<Array<Array<string | null> | string>>)[0];
    if (!Array.isArray(segments)) return null;
    return segments
      .map((seg) => (Array.isArray(seg) ? (seg[0] ?? '') : ''))
      .join('');
  } catch {
    return null;
  }
}

/** Detects the source language code via a cheap auto→English call. */
async function detectLanguage(text: string): Promise<string | null> {
  try {
    const { data } = await axios.get<unknown>(GTX_ENDPOINT, {
      timeout: REQUEST_TIMEOUT,
      params: { client: 'gtx', sl: 'auto', tl: TARGET_LANG, dt: 't', q: text },
    });
    const arr = data as Array<unknown>;
    const detected = arr?.[2];
    return typeof detected === 'string' && detected ? detected : null;
  } catch {
    return null;
  }
}

// ── Command handler ───────────────────────────────────────────────────────────

export const onCommand = async ({
  chat,
  event,
  native,
  db,
  thread,
  args,
}: AppCtx): Promise<void> => {
  const threadID = (event['threadID'] ?? '') as string;
  if (!threadID) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used inside a chat thread.',
    });
    return;
  }

  const want = (args[0] ?? '').toLowerCase();
  const handle = await getAutoTransHandle(db, threadID);

  // Explicit "on"/"off" beats the no-arg status fallback.
  if (want === 'on' || want === 'enable') {
    const senderID = (event['senderID'] ?? '') as string;
    if (event['isGroup'] && senderID) {
      if (!(await isPrivilegedUser(thread, native, senderID))) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: '⚠️ Only admins can change auto-translate settings in a group.',
        });
        return;
      }
    }
    await handle.set('enabled', true);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✅ **Auto-translate is now ON** — non-English messages will be translated to English.',
    });
    return;
  }
  if (want === 'off' || want === 'disable') {
    const senderID = (event['senderID'] ?? '') as string;
    if (event['isGroup'] && senderID) {
      if (!(await isPrivilegedUser(thread, native, senderID))) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: '⚠️ Only admins can change auto-translate settings in a group.',
        });
        return;
      }
    }
    await handle.set('enabled', false);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '⛔ **Auto-translate is now OFF** for this chat.',
    });
    return;
  }

  // No query → report the current status instead of toggling, so users can
  // check whether auto-translate is live for this chat.
  const isEnabled = await isAutoTransEnabled(db, threadID);
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: isEnabled
      ? '🟢 **Auto-translate is currently ON** — non-English messages will be translated to English.'
      : '⚪ **Auto-translate is currently OFF** for this chat.',
  });
};

// ── Passive chat handler ──────────────────────────────────────────────────────
// Runs on every incoming message. When a chat has auto-translate enabled, any
// message that is not already English is detected and translated to English.

export const onChat = async (ctx: AppCtx): Promise<void> => {
  const text = ((ctx.event['message'] as string | undefined) || '').trim();
  const threadID = (ctx.event['threadID'] ?? '') as string;
  const senderID = (ctx.event['senderID'] ?? ctx.event['userID'] ?? '') as string;
  if (!text || !threadID || !HAS_TEXT.test(text)) return;

  if (!(await isAutoTransEnabled(ctx.db, threadID))) return;

  // Never auto-translate the bot's own messages (which would otherwise recurse).
  if (senderID) {
    const botId = await ctx.bot.getID().catch(() => '');
    if (botId && senderID === botId) return;
  }

  // Never auto-translate another command invocation.
  const prefix = ctx.prefix ?? '/';
  if (text.startsWith(prefix)) return;

  const detected = await detectLanguage(text);
  if (!detected || detected === TARGET_LANG) return;

  const translated = await translate(text, detected, TARGET_LANG);
  if (!translated || translated.trim() === '') return;

  await ctx.chat
    .replyMessage({
      style: MessageStyle.MARKDOWN,
      message: translated,
    })
    .catch(() => {});
};