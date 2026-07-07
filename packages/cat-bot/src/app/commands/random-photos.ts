/**
 * Random Photos — multi-command family (single file, config-driven)
 *
 * Merges the previously-standalone coffee.ts / picsum.ts / waifu.ts /
 * loremflickr.ts / wallpaper.ts modules into one file. Same architecture as
 * animal-photos.ts / memes.ts / periodic-table.ts / popcat-media.ts.
 *
 * Random-photo commands split into two shapes, so this file has two small
 * config-driven families rather than forcing everything through one
 * generic handler:
 *
 *   1. SIMPLE_PHOTO_CONFIGS — single source, single "repeat" button.
 *        /coffee — random coffee image  (aliases: coffeepic, coffeeimage, brew)
 *        /picsum — random Picsum photo  (aliases: randomphoto)
 *        /waifu  — random anime waifu   (aliases: randomwaifu)
 *
 *   2. TAGGED_PHOTO_CONFIGS — tag/topic-driven, shared 2×3 button grid.
 *        /loremflickr — tagged random photo (aliases: flickr)
 *        /wallpaper   — tagged random wallpaper, optional WxH (aliases: wp, wall, background)
 *
 * NOTE: /cat, /fox, /duck (animal-photos.ts) and /meme, /animeme (memes.ts)
 * are intentionally NOT part of this merge — they already live in their own
 * multi-command files.
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand, button? }>` and registers
 * each entry exactly like a standalone command module.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ════════════════════════════════════════════════════════════════════════════
// 1) SIMPLE PHOTO FAMILY — /coffee, /picsum, /waifu
// ════════════════════════════════════════════════════════════════════════════

type SimpleAttachment =
  | { kind: 'url'; name: string; url: string }
  | { kind: 'buffer'; name: string; buffer: Buffer };

type SimpleFetchResult =
  | { ok: true; caption: string; attachment: SimpleAttachment }
  // `notice` = a non-error reason to withhold the image (e.g. NSFW-flagged result)
  | { ok: false; notice?: string };

interface SimplePhotoConfig {
  name: string;
  aliases: string[];
  version: string;
  category: string;
  description: string;
  cooldown: number;
  label: string; // used in generic error text, e.g. "coffee image"
  buttonLabel: string;
  fetch: () => Promise<SimpleFetchResult>;
}

function extFromUrl(url: string): string {
  const extMatch = url.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
  return extMatch ? extMatch[1]! : 'jpg';
}

const SIMPLE_PHOTO_CONFIGS: SimplePhotoConfig[] = [
  {
    name: 'coffee',
    aliases: ['coffeepic', 'coffeeimage', 'brew'],
    version: '1.0.0',
    category: 'random',
    description: 'Send a random coffee image.',
    cooldown: 5,
    label: 'coffee image',
    buttonLabel: '🔁 Another Cup',
    fetch: async () => {
      const { data } = await axios.get<{ file?: string }>(
        'https://coffee.alexflipnote.dev/random.json',
        { headers: { Accept: 'application/json' }, timeout: 10000 },
      );
      const imageUrl = data?.file;
      if (!imageUrl) return { ok: false };
      return {
        ok: true,
        caption: '☕ **Random Coffee Image**',
        attachment: { kind: 'url', name: `coffee.${extFromUrl(imageUrl)}`, url: imageUrl },
      };
    },
  },
  {
    name: 'picsum',
    aliases: ['randomphoto'],
    version: '1.1.0',
    category: 'random',
    description: 'Sends a random photo from Picsum.',
    cooldown: 5,
    label: 'photo',
    buttonLabel: '🔄 Refresh',
    fetch: async () => {
      const url = createUrl('delirius', '/random/picsum');
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Picsum API responded with status ${response.status}`);
      const arrayBuffer = await response.arrayBuffer();
      if (!arrayBuffer.byteLength) throw new Error('Empty image returned');
      return {
        ok: true,
        caption: '🖼️ **Random Picsum Photo**',
        attachment: { kind: 'buffer', name: 'picsum.jpg', buffer: Buffer.from(arrayBuffer) },
      };
    },
  },
  {
    name: 'waifu',
    aliases: ['randomwaifu'],
    version: '1.1.0',
    category: 'Anime',
    description: 'Sends a random anime waifu image.',
    cooldown: 5,
    label: 'waifu image',
    buttonLabel: '🔄 Refresh',
    fetch: async () => {
      const url = createUrl('delirius', '/anime/waifu');
      const response = await fetch(url);
      if (!response.ok)
        throw new Error(`Waifu API responded with status ${response.status}`);

      const data = (await response.json()) as {
        status: boolean;
        data?: {
          id: number;
          title: string;
          likes: number;
          image: string;
          size: string;
          upload: string;
          ext: string;
          nsfw: boolean;
          source: string;
        };
      };
      if (!data.status || !data.data) throw new Error('Invalid response from Waifu API');
      const waifu = data.data;

      // Skip attaching flagged content — reply with a plain notice instead of the image.
      if (waifu.nsfw) {
        return { ok: false, notice: '⚠️ Got an NSFW-flagged result — try again for a different one.' };
      }

      const caption =
        `🌸 **${waifu.title}**\n` +
        ` • ❤️ **Likes:** ${waifu.likes}\n` +
        ` • 📦 **Size:** ${waifu.size}\n` +
        ` • 📅 **Uploaded:** ${waifu.upload}\n` +
        ` • 🔗 **Source:** ${waifu.source}`;

      return {
        ok: true,
        caption,
        attachment: { kind: 'url', name: `waifu_${waifu.id}${waifu.ext}`, url: waifu.image },
      };
    },
  },
];

const SIMPLE_BUTTON_ID = { repeat: 'repeat' } as const;

async function renderSimplePhoto(ctx: AppCtx, config: SimplePhotoConfig): Promise<void> {
  const { chat, native, event, button, session } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  try {
    const result = await config.fetch();

    if (!result.ok) {
      // Non-error notice (e.g. NSFW-flagged) — plain message, no button.
      if (result.notice) {
        const notice = { style: MessageStyle.MARKDOWN, message: result.notice };
        if (isButtonAction) {
          await chat.editMessage({ ...notice, message_id_to_edit: event['messageID'] as string });
        } else {
          await chat.replyMessage(notice);
        }
        return;
      }

      const errPayload = {
        style: MessageStyle.MARKDOWN,
        message: `⚠️ **Error:** Could not retrieve a ${config.label}.`,
      };
      if (isButtonAction) {
        await chat.editMessage({ ...errPayload, message_id_to_edit: event['messageID'] as string });
      } else {
        await chat.replyMessage(errPayload);
      }
      return;
    }

    const resolvedButtonId = isButtonAction
      ? session.id
      : button.generateID({ id: SIMPLE_BUTTON_ID.repeat, public: true });

    const attachmentField =
      result.attachment.kind === 'url'
        ? { attachment_url: [{ name: result.attachment.name, url: result.attachment.url }] }
        : { attachment: [{ name: result.attachment.name, stream: result.attachment.buffer }] };

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: result.caption,
      ...attachmentField,
      ...(hasNativeButtons(native.platform) ? { button: [resolvedButtonId] } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({ ...payload, message_id_to_edit: event['messageID'] as string });
    } else {
      await chat.replyMessage(payload);
    }
  } catch (err) {
    const error = err as { message?: string };
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **System Error:** Failed to fetch a ${config.label}: \`${error.message ?? 'Unknown error'}\``,
    };
    if (isButtonAction) {
      await chat.editMessage({ ...errPayload, message_id_to_edit: event['messageID'] as string });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 2) TAGGED PHOTO FAMILY — /loremflickr, /wallpaper
// ════════════════════════════════════════════════════════════════════════════
//
// Both commands share the exact same 2 × 3 button grid layout:
//   Row 1: [🎲 Random] [🌿 Nature] [🌌 Space]
//   Row 2: [🏙️ City]  [🌅 Sunset] [✨ Anime]
//
// Discord compatibility notes:
//   - Discord hard-caps ActionRows at 5 buttons each. Passing all 6 IDs in a flat
//     string[] collapses them into a single row of 6 and Discord rejects the message.
//     The fix is a string[][] where each inner array is its own ActionRow (row = max 5).
//   - context.model.normalizeRows() detects the 2-D structure automatically —
//     the 2-D array passes straight through to resolveButtons() without further wrapping.

const TAG_BUTTON_ID = {
  random: 'random',
  nature: 'nature',
  space: 'space',
  city: 'city',
  sunset: 'sunset',
  anime: 'anime',
} as const;

const TAG_PRESETS = {
  [TAG_BUTTON_ID.random]: { label: '🎲 Random', tag: '' },
  [TAG_BUTTON_ID.nature]: { label: '🌿 Nature', tag: 'nature' },
  [TAG_BUTTON_ID.space]: { label: '🌌 Space', tag: 'space' },
  [TAG_BUTTON_ID.city]: { label: '🏙️ City', tag: 'city' },
  [TAG_BUTTON_ID.sunset]: { label: '🌅 Sunset', tag: 'sunset' },
  [TAG_BUTTON_ID.anime]: { label: '✨ Anime', tag: 'anime' },
} as const;

/** Builds the shared 2 × 3 button grid as a string[][] (one Discord ActionRow per inner array). */
function buildTagButtonGrid(btn: AppCtx['button']): string[][] {
  return [
    [
      btn.generateID({ id: TAG_BUTTON_ID.random, public: true }),
      btn.generateID({ id: TAG_BUTTON_ID.nature, public: true }),
      btn.generateID({ id: TAG_BUTTON_ID.space, public: true }),
    ],
    [
      btn.generateID({ id: TAG_BUTTON_ID.city, public: true }),
      btn.generateID({ id: TAG_BUTTON_ID.sunset, public: true }),
      btn.generateID({ id: TAG_BUTTON_ID.anime, public: true }),
    ],
  ];
}

const RANDOM_POOL = ['nature', 'space', 'city', 'sunset', 'anime'] as const;
function pickRandomTag(): string {
  return RANDOM_POOL[Math.floor(Math.random() * RANDOM_POOL.length)]!;
}

// ── /loremflickr ──────────────────────────────────────────────────────────────

async function fetchLoremFlickr(tag: string): Promise<Buffer> {
  const url = createUrl('delirius', '/random/loremflickr', { flags: tag });
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`LoremFlickr API responded with status ${response.status}`);
  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength) throw new Error('Empty image returned');
  return Buffer.from(arrayBuffer);
}

async function renderLoremFlickr(ctx: AppCtx, tag: string): Promise<void> {
  const { chat, event, native, button: btn } = ctx;
  const isButtonAction = event['type'] === 'button_action';
  const buttonGrid = hasNativeButtons(native.platform) ? buildTagButtonGrid(btn) : [];

  let loadingId: string | undefined;
  if (!isButtonAction) {
    loadingId = (await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **Finding photo...**\n🏷️ Tag: _${tag || 'Random'}_`,
    })) as string | undefined;
  }

  try {
    const resolvedTag = tag || pickRandomTag();
    const image = await fetchLoremFlickr(resolvedTag);
    const caption = `🖼️ **LoremFlickr**\n🏷️ **Tag:** ${resolvedTag}`;

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment: [{ name: `loremflickr_${resolvedTag}.jpg`, stream: image }],
      ...(buttonGrid.length > 0 ? { button: buttonGrid } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({ ...payload, message_id_to_edit: event['messageID'] as string });
      return;
    }
    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});
    await chat.replyMessage(payload);
  } catch (err) {
    const error = err as { message?: string };
    const errorPayload = {
      style: MessageStyle.MARKDOWN,
      message: `⚠️ **Fetch Failed**\n\`${error.message ?? 'Unknown error'}\``,
      ...(buttonGrid.length > 0 ? { button: buttonGrid } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({ ...errorPayload, message_id_to_edit: event['messageID'] as string });
      return;
    }
    if (loadingId) {
      await chat.editMessage({ ...errorPayload, message_id_to_edit: loadingId });
    } else {
      await chat.replyMessage(errorPayload);
    }
  }
}

// ── /wallpaper ────────────────────────────────────────────────────────────────

const WALLPAPER_TIMEOUT = 20000;
const WALLPAPER_DEFAULT_WIDTH = 1920;
const WALLPAPER_DEFAULT_HEIGHT = 1080;

function parseWallpaperArgs(args: string[]): { query: string; width: number; height: number } {
  let width = WALLPAPER_DEFAULT_WIDTH;
  let height = WALLPAPER_DEFAULT_HEIGHT;
  const parts = [...args];

  const lastArg = parts[parts.length - 1] ?? '';
  const match = /^(\d{3,4})x(\d{3,4})$/i.exec(lastArg);

  if (match) {
    width = Math.min(3840, parseInt(match[1]!, 10));
    height = Math.min(2160, parseInt(match[2]!, 10));
    parts.pop();
  }

  const query = parts.join(' ').trim();
  return { query, width, height };
}

async function renderWallpaper(
  ctx: AppCtx,
  query: string,
  width: number,
  height: number,
): Promise<void> {
  const { chat, event, native, button: btn } = ctx;
  const isButtonAction = event['type'] === 'button_action';
  const buttonGrid = hasNativeButtons(native.platform) ? buildTagButtonGrid(btn) : [];

  let loadingId: string | undefined;
  if (!isButtonAction) {
    loadingId = (await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **Finding wallpaper...**\n🔎 Query: _${query || 'Random'}_ (${width}×${height})`,
    })) as string | undefined;
  }

  try {
    let url: string;
    let sourceName: string;

    if (query) {
      url = `https://loremflickr.com/${width}/${height}/${encodeURIComponent(query)}/all`;
      sourceName = 'LoremFlickr';
    } else {
      url = `https://picsum.photos/${width}/${height}`;
      sourceName = 'Picsum';
    }

    const { data } = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
      timeout: WALLPAPER_TIMEOUT,
      maxRedirects: 5,
    });

    const caption =
      `🖼️ **Wallpaper Generated**\n` +
      `📐 **Size:** ${width}×${height}\n` +
      `🔎 **Topic:** ${query || 'Random'}\n` +
      `📷 **Source:** ${sourceName}`;

    const wallpaperPayload = {
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment: [{ name: `wallpaper_${width}x${height}.jpg`, stream: Buffer.from(data) }],
      ...(buttonGrid.length > 0 ? { button: buttonGrid } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({ ...wallpaperPayload, message_id_to_edit: event['messageID'] as string });
      return;
    }
    if (loadingId) await chat.unsendMessage(loadingId).catch(() => {});
    await chat.replyMessage(wallpaperPayload);
  } catch (err) {
    const error = err as { message?: string; response?: { status?: number } };
    let errorMsg = `⚠️ **Generation Failed**\n\`${error.message ?? 'Unknown error'}\``;
    if (error.response?.status === 404) {
      errorMsg = `⚠️ **Not Found**\nCould not find a wallpaper for "_${query}_". Try a simpler term.`;
    }

    const errorPayload = {
      style: MessageStyle.MARKDOWN,
      message: errorMsg,
      ...(buttonGrid.length > 0 ? { button: buttonGrid } : {}),
    };

    if (isButtonAction) {
      await chat.editMessage({ ...errorPayload, message_id_to_edit: event['messageID'] as string });
      return;
    }
    if (loadingId) {
      await chat.editMessage({ ...errorPayload, message_id_to_edit: loadingId });
    } else {
      await chat.replyMessage(errorPayload);
    }
  }
}

// ── Shared button-set builder for the tagged family ────────────────────────────

function buildTagButtons(
  render: (ctx: AppCtx, tag: string) => Promise<void>,
): Record<string, { label: string; style: (typeof ButtonStyle)[keyof typeof ButtonStyle]; onClick: (ctx: AppCtx) => Promise<void> }> {
  return {
    [TAG_BUTTON_ID.random]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.random].label,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx) => render(ctx, TAG_PRESETS[TAG_BUTTON_ID.random].tag),
    },
    [TAG_BUTTON_ID.nature]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.nature].label,
      style: ButtonStyle.SECONDARY,
      onClick: async (ctx: AppCtx) => render(ctx, TAG_PRESETS[TAG_BUTTON_ID.nature].tag),
    },
    [TAG_BUTTON_ID.space]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.space].label,
      style: ButtonStyle.SUCCESS,
      onClick: async (ctx: AppCtx) => render(ctx, TAG_PRESETS[TAG_BUTTON_ID.space].tag),
    },
    [TAG_BUTTON_ID.city]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.city].label,
      style: ButtonStyle.DANGER,
      onClick: async (ctx: AppCtx) => render(ctx, TAG_PRESETS[TAG_BUTTON_ID.city].tag),
    },
    [TAG_BUTTON_ID.sunset]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.sunset].label,
      style: ButtonStyle.PRIMARY,
      onClick: async (ctx: AppCtx) => render(ctx, TAG_PRESETS[TAG_BUTTON_ID.sunset].tag),
    },
    [TAG_BUTTON_ID.anime]: {
      label: TAG_PRESETS[TAG_BUTTON_ID.anime].label,
      style: ButtonStyle.SECONDARY,
      onClick: async (ctx: AppCtx) => render(ctx, TAG_PRESETS[TAG_BUTTON_ID.anime].tag),
    },
  };
}

// Note: /wallpaper's buttons intentionally always regenerate at the default
// 1920×1080 size (matching the original standalone command) — a custom
// WxH passed to the initial /wallpaper call only applies to that first image.
const wallpaperButtonRender = (ctx: AppCtx, tag: string) =>
  renderWallpaper(ctx, tag, WALLPAPER_DEFAULT_WIDTH, WALLPAPER_DEFAULT_HEIGHT);

// ════════════════════════════════════════════════════════════════════════════
// Command entry generation
// ════════════════════════════════════════════════════════════════════════════

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
  button: Record<
    string,
    { label: string; style: (typeof ButtonStyle)[keyof typeof ButtonStyle]; onClick: (ctx: AppCtx) => Promise<void> }
  >;
}

const simpleCommands: CommandEntry[] = SIMPLE_PHOTO_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: config.version,
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: config.category,
    usage: '',
    cooldown: config.cooldown,
    hasPrefix: true,
  },
  onCommand: async (ctx: AppCtx) => renderSimplePhoto(ctx, config),
  button: {
    [SIMPLE_BUTTON_ID.repeat]: {
      label: config.buttonLabel,
      style: ButtonStyle.PRIMARY,
      onClick: (ctx: AppCtx) => renderSimplePhoto(ctx, config),
    },
  },
}));

const taggedCommands: CommandEntry[] = [
  {
    meta: {
      name: 'loremflickr',
      aliases: ['flickr'],
      version: '1.2.0',
      role: Role.ANYONE,
      author: 'AjiroDesu',
      description: 'Get a random photo from a fixed set of tags.',
      category: 'random',
      usage: '',
      cooldown: 5,
      hasPrefix: true,
    },
    onCommand: async (ctx: AppCtx) => {
      const tag = ctx.args.join(' ').trim();
      await renderLoremFlickr(ctx, tag);
    },
    button: buildTagButtons(renderLoremFlickr),
  },
  {
    meta: {
      name: 'wallpaper',
      aliases: ['wp', 'wall', 'background'],
      version: '1.5.0',
      role: Role.ANYONE,
      author: 'AjiroDesu',
      description: 'Get a random wallpaper (optionally specify size/topic).',
      category: 'random',
      usage: '[query] [WxH]',
      cooldown: 5,
      hasPrefix: true,
    },
    onCommand: async (ctx: AppCtx) => {
      const { query, width, height } = parseWallpaperArgs(ctx.args);
      await renderWallpaper(ctx, query, width, height);
    },
    button: buildTagButtons(wallpaperButtonRender),
  },
];

export const commands: CommandEntry[] = [...simpleCommands, ...taggedCommands];
