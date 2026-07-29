/**
 * download.ts — Unified Social Media Downloader (Facebook / Instagram / Pinterest / X / TikTok)
 *
 * Downloads media from supported social platforms using Nexray endpoints.
 * The command can be used directly, via quoted/replied links, or through
 * thread auto-detect when enabled.
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
import { withTypingIndicator } from '@/engine/lib/typing-indicator.lib.js';
import { withRetry, isNetworkError } from '@/engine/lib/retry.lib.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

/**
 * Command metadata for the unified downloader command.
 */
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
    'x',
    'xdl',
    'tw',
    'twdl',
    'tiktok',
    'tiktokdl',
    'vt',
    'vtdl',
  ],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description:
    'Downloads media from a Facebook, Instagram, Pinterest, X, or TikTok link — platform is auto-detected from the URL.',
  category: 'Downloader',
  guide: [
    '<url> — Download from a Facebook, Instagram, Pinterest, X, or TikTok link',
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
      description: 'Link to download, or a subcommand: on / off / status',
      required: true,
    },
  ],
};

/**
 * Supported downloader targets.
 */
type PlatformId = 'facebook' | 'instagram' | 'pinterest' | 'x' | 'tiktok';

/**
 * Human-readable labels for each supported platform.
 */
const PLATFORM_LABELS: Record<PlatformId, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  pinterest: 'Pinterest',
  x: 'X',
  tiktok: 'TikTok',
};

/**
 * Media attachment types returned by the downloader APIs.
 */
type MediaType = 'video' | 'image' | 'audio';

/**
 * Normalized media item used by the reply flow.
 */
interface MediaItem {
  type: MediaType;
  url: string;
}

/**
 * A parsed and validated supported link.
 */
interface MatchedLink {
  platform: PlatformId;
  url: string;
}

/**
 * Removes common subdomain prefixes so host checks are consistent.
 *
 * @param host - Hostname to normalize.
 * @returns Hostname with standard prefixes removed.
 */
function stripLeadingSubdomains(host: string): string {
  return host.replace(/^(www|web|m|mobile)\./i, '');
}

/**
 * Removes punctuation commonly attached to links in sentences.
 *
 * @param raw - Raw URL token.
 * @returns Cleaned URL token.
 */
function cleanTrailingPunctuation(raw: string): string {
  return raw.replace(/[.,!?;:'"”’)\]}>]+$/g, '');
}

/**
 * Normalizes a candidate input into a URL-like string when possible.
 *
 * @param raw - Raw user input.
 * @returns The input with https:// added when it looks like a bare domain.
 */
function normalizeCandidate(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/**
 * Detects whether a URL is a Facebook post/video/reel/share link.
 *
 * @param url - Parsed URL object.
 * @returns True when the URL is supported.
 */
function isFacebookLink(url: URL): boolean {
  const host = stripLeadingSubdomains(url.hostname.toLowerCase());
  if (host === 'fb.watch') return true;
  if (host !== 'facebook.com' && !host.endsWith('.facebook.com')) return false;
  if (url.pathname === '/watch') return true;
  return /\/(reel|reels|videos|story\.php|share\/[rv])(\/|$)/i.test(url.pathname);
}

/**
 * Detects whether a URL is an Instagram post/reel/tv link.
 *
 * @param url - Parsed URL object.
 * @returns True when the URL is supported.
 */
function isInstagramLink(url: URL): boolean {
  const host = stripLeadingSubdomains(url.hostname.toLowerCase());
  if (host !== 'instagram.com' && !host.endsWith('.instagram.com')) return false;
  return /\/(p|reel|reels|tv)\//i.test(url.pathname);
}

/**
 * Detects whether a URL is a Pinterest pin link or pin.it short link.
 *
 * @param url - Parsed URL object.
 * @returns True when the URL is supported.
 */
function isPinterestLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'pin.it') return true;
  if (!host.includes('pinterest.')) return false;
  return /\/pin\//i.test(url.pathname);
}

/**
 * Detects whether a URL is an X post link.
 *
 * @param url - Parsed URL object.
 * @returns True when the URL is supported.
 */
function isXLink(url: URL): boolean {
  const host = stripLeadingSubdomains(url.hostname.toLowerCase());
  if (host !== 'x.com' && host !== 'twitter.com') return false;
  return /\/status\//i.test(url.pathname);
}

/**
 * Detects whether a URL is a TikTok video or photo post link.
 *
 * @param url - Parsed URL object.
 * @returns True when the URL is supported.
 */
function isTikTokLink(url: URL): boolean {
  const host = url.hostname.toLowerCase();
  if (host === 'vt.tiktok.com' || host === 'vm.tiktok.com') return true;
  if (!host.endsWith('tiktok.com')) return false;
  return /\/video\//i.test(url.pathname) || /\/@[^/]+\/(video|photo)\//i.test(url.pathname);
}

/**
 * Tests a single candidate URL against all supported platform matchers.
 *
 * @param rawCandidate - Raw URL candidate.
 * @returns The matched platform and cleaned URL, or null if unsupported.
 */
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
  if (isXLink(url)) return { platform: 'x', url: url.toString() };
  if (isTikTokLink(url)) return { platform: 'tiktok', url: url.toString() };
  return null;
}

const URL_TOKEN_RE = /https?:\/\/[^\s<>"'()[\]]+/gi;

/**
 * Extracts the first supported link from free-form text.
 *
 * @param text - Message or quoted text to scan.
 * @returns The first matched supported link, or null if none found.
 */
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

/** Endpoint path (relative to the `nexray` provider) for each supported platform. */
const NEXRAY_ENDPOINT: Record<PlatformId, string> = {
  facebook: '/downloader/facebook',
  instagram: '/downloader/instagram',
  pinterest: '/downloader/pinterest',
  x: '/downloader/twitter',
  tiktok: '/downloader/tiktok',
};

/**
 * Builds the Nexray downloader endpoint for the requested platform.
 *
 * @param platform - Target platform.
 * @param sourceUrl - Source URL to send to the API.
 * @returns Fully qualified Nexray API URL.
 */
function buildEndpoint(platform: PlatformId, sourceUrl: string): string {
  return createUrl('nexray', NEXRAY_ENDPOINT[platform], { url: sourceUrl });
}

/** Per-request timeout for the Nexray JSON API. Generous enough for cold upstream sources. */
const REQUEST_TIMEOUT_MS = 20_000;

/** How long a successful API response is reused for an identical (platform, url) pair. */
const RESPONSE_CACHE_TTL_MS = 3 * 60_000;

/**
 * A realistic desktop UA — some free downloader APIs reject requests carrying
 * axios's default "axios/x.y.z" user-agent as a naive bot-blocking heuristic.
 */
const NEXRAY_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json',
};

/**
 * Performs a cached, retrying JSON GET request against the platform API.
 *
 * Identical (platform, sourceUrl) pairs are served from a short-lived cache so that
 * an explicit `/download` invocation and a simultaneous auto-detect trigger — or
 * several users pasting the same link in a group — don't each pay for a fresh
 * upstream request. Only genuinely transient failures (network errors, 429, 5xx)
 * are retried; a bad/unsupported link fails fast instead of burning retry budget.
 *
 * @template T - Expected JSON response type.
 * @param platform - Target platform.
 * @param sourceUrl - Source URL to submit.
 * @returns Parsed JSON response body.
 * @throws When the request ultimately fails, or the API reports `status: false`.
 */
async function requestJson<T>(platform: PlatformId, sourceUrl: string): Promise<T> {
  const cacheKey = `download:${platform}:${sourceUrl}`;
  const cached = lruCache.get<T>(cacheKey);
  if (cached !== undefined) return cached;

  const apiUrl = buildEndpoint(platform, sourceUrl);

  const data = await withRetry(
    async () => {
      const res = await axios.get(apiUrl, {
        timeout: REQUEST_TIMEOUT_MS,
        headers: NEXRAY_HEADERS,
        validateStatus: (status) => status >= 200 && status < 500,
      });

      if (res.status >= 400) {
        const err = new Error(`Nexray API returned HTTP ${res.status}`) as Error & {
          status?: number;
        };
        err.status = res.status;
        throw err;
      }

      const body = res.data as { status?: boolean; message?: string; error?: string };
      if (body?.status === false) {
        throw new Error(
          body.message || body.error || 'The API reported that this link could not be processed.',
        );
      }

      return res.data as T;
    },
    {
      maxAttempts: 3,
      initialDelayMs: 1_200,
      maxDelayMs: 6_000,
      shouldRetry: (err) => isNetworkError(err),
    },
  );

  lruCache.set(cacheKey, data, RESPONSE_CACHE_TTL_MS);
  return data;
}

/**
 * Fetches downloadable media items for a supported platform.
 *
 * @param platform - Target platform.
 * @param sourceUrl - Supported content URL.
 * @returns Normalized media items ready for attachments.
 * @throws When the remote API does not return downloadable media.
 */
async function fetchMedia(platform: PlatformId, sourceUrl: string): Promise<MediaItem[]> {
  if (platform === 'facebook') {
    const data = await requestJson<any>(platform, sourceUrl);
    const result = data?.result;
    const videoUrl = result?.video_hd || result?.video_sd;
    if (!videoUrl) throw new Error('No downloadable video found for this Facebook link.');
    return [{ type: 'video', url: videoUrl }];
  }

  if (platform === 'instagram') {
    const data = await requestJson<any>(platform, sourceUrl);
    // Nexray normally returns `result` as an array of { type, url, thumbnail }
    // (one entry per video/image — carousels return multiple entries), but
    // defensively accept a single object too in case the shape ever changes.
    const rawResult = data?.result;
    const result: any[] = Array.isArray(rawResult) ? rawResult : rawResult ? [rawResult] : [];

    const items: MediaItem[] = result
      .map((entry: any) => ({
        type: entry?.type,
        // Some payloads may expose the direct link under `url`, `download_url`,
        // or `video`/`image` instead — fall back through the common variants.
        url: entry?.url || entry?.download_url || entry?.video || entry?.image,
      }))
      .filter((entry): entry is { type: unknown; url: string } => typeof entry.url === 'string' && entry.url.length > 0)
      .map((entry) => ({
        type: entry.type === 'video' ? 'video' : entry.type === 'audio' ? 'audio' : 'image',
        url: entry.url,
      }));

    if (!items.length) throw new Error('No downloadable media found for this Instagram link.');
    return items;
  }

  if (platform === 'pinterest') {
    const data = await requestJson<any>(platform, sourceUrl);
    const result = data?.result;
    const videoUrl = result?.video;
    const imageUrl = result?.thumbnail;
    if (videoUrl) return [{ type: 'video', url: videoUrl }];
    if (imageUrl) return [{ type: 'image', url: imageUrl }];
    throw new Error('No downloadable media found for this Pinterest link.');
  }

  if (platform === 'x') {
    const data = await requestJson<any>(platform, sourceUrl);
    const result = data?.result;
    const list = Array.isArray(result?.download_url) ? result.download_url : [];

    const items: MediaItem[] = list
      .filter((entry: any) => !!entry?.url)
      .map((entry: any) => {
        const type = String(entry.type || '').toLowerCase();
        return {
          type: type === 'image' ? 'image' : type === 'mp3' ? 'audio' : 'video',
          url: entry.url,
        };
      });

    if (items.length) return items;
    if (result?.thumbnail) return [{ type: 'image', url: result.thumbnail }];
    throw new Error('No downloadable media found for this X link.');
  }

  const data = await requestJson<any>(platform, sourceUrl);
  const result = data?.result;
  if (!result) throw new Error('No downloadable media found for this TikTok link.');

  if (result.data) return [{ type: 'video', url: result.data }];
  if (Array.isArray(result.images) && result.images.length) {
    return result.images.map((imageUrl: string) => ({ type: 'image', url: imageUrl }));
  }

  throw new Error('No downloadable media found for this TikTok link.');
}

/**
 * Extension used for the attachment filename per media type.
 *
 * @param type - Normalized media type.
 * @returns File extension without the leading dot.
 */
function extensionFor(type: MediaType): string {
  return type === 'video' ? 'mp4' : type === 'audio' ? 'mp3' : 'jpg';
}

/** Generous timeout for downloading the actual media binary (video files can be large). */
const DOWNLOAD_TIMEOUT_MS = 60_000;

/** Hard cap on a single downloaded file — protects memory/bandwidth against runaway responses. */
const MAX_DOWNLOAD_BYTES = 100 * 1024 * 1024; // 100 MB

/**
 * Downloads a single media item's bytes into a Buffer.
 *
 * Telegram's Bot API can accept a bare URL for sendVideo/sendPhoto/etc. and fetch it
 * server-side, but several CDN-proxy download links (rapidcdn.app, spotidown.app, and
 * similar Nexray-backed hosts) reject or mis-serve requests from Telegram's own fetcher —
 * surfacing as "wrong type of the web page content" or "failed to get HTTP URL content".
 * Downloading the bytes ourselves with a normal browser UA and forwarding them as a real
 * attachment sidesteps that unreliable remote-fetch path entirely (Discord already does
 * this for non-image URLs; Telegram did not, which is what this fixes).
 *
 * @param url - Direct media URL to download.
 * @param name - Filename to report in the resulting attachment.
 * @returns The downloaded attachment, or null if the download ultimately failed.
 */
async function downloadAttachment(
  url: string,
  name: string,
): Promise<{ name: string; stream: Buffer } | null> {
  try {
    const buffer = await withRetry(
      async () => {
        const res = await axios.get<ArrayBuffer>(url, {
          timeout: DOWNLOAD_TIMEOUT_MS,
          headers: NEXRAY_HEADERS,
          responseType: 'arraybuffer',
          maxContentLength: MAX_DOWNLOAD_BYTES,
          maxBodyLength: MAX_DOWNLOAD_BYTES,
          validateStatus: (status) => status >= 200 && status < 300,
        });
        const buf = Buffer.from(res.data);
        if (buf.length === 0) throw new Error('Downloaded file is empty.');
        return buf;
      },
      {
        maxAttempts: 3,
        initialDelayMs: 1_000,
        maxDelayMs: 5_000,
        shouldRetry: (err) => isNetworkError(err),
      },
    );
    return { name, stream: buffer };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[download] failed to fetch media binary for "${name}": ${message}`);
    return null;
  }
}

/**
 * Sends the final media response, handling both normal replies and button refreshes.
 *
 * @param ctx - Command context.
 * @param matched - Parsed and matched supported link.
 * @param _opts - Execution metadata used by callers.
 */
async function runDownload(
  ctx: AppCtx,
  matched: MatchedLink,
  _opts: { isAutoDetect: boolean },
): Promise<void> {
  const label = PLATFORM_LABELS[matched.platform];

  const isButtonAction = ctx.event['type'] === 'button_action';
  const loadingId = isButtonAction ? (ctx.event['messageID'] as string | undefined) : undefined;

  /**
   * Delivers the final payload, editing the triggering message when possible.
   *
   * @param payload - Reply payload to send.
   */
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

  try {
    const media = (await fetchMedia(matched.platform, matched.url)).slice(0, 10);

    const downloaded = await Promise.all(
      media.map((item, index) =>
        downloadAttachment(
          item.url,
          `${matched.platform}_${index + 1}.${extensionFor(item.type)}`,
        ),
      ),
    );

    const attachment = downloaded.filter(
      (item): item is { name: string; stream: Buffer } => item !== null,
    );

    if (!attachment.length) {
      throw new Error('The media link(s) could not be downloaded — the source may be unavailable.');
    }

    await deliver({
      style: MessageStyle.MARKDOWN,
      message: `▫️ **Platform**: ${label}\n▫️ **URL**: ${matched.url}`,
      attachment,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.warn(`[download] ${matched.platform} failed: ${message}`);
    await deliver({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to download from ${label}: \`${message}\``,
    });
  }
}

/**
 * Returns the first token name, stripping a glued command mention suffix.
 *
 * @param raw - Raw first token.
 * @returns Cleaned token name.
 */
function firstTokenName(raw: string): string {
  const atIndex = raw.indexOf('@');
  return (atIndex === -1 ? raw : raw.slice(0, atIndex)).toLowerCase();
}

/**
 * Checks whether a message is an explicit command invocation.
 *
 * @param message - Incoming message text.
 * @param prefix - Active command prefix.
 * @param commands - Registered command map.
 * @returns True when the message should be left to command dispatch.
 */
function isExplicitCommandInvocation(
  message: string,
  prefix: string | undefined,
  commands: AppCtx['commands'],
): boolean {
  const p = prefix || '/';

  if (message.startsWith(p)) {
    const firstToken = message.slice(p.length).split(/\s+/)[0];
    if (!firstToken) return false;
    return commands.has(firstTokenName(firstToken));
  }

  const firstToken = message.split(/\s+/)[0];
  if (!firstToken) return false;
  const mod = commands.get(firstTokenName(firstToken));
  const cfg = mod?.['meta'] as Record<string, unknown> | undefined;
  return cfg?.['hasPrefix'] === false;
}

/**
 * Gets or creates the per-thread auto-detect setting collection.
 *
 * @param db - Database instance.
 * @param threadID - Thread ID used as the collection namespace.
 * @returns The collection handle for the thread setting.
 */
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
 * Checks whether a user may change thread-level downloader settings.
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

/**
 * Builds the usage instructions shown when no URL is provided.
 *
 * @param prefix - Active command prefix.
 * @returns Formatted help text.
 */
function buildInstructions(prefix: string): string {
  return [
    '📎 **Send a link to download.** Supported: Facebook, Instagram, Pinterest, X, TikTok.',
    '',
    `» \`${prefix}download https://www.facebook.com/reel/2796711250580249\``,
    `» \`${prefix}download https://www.instagram.com/p/DVKVfnVjyep\``,
    `» \`${prefix}download https://id.pinterest.com/pin/843580573994363210\``,
    `» \`${prefix}download https://x.com/i/status/2081854253295915246\``,
    `» \`${prefix}download https://www.tiktok.com/@netflixanime/video/7596931111805078805\``,
    '',
    `You can also reply to a message containing a link with \`${prefix}download\`.`,
    `Use \`${prefix}download on\` to auto-download supported links posted in this chat.`,
  ].join('\n');
}

/**
 * Error message shown when the user passes a URL that is not supported.
 */
const UNSUPPORTED_LINK_MESSAGE =
  "❌ That link isn't a supported Facebook, Instagram, Pinterest, X, or TikTok URL.";

/**
 * Handles the direct command execution.
 *
 * @param ctx - Command context.
 */
export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, event, db, thread, native, prefix } = ctx;
  const sub = args[0]?.toLowerCase();

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
        ? '✅ Auto-detect **enabled**. Supported links posted in this chat will be downloaded automatically.'
        : '✅ Auto-detect **disabled** for this chat.',
    });
    return;
  }

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

/**
 * Handles passive auto-detect for supported links posted in chat.
 *
 * @param ctx - Command context.
 */
export const onChat = async (ctx: AppCtx): Promise<void> => {
  const { event, db, prefix, bot, commands } = ctx;

  const eventType = event['type'] as string | undefined;
  if (eventType && eventType !== 'message' && eventType !== 'message_reply') return;

  const message = (event['message'] as string | undefined)?.trim();
  if (!message) return;

  const senderID = event['senderID'] as string | undefined;
  const threadID = event['threadID'] as string | undefined;
  if (!senderID || !threadID) return;

  try {
    const botID = await bot.getID();
    if (botID && senderID === botID) return;
  } catch {
    // Ignore ID lookup errors; best effort only.
  }

  if (isExplicitCommandInvocation(message, prefix, commands)) return;

  const handle = await getAutoDetectHandle(db, threadID);
  const enabled = (await handle.get('enabled')) as boolean | null;
  if (!enabled) return;

  const matched = extractSupportedLink(message);
  if (!matched) return;

  await withTypingIndicator(ctx.api, threadID, () =>
    runDownload(ctx, matched, { isAutoDetect: true }),
  );
};