/**
 * /autotrans — Auto-Translate
 *
 * Port of the MiraiBot "autotrans" module for Cat-Bot (all UI text in English).
 *
 * When enabled for a chat, every incoming non-command message is language-
 * detected; anything that is not already English is translated into English,
 * so a multilingual group stays readable to everyone.
 *
 * Usage:
 *   /autotrans on   — turn auto-translate ON
 *   /autotrans off  — turn auto-translate OFF
 *   /autotrans      — toggle the current state
 *
 * Uses the free Google Translate endpoint (`client=gtx` translate_a/single),
 * which supports the full range of GTX languages (en, vi, ja, zh, ko, ru,
 * fr, de, es, ar, hi, th, id, tl, and many more).
 */

import axios from 'axios';
import type { AppCtx, BaseCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'autotrans',
  aliases: ['autotranslate', 'autotr'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Auto-translate any language into English for this chat.',
  category: 'Utility',
  usage: '<on | off>',
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

// ── In-memory state ───────────────────────────────────────────────────────────
// Scoped per bot session + chat so parallel bot instances never interfere.
const enabledThreads = new Set<string>();

function threadKey(native: BaseCtx['native'], threadID: string): string {
  return `${native.platform}|${native.userId ?? ''}|${native.sessionId ?? ''}|${threadID}`;
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

  const key = threadKey(native, threadID);
  const want = (args[0] ?? '').toLowerCase();

  // Explicit "on"/"off" beats the no-arg toggle fallback.
  if (want === 'on' || want === 'enable') {
    enabledThreads.add(key);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '✅ **Auto-translate is now ON** — non-English messages will be translated to English.',
    });
    return;
  }
  if (want === 'off' || want === 'disable') {
    enabledThreads.delete(key);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '⛔ **Auto-translate is now OFF** for this chat.',
    });
    return;
  }

  // No (or unknown) argument → toggle the current state.
  if (enabledThreads.has(key)) {
    enabledThreads.delete(key);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '⛔ **Auto-translate is now OFF** for this chat.',
    });
    return;
  }

  enabledThreads.add(key);
  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: '✅ **Auto-translate is now ON** — non-English messages will be translated to English.',
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

  const key = threadKey(ctx.native, threadID);
  if (!enabledThreads.has(key)) return;

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