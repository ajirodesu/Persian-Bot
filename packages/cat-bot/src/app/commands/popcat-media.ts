/**
 * Popcat Composite Media — multi-command family (single file, config-driven)
 *
 * Same architecture as popcat.ts / popcat-text.ts: one EFFECT_CONFIGS table
 * declares each endpoint's shape (does it need an image? a single free-text
 * field? a "a | b" pair? which --flags does it accept?), and one shared
 * runEffect() dispatches on that config. Adding a new endpoint later means
 * appending one config object — no new onCommand function required.
 *
 * Every endpoint responds with the raw image bytes directly (no JSON
 * envelope), so the shared downloader validates the response before
 * attaching it.
 *
 * Commands:
 *   /caption          — overlay caption text on a photo (attach/reply/avatar)
 *   /discord-message  — render a fake Discord message screenshot
 *   /opinion          — overlay "opinion" meme text on a photo (attach/reply/avatar)
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand }>` and registers each entry
 * exactly like a standalone command module.
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta, CommandOption } from '@/engine/types/module-config.types.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { createUrl, type UrlParams } from '@/engine/lib/apis.lib.js';
import { AttachmentType } from '@/engine/adapters/models/enums/index.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

// ── Shared attachment resolution (same convention as popcat.ts) ────────────────

/** Minimal shape read off a unified attachment entry (see attachment.prototypes.ts). */
interface RawAttachment {
  type?: string;
  url?: string | null;
  filename?: string | null;
  name?: string | null;
}

const IMAGE_EXT_RE = /\.(jpe?g|png|gif|webp|bmp)(?:\?.*)?$/i;

/**
 * True when a raw attachment looks like a static/animated image.
 * Telegram tags images as 'photo' (and gifs as 'gif'); Discord tags every
 * attachment as generic 'file', so filename/url extension is the fallback.
 */
function isImageAttachment(att: RawAttachment): boolean {
  const type = (att.type ?? '').toLowerCase();
  if (
    type === AttachmentType.PHOTO ||
    type === AttachmentType.ANIMATED_IMAGE ||
    type === 'gif'
  ) {
    return true;
  }
  const probe = att.filename ?? att.name ?? att.url ?? '';
  return IMAGE_EXT_RE.test(probe);
}

/**
 * Resolves an image URL from the triggering message first, falling back to
 * the replied-to message. If the reply exists but carries no image, falls
 * back to the replied-to user's profile picture. If there's no reply at
 * all, falls back to the invoking user's own profile picture. Avatar
 * lookups only happen on Discord/Telegram, since UnifiedApi's
 * getAvatarUrl() throws on platforms that don't implement it (e.g. Webchat),
 * rather than returning null.
 */
async function resolveImageUrl(ctx: AppCtx): Promise<string | null> {
  const event = ctx.event;

  const direct = (event['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromDirect = direct.find((a) => a?.url && isImageAttachment(a));
  if (fromDirect?.url) return fromDirect.url;

  const reply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;
  const replyAttachments =
    (reply?.['attachments'] as RawAttachment[] | undefined) ?? [];
  const fromReply = replyAttachments.find((a) => a?.url && isImageAttachment(a));
  if (fromReply?.url) return fromReply.url;

  const platform = ctx.native.platform;
  if (platform !== Platforms.Discord && platform !== Platforms.Telegram) {
    return null;
  }

  const replySenderID = reply?.['senderID'] as string | undefined;
  const senderID = replySenderID || (event['senderID'] as string | undefined);
  if (!senderID) return null;

  try {
    return await ctx.api.getAvatarUrl(senderID);
  } catch {
    // No avatar available for this user on this platform — no image to use.
    return null;
  }
}

/** Best-effort avatar lookup, swallowing platforms/errors where it isn't available. */
async function tryResolveSenderAvatar(ctx: AppCtx): Promise<string | undefined> {
  const platform = ctx.native.platform;
  if (platform !== Platforms.Discord && platform !== Platforms.Telegram) {
    return undefined;
  }
  const senderID = ctx.event['senderID'] as string | undefined;
  if (!senderID) return undefined;
  try {
    return (await ctx.api.getAvatarUrl(senderID)) ?? undefined;
  } catch {
    return undefined;
  }
}

const NO_IMAGE_MESSAGE =
  '📎 **Missing image.** Send a photo with this command, or reply to one, to continue.';

// ── Outbound request headers ─────────────────────────────────────────────────
//
// A standard desktop User-Agent/Accept pair avoids basic bot-protection
// rejections some free API providers apply to headerless requests.
const REQUEST_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'image/*,*/*;q=0.8',
};

/** Best-effort decode of a non-2xx response body for diagnostics. */
function describeErrorBody(data: ArrayBuffer): string {
  try {
    const text = Buffer.from(data).toString('utf8').trim().slice(0, 300);
    if (!text) return '(empty body)';
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const reason = parsed['message'] ?? parsed['error'] ?? parsed['msg'];
      if (typeof reason === 'string') return reason;
    } catch {
      // not JSON — fall through to raw text
    }
    return text;
  } catch {
    return '(unreadable body)';
  }
}

/** Picks a sensible file extension from the response Content-Type header. */
function extFromContentType(contentType: unknown): string {
  const type = String(contentType ?? '').toLowerCase();
  if (type.includes('gif')) return 'gif';
  if (type.includes('webp')) return 'webp';
  if (type.includes('jpeg') || type.includes('jpg')) return 'jpg';
  return 'png';
}

/**
 * Downloads the rendered image ourselves (rather than handing a bare URL to
 * attachment_url) so a non-2xx response is caught and reported here with a
 * clear, per-command message.
 */
async function fetchRenderedImage(
  requestUrl: string,
  context: string,
  label: string,
): Promise<{ buffer: Buffer; ext: string }> {
  const response = await axios.get<ArrayBuffer>(requestUrl, {
    responseType: 'arraybuffer',
    timeout: 30_000,
    headers: REQUEST_HEADERS,
    validateStatus: () => true,
  });

  if (response.status < 200 || response.status >= 300) {
    const reason = describeErrorBody(response.data);
    logger.warn(
      `[popcat-media] ${label} failed (status ${response.status}): ${reason} | request=${requestUrl} | context=${context}`,
    );
    throw new Error(`${label} API responded with status ${response.status}: ${reason}`);
  }

  const buffer = Buffer.from(response.data);
  if (!buffer.length) throw new Error(`${label} API returned an empty image`);

  return { buffer, ext: extFromContentType(response.headers['content-type']) };
}

// ── Flag parsing (same --flag / --flag=value convention as bible.ts) ───────────

interface ParsedArgs {
  /** Remaining positional text, with every recognized flag stripped out. */
  text: string;
  /** Value flags captured as --name=value or --name value. */
  values: Record<string, string>;
  /** Boolean flags captured as a bare --name. */
  flags: Set<string>;
}

function parseArgs(
  args: string[],
  booleanFlagNames: string[],
  valueFlagNames: string[],
): ParsedArgs {
  const values: Record<string, string> = {};
  const flags = new Set<string>();
  const rest: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    const eqMatch = arg.match(/^--([a-zA-Z]+)=(.*)$/);
    if (eqMatch && valueFlagNames.includes(eqMatch[1]!.toLowerCase())) {
      values[eqMatch[1]!.toLowerCase()] = eqMatch[2]!;
      continue;
    }

    const bareMatch = arg.match(/^--([a-zA-Z]+)$/);
    if (bareMatch) {
      const name = bareMatch[1]!.toLowerCase();
      if (valueFlagNames.includes(name) && args[i + 1] !== undefined) {
        values[name] = args[i + 1]!;
        i++;
        continue;
      }
      if (booleanFlagNames.includes(name)) {
        flags.add(name);
        continue;
      }
    }

    rest.push(arg);
  }

  return { text: rest.join(' ').trim(), values, flags };
}

// ── Config table ──────────────────────────────────────────────────────────────
//
// Each entry fully describes one endpoint's shape. runEffect() below reads
// this declaratively — no per-command onCommand function needed.

interface EndpointConfig {
  /** Command name — also the API path segment under /v2/. */
  name: string;
  /** Full path appended to the popcat base URL. */
  path: string;
  /** Display label used in reply messages / error text. */
  label: string;
  description: string;
  /** Example value shown in usage/option hints. */
  example: string;
  aliases?: string[];

  /** True when the command must resolve an image (attach/reply/avatar) → sent as `image`. */
  needsImage?: boolean;

  /** Single free-text field, e.g. `text` — sent under this API param name. */
  textParam?: string;

  /** "<a> | <b>" pair, e.g. ['username', 'content'] — both sent as their own API params. */
  pipeParams?: [string, string];

  /** API params toggled by a bare --flag (e.g. --bottom, --dark). */
  booleanFlags?: string[];
  /** API params set via --flag=value or --flag value (e.g. --fontsize=30). */
  valueFlags?: string[];
  /** Default values applied when a flag/value isn't supplied. */
  defaults?: Record<string, string | number | boolean>;

  /** If set, auto-fills this API param with the sender's avatar when not given via a value flag. */
  autoAvatarParam?: string;
  /** If set, auto-fills this API param with the current ISO timestamp when not given via a value flag. */
  autoTimestampParam?: string;
  /**
   * Only meaningful alongside pipeParams. When true and the user types no
   * "a | b" pair, the entire input is treated as the second field's value
   * (e.g. content) and the first field (e.g. username) is auto-filled with
   * the invoking user's display name.
   */
  autoFirstFromSender?: boolean;
}

const EFFECT_CONFIGS: EndpointConfig[] = [
  {
    name: 'caption',
    path: '/v2/caption',
    label: 'Caption',
    description: 'Overlay caption text on a photo (attach, reply, or avatar).',
    example: 'Zero Two Caption',
    needsImage: true,
    textParam: 'text',
    booleanFlags: ['bottom', 'dark'],
    valueFlags: ['fontsize'],
    defaults: { bottom: false, dark: false, fontsize: 30 },
  },
  {
    name: 'discord-message',
    path: '/v2/discord-message',
    label: 'Discord Message',
    description:
      'Render a fake Discord message screenshot. If only content is given (no "username | content" pair), your own display name is used as the username.',
    example: 'Pop Cat | Hello I am Pop Cat! I hope you enjoying my api!! pop pop',
    aliases: ['dmsg'],
    pipeParams: ['username', 'content'],
    valueFlags: ['avatar', 'color', 'timestamp'],
    autoAvatarParam: 'avatar',
    autoTimestampParam: 'timestamp',
    autoFirstFromSender: true,
  },
  {
    name: 'opinion',
    path: '/v2/opinion',
    label: 'Opinion',
    description: 'Overlay "opinion" meme text on a photo (attach, reply, or avatar).',
    example: 'popcatdev api sucks',
    needsImage: true,
    textParam: 'text',
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runEffect(ctx: AppCtx, config: EndpointConfig): Promise<void> {
  const { chat, args, usage } = ctx;

  const booleanFlagNames = config.booleanFlags ?? [];
  const valueFlagNames = config.valueFlags ?? [];
  const { text, values, flags } = parseArgs(args, booleanFlagNames, valueFlagNames);

  const params: UrlParams = {};

  // ── Positional text: either a single field or a "a | b" pair ──
  if (config.pipeParams) {
    const [firstKey, secondKey] = config.pipeParams;
    const pipeIndex = text.indexOf('|');

    let firstVal: string;
    let secondVal: string;

    if (pipeIndex === -1) {
      // No "a | b" pair typed. When configured, treat the whole input as
      // the second field (e.g. content) and fall back to the sender's own
      // display name for the first field (e.g. username).
      secondVal = text.trim();
      firstVal = '';

      if (config.autoFirstFromSender && secondVal) {
        const senderID = ctx.event['senderID'] as string | undefined;
        if (senderID) {
          try {
            firstVal = await ctx.user.getName(senderID);
          } catch {
            firstVal = '';
          }
        }
      }
    } else {
      firstVal = text.slice(0, pipeIndex).trim();
      secondVal = text.slice(pipeIndex + 1).trim();
    }

    if (!firstVal || !secondVal) {
      await usage();
      return;
    }
    params[firstKey] = firstVal;
    params[secondKey] = secondVal;
  } else if (config.textParam) {
    if (!text) {
      await usage();
      return;
    }
    params[config.textParam] = text;
  }

  // ── Image resolution ──
  if (config.needsImage) {
    const imageUrl = await resolveImageUrl(ctx);
    if (!imageUrl) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: NO_IMAGE_MESSAGE,
      });
      return;
    }
    params.image = imageUrl;
  }

  // ── Boolean flags (default false unless overridden in config.defaults) ──
  for (const flagName of booleanFlagNames) {
    params[flagName] = flags.has(flagName) || Boolean(config.defaults?.[flagName]);
  }

  // ── Value flags (numeric coercion when the default is a number) ──
  for (const flagName of valueFlagNames) {
    const raw = values[flagName];
    const fallback = config.defaults?.[flagName];

    if (raw !== undefined) {
      if (typeof fallback === 'number') {
        const num = Number(raw);
        params[flagName] = Number.isFinite(num) ? num : fallback;
      } else {
        params[flagName] = raw;
      }
    } else if (fallback !== undefined) {
      params[flagName] = fallback;
    }
  }

  // ── Auto-fill avatar / timestamp when not explicitly supplied ──
  if (config.autoAvatarParam && !params[config.autoAvatarParam]) {
    const avatar = await tryResolveSenderAvatar(ctx);
    if (avatar) params[config.autoAvatarParam] = avatar;
  }
  if (config.autoTimestampParam && !params[config.autoTimestampParam]) {
    params[config.autoTimestampParam] = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  try {
    const requestUrl = createUrl('popcat', config.path, params);
    const { buffer, ext } = await fetchRenderedImage(
      requestUrl,
      JSON.stringify(params),
      config.label,
    );

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **${config.label}**`,
      attachment: [{ name: `${config.name}.${ext}`, stream: buffer }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to generate the image: \`${message}\``,
    });
  }
}

// ── Dynamic meta generation ──────────────────────────────────────────────────

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function buildUsage(config: EndpointConfig): string {
  const flagNames = [...(config.booleanFlags ?? []), ...(config.valueFlags ?? [])];
  const flagHints = flagNames.map((f) =>
    (config.booleanFlags ?? []).includes(f) ? `[--${f}]` : `[--${f}=<value>]`,
  );

  const base = config.pipeParams
    ? config.autoFirstFromSender
      ? `[${config.pipeParams[0]} |] <${config.pipeParams[1]}>`
      : `<${config.pipeParams[0]}> | <${config.pipeParams[1]}>`
    : config.textParam
      ? `<${config.textParam}>`
      : '';

  return [base, ...flagHints].filter(Boolean).join(' ');
}

function buildOptions(config: EndpointConfig): CommandOption[] {
  const options: CommandOption[] = [];

  if (config.pipeParams) {
    const [firstKey, secondKey] = config.pipeParams;
    options.push({
      type: OptionType.string,
      name: firstKey,
      description: config.autoFirstFromSender
        ? `${capitalize(firstKey)} value (defaults to your display name if omitted)`
        : `${capitalize(firstKey)} value`,
      required: !config.autoFirstFromSender,
    });
    options.push({
      type: OptionType.string,
      name: secondKey,
      description: `${capitalize(secondKey)} value`,
      required: true,
    });
  } else if (config.textParam) {
    options.push({
      type: OptionType.string,
      name: config.textParam,
      description: `Text to render (e.g. "${config.example}")`,
      required: true,
    });
  }

  const flagNames = [...(config.booleanFlags ?? []), ...(config.valueFlags ?? [])];
  if (flagNames.length) {
    const hints = flagNames.map((f) =>
      (config.booleanFlags ?? []).includes(f) ? `--${f}` : `--${f}=<value>`,
    );
    options.push({
      type: OptionType.string,
      name: 'flags',
      description: `Optional: ${hints.join(', ')}`,
      required: false,
    });
  }

  return options;
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = EFFECT_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases ?? [],
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'image',
    usage: buildUsage(config),
    cooldown: 8,
    hasPrefix: true,
    platform: [
    Platforms.Discord,
    Platforms.Telegram,
  ],
    options: buildOptions(config),
  },
  onCommand: async (ctx: AppCtx) => runEffect(ctx, config),
}));