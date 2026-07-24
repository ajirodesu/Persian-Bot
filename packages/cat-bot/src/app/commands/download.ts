/**
 * download.ts — Unified Social Media Downloader (Facebook / Instagram / Pinterest / TikTok)
 *
 * Cat-Bot port + merge of four previously-standalone legacy modules
 * (facebookdl.ts, instagramdl.ts, pinterest.ts, tiktok.ts). All four used the
 * same shape (positional/quoted URL → delirius API → reply with media), so
 * they are combined here into ONE command — `download` — that auto-detects
 * which of the four platforms a link belongs to instead of requiring a
 * separate command per platform.
 *
 * ── Usage ─────────────────────────────────────────────────────────────────
 *   download <url>        — Download from a Facebook/Instagram/Pinterest/TikTok link
 *   download on            — Enable auto-detect in this chat (admin only in groups)
 *   download off           — Disable auto-detect in this chat (admin only in groups)
 *   download status        — Show whether auto-detect is enabled here
 *
 * Aliases (kept from the four original commands, so nothing breaks for
 * existing users): fb, fbdl, facebook, facebookdl, ig, igdl, instagram,
 * instagramdl, pin, pindl, pinterestdl, tt, ttdl, vt, vtdl, tiktok, tiktokdl.
 *
 * ── Auto-detect mode (onChat) ────────────────────────────────────────────
 * When enabled for a thread, every incoming message is scanned for a link
 * whose URL *path* (not just its domain) matches one of the four supported
 * platforms — e.g. instagram.com/p/…, tiktok.com/@user/video/…,
 * facebook.com/reel/…, pin.it/…. A bare domain with no recognizable path
 * (a profile page, a home page, etc.) is intentionally ignored so the
 * scanner does not spam the chat on every unrelated link. See
 * `isFacebookLink` / `isInstagramLink` / `isPinterestLink` / `isTikTokLink`.
 *
 * To avoid double-processing, onChat skips any message that is itself an
 * explicit invocation of this command (or one of its aliases) — that
 * invocation is already handled by onCommand. It also ignores the bot's own
 * messages so its reply captions (which contain the source URL) can never
 * re-trigger the scanner.
 *
 * ── DB schema (db.threads.collection(threadID) → 'download_autodetect') ───
 *   { enabled: boolean } — per-thread auto-detect toggle (default false)
 *
 * Note: the original modules gated each command behind `permissions: { coin: 10 }`.
 * That balance requirement has been intentionally dropped here — `download`
 * is free to use, both as an explicit command and via auto-detect.
 *
 * Author: AjiroDesu
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { isBotAdmin } from '@/engine/repos/credentials.repo.js';
import { isSystemAdmin } from '@/engine/repos/system-admin.repo.js';
// onCommand already gets a typing indicator for free from the command
// dispatcher. The onChat auto-detect path bypasses that dispatcher entirely,
// so it needs its own — started only once we know a download is actually
// about to run (see onChat below), not for every message that merely passes
// through this handler.
import { withTypingIndicator } from '@/engine/lib/typing-indicator.lib.js';

// ── Meta ──────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'download',
  aliases: [
    'fb',
    'fbdl',
    'facebook',
    'facebookdl',
    'ig',
    'igdl',
    'instagram',
    'instagramdl',
    'pin',
    'pindl',
    'pinterestdl',
    'tt',
    'ttdl',
    'vt',
    'vtdl',
    'tiktok',
    'tiktokdl',
  ],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Downloads media from a Facebook, Instagram, Pinterest, or TikTok link — platform is auto-detected from the URL.',
  category: 'Downloader',
  guide: [
    '<url> — Download from a Facebook, Instagram, Pinterest, or TikTok link',
    'on — Enable auto-detect for links posted in this chat',
    'off — Disable auto-detect for links posted in this chat',
    'status — Show whether auto-detect is currently enabled here',
  ],
  cooldown: 8,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'url',
      description:
        'Link to download, or a subcommand: on / off / status (manage auto-detect)',
      required: true,
    },
  ],
};

// ── Platform detection ───────────────────────────────────────────────────────
//
// Each matcher intentionally requires a meaningful *path* segment, not just
// the bare domain, so a random facebook.com/instagram.com/etc link (profile,
// homepage, unrelated share) is never treated as a downloadable post. This is
// what keeps auto-detect from becoming spammy.

type PlatformId = 'facebook' | 'instagram' | 'pinterest' | 'tiktok';

const PLATFORM_LABELS: Record<PlatformId, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  pinterest: 'Pinterest',
  tiktok: 'TikTok',
};

function stripLeadingSubdomains(host: string): string {
  return host.replace(/^(www|web|m|mobile)\./i, '');
}

function isFacebookLink(url: URL): boolean {
  const host = stripLeadingSubdomains(url.hostname.toLowerCase());
  if (host === 'fb.watch') return true;
  if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return false;
  if (url.pathname === '/watch') return true; // facebook.com/watch?v=123
  return /\/(reel|reels|videos|story\.php|share\/[rv])(\/|$)/i.test(url.pathname);
}

function isInstagramLink(url: URL): boolean {
  const host = stripLeadingSubdomains(url.hostname.toLowerCase());
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) return false;
  return /\/(p|reel|reels|tv)\//i.test(url.pathname);
}

function isPinterestLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'pin.it') return true;
  if (!host.includes('pinterest.')) return false;
  return /\/pin\//i.test(url.pathname);
}

function isTikTokLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'vt.tiktok.com' || host === 'vm.tiktok.com') return true;
  if (!host.endsWith('tiktok.com')) return false;
  return /\/video\//i.test(url.pathname) || /\/@[^/]+\/(video|photo)\//i.test(url.pathname);
}

interface MatchedLink {
  platform: PlatformId;
  url: string;
}

/** Strips common trailing punctuation picked up when a link is embedded in a sentence. */
function cleanTrailingPunctuation(raw: string): string {
  return raw.replace(/[.,!?;:'"”’)\]}>]+$/g, '');
}

/** Tests a single candidate string against all four platform matchers. */
function matchSupportedPlatform(rawCandidate: string): MatchedLink | null {
  const candidate = cleanTrailingPunctuation(rawCandidate.trim());
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;

  if (isFacebookLink(url)) return { platform: 'facebook', url: url.toString() };
  if (isInstagramLink(url)) return { platform: 'instagram', url: url.toString() };
  if (isPinterestLink(url)) return { platform: 'pinterest', url: url.toString() };
  if (isTikTokLink(url)) return { platform: 'tiktok', url: url.toString() };
  return null;
}

/** If a bare arg lacks a protocol but still looks like a domain, prefix https:// before testing it. */
function normalizeCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

const URL_TOKEN_RE = /https?:\/\/[^\s<>"'()[\]]+/gi;

/** Scans free-form text for the first URL token that matches a supported platform. */
function extractSupportedLink(text: string | null | undefined): MatchedLink | null {
  if (!text) return null;
  const tokens = text.match(URL_TOKEN_RE);
  if (!tokens) return null;
  for (const token of tokens) {
    const matched = matchSupportedPlatform(token);
    if (matched) return matched;
  }
  return null;
}

// ── Downloader API calls (delirius provider, registered in apis.lib.ts) ────────

interface MediaItem {
  type: 'video' | 'image';
  url: string;
}

async function fetchMedia(platform: PlatformId, sourceUrl: string): Promise<MediaItem[]> {
  const REQUEST_TIMEOUT_MS = 30_000;

  if (platform === 'facebook') {
    const apiUrl = createUrl('delirius', '/download/facebook', { url: sourceUrl });
    const res = await axios.get(apiUrl, { timeout: REQUEST_TIMEOUT_MS });
    const list = res.data?.list as Array<{ url?: string }> | undefined;
    const videoUrl = list?.[0]?.url;
    if (!videoUrl) throw new Error('No downloadable video found for this Facebook link.');
    return [{ type: 'video', url: videoUrl }];
  }

  if (platform === 'instagram') {
    const apiUrl = createUrl('delirius', '/download/instagram', { url: sourceUrl });
    const res = await axios.get(apiUrl, { timeout: REQUEST_TIMEOUT_MS });
    const data = res.data?.data as Array<{ type?: string; url?: string }> | undefined;
    const items: MediaItem[] = (data ?? [])
      .filter((entry): entry is { type: string; url: string } => !!entry?.url)
      .map((entry) => ({ type: entry.type === 'video' ? 'video' : 'image', url: entry.url }));
    if (!items.length) throw new Error('No downloadable media found for this Instagram link.');
    return items;
  }

  if (platform === 'pinterest') {
    const apiUrl = createUrl('delirius', '/download/pinterestdl', { url: sourceUrl });
    const res = await axios.get(apiUrl, { timeout: REQUEST_TIMEOUT_MS });
    const download = res.data?.data?.download as { type?: string; url?: string } | undefined;
    if (!download?.url) throw new Error('No downloadable media found for this Pinterest link.');
    return [{ type: download.type === 'video' ? 'video' : 'image', url: download.url }];
  }

  // tiktok
  const apiUrl = createUrl('delirius', '/download/tiktok', { url: sourceUrl });
  const res = await axios.get(apiUrl, { timeout: REQUEST_TIMEOUT_MS });
  const media = res.data?.data?.meta?.media?.[0] as
    | { type?: string; org?: string; images?: string[] }
    | undefined;
  if (!media) throw new Error('No downloadable media found for this TikTok link.');

  if (media.type === 'video') {
    if (!media.org) throw new Error('No downloadable video found for this TikTok link.');
    return [{ type: 'video', url: media.org }];
  }

  const images = media.images ?? [];
  if (!images.length) throw new Error('No downloadable media found for this TikTok link.');
  return images.map((imageUrl): MediaItem => ({ type: 'image', url: imageUrl }));
}

// ── Shared download + reply flow (used by both onCommand and onChat) ───────────

const MAX_ATTACHMENTS = 10;

async function runDownload(
  ctx: AppCtx,
  matched: MatchedLink,
  // isAutoDetect is unused now that the coin gate is gone, but kept so call
  // sites stay explicit about which path triggered the download.
  _opts: { isAutoDetect: boolean },
): Promise<void> {
  const label = PLATFORM_LABELS[matched.platform];

  const isButtonAction = ctx.event['type'] === 'button_action';
  const loadingId = isButtonAction
    ? (ctx.event['messageID'] as string | undefined)
    : undefined;
  // Delivers the final result: edits the existing (button-bearing) message
  // in place on a button refresh, or sends a plain reply otherwise. No
  // loading placeholder is sent — the typing indicator covers processing
  // feedback for the whole command duration.
  const deliver = async (payload: ReplyOptions): Promise<void> => {
    if (!loadingId) {
      await ctx.chat.replyMessage(payload);
      return;
    }
    try {
      await ctx.chat.editMessage({ ...payload, message_id_to_edit: loadingId });
    } catch {
      await ctx.chat.unsendMessage(loadingId).catch(() => {});
      await ctx.chat.reply(payload);
    }
  };
  const finish = deliver;
  const fail = (errorMessage: string): Promise<void> =>
    deliver({ style: MessageStyle.MARKDOWN, message: errorMessage });

  try {
    const media = (await fetchMedia(matched.platform, matched.url)).slice(0, MAX_ATTACHMENTS);

    const attachment_url = media.map((item, index) => ({
      name: `${matched.platform}_${index + 1}.${item.type === 'video' ? 'mp4' : 'jpg'}`,
      url: item.url,
    }));

    await finish({
      style: MessageStyle.MARKDOWN,
      message: `❖ **Platform**: ${label}\n❖ **URL**: ${matched.url}`,
      attachment_url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[download] ${matched.platform} failed: ${message}`);
    await fail(`⚠️ Failed to download from ${label}: \`${message}\``);
  }
}

// ── Auto-detect settings storage (db.threads.collection(threadID)) ─────────────

async function getAutoDetectHandle(db: AppCtx['db'], threadID: string) {
  const coll = db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('download_autodetect'))) {
    await coll.createCollection('download_autodetect');
    const fresh = await coll.getCollection('download_autodetect');
    await fresh.set('enabled', false);
    return fresh;
  }
  return coll.getCollection('download_autodetect');
}

/** Best-effort thread-admin check via thread.getInfo() (mirrors antispam.ts). */
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

// ── Instructions / examples shown when no link is supplied ─────────────────────

function buildInstructions(prefix: string): string {
  return [
    '📎 **Send a link to download.** Supported: Facebook, Instagram, Pinterest, TikTok.',
    '',
    `» \`${prefix}download https://www.facebook.com/reel/2796711250580249\``,
    `» \`${prefix}download https://www.instagram.com/p/DVKVfnVjyep\``,
    `» \`${prefix}download https://id.pinterest.com/pin/843580573994363210\``,
    `» \`${prefix}download https://www.tiktok.com/@netflixanime/video/7596931111805078805\``,
    '',
    `You can also reply to a message containing a link with \`${prefix}download\`.`,
    `Use \`${prefix}download on\` to auto-download supported links posted in this chat.`,
  ].join('\n');
}

const UNSUPPORTED_LINK_MESSAGE =
  '❌ That link isn\'t a supported Facebook, Instagram, Pinterest, or TikTok post/video/pin URL.';

// ── onCommand ─────────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, event, db, thread, native, prefix } = ctx;
  const sub = args[0]?.toLowerCase();

  // ── on / off / status — manage auto-detect for this chat ───────────────────
  if (sub === 'on' || sub === 'off' || sub === 'status') {
    const threadID = event['threadID'] as string | undefined;
    if (!threadID) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '❌ Auto-detect can only be managed inside a chat/thread.',
      });
      return;
    }

    const handle = await getAutoDetectHandle(db, threadID);

    if (sub === 'status') {
      const enabled = (await handle.get('enabled')) as boolean | null;
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `📡 Auto-detect is currently **${enabled ? 'ON' : 'OFF'}** in this chat.`,
      });
      return;
    }

    const senderID = event['senderID'] as string | undefined;
    if (event['isGroup'] && senderID) {
      if (!(await isPrivilegedUser(thread, native, senderID))) {
        await chat.replyMessage({
          style: MessageStyle.MARKDOWN,
          message: '⚠️ Only admins can change auto-detect settings in a group.',
        });
        return;
      }
    }

    const enable = sub === 'on';
    await handle.set('enabled', enable);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: enable
        ? '✅ Auto-detect **enabled**. Supported links (Facebook, Instagram, Pinterest, TikTok) posted in this chat will be downloaded automatically.'
        : '✅ Auto-detect **disabled** for this chat.',
    });
    return;
  }

  // ── Resolve the link to download ────────────────────────────────────────────
  const rawArg = args[0];
  let matched: MatchedLink | null = null;
  let hadUrlLikeInput = false;

  if (rawArg) {
    const normalized = normalizeCandidate(rawArg);
    if (/^https?:\/\//i.test(normalized)) {
      hadUrlLikeInput = true;
      matched = matchSupportedPlatform(normalized);
    }
  }

  if (!matched && args.length) {
    matched = extractSupportedLink(args.join(' '));
    if (matched) hadUrlLikeInput = true;
  }

  if (!matched) {
    const messageReply = event['messageReply'] as Record<string, unknown> | undefined;
    const quotedBody = messageReply?.['message'] as string | undefined;
    const fromQuoted = extractSupportedLink(quotedBody);
    if (fromQuoted) {
      matched = fromQuoted;
      hadUrlLikeInput = true;
    }
  }

  if (!matched) {
    if (hadUrlLikeInput) {
      await chat.replyMessage({ style: MessageStyle.MARKDOWN, message: UNSUPPORTED_LINK_MESSAGE });
      return;
    }
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: buildInstructions(prefix || '/'),
    });
    return;
  }

  await runDownload(ctx, matched, { isAutoDetect: false });
};

// ── onChat — passive auto-detect scanner ────────────────────────────────────────
//
// Runs on every incoming message. Only acts when auto-detect has been turned
// on for the thread AND the message isn't itself an explicit invocation of
// this command (that path is already handled by onCommand above).

export const onChat = async (ctx: AppCtx): Promise<void> => {
  const { event, db, prefix, bot } = ctx;

  const eventType = event['type'] as string | undefined;
  if (eventType && eventType !== 'message' && eventType !== 'message_reply') return;

  const message = (event['message'] as string | undefined)?.trim();
  if (!message) return;

  const senderID = event['senderID'] as string | undefined;
  const threadID = event['threadID'] as string | undefined;
  if (!senderID || !threadID) return;

  // Never react to the bot's own messages (defensive — prevents a reply
  // caption containing the source URL from ever re-triggering itself).
  try {
    const botID = await bot.getID();
    if (botID && senderID === botID) return;
  } catch {
    // If bot ID can't be resolved, fall through — worst case is a missed skip.
  }

  // Skip explicit `download`/alias invocations — onCommand already handles them.
  const p = prefix || '/';
  const escapedPrefix = p.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, String.raw`\$&`);
  const commandNames = [meta.name, ...(meta.aliases ?? [])].join('|');
  if (new RegExp(`^${escapedPrefix}(${commandNames})(\\s|$)`, 'i').test(message)) return;

  const handle = await getAutoDetectHandle(db, threadID);
  const enabled = (await handle.get('enabled')) as boolean | null;
  if (!enabled) return;

  const matched = extractSupportedLink(message);
  if (!matched) return;

  // Only now — every gate above has passed, so a download is actually about
  // to run — start the typing indicator. Anyone posting an unrelated message,
  // or a link with auto-detect off, never sees the bot "typing".
  await withTypingIndicator(ctx.api, threadID, () =>
    runDownload(ctx, matched, { isAutoDetect: true }),
  );
};