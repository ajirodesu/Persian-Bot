/**
 * Popcat Composite Media Service — shared implementation for /caption,
 * /discordmessage, and /opinion.
 *
 * Each endpoint's shape is declared in a config: whether it needs an image, a
 * single free-text field, or an "a | b" pair, plus which --flags it accepts.
 * The rendered image URL is forwarded directly through `attachment_url` — the
 * bot never downloads the bytes.
 */

import type { UrlParams } from '@/engine/lib/apis.lib.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import {
  resolveImageUrl,
  tryResolveSenderAvatar,
} from './image-input.service.js';
import { createMessageDelivery } from './message-delivery.service.js';

export const NO_COMPOSITE_IMAGE_MESSAGE =
  '📎 **Missing image.** Send a photo with this command, or reply to one, to continue.';

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

export interface PopcatMediaConfig {
  /** Command name — also the API path segment under /v2/. */
  name: string;
  /** Full path appended to the popcat base URL. */
  path: string;
  /** Display label used in reply messages / error text. */
  label: string;

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

  /** Params always sent exactly as given — no user-facing --flag exists for these. */
  fixedParams?: Record<string, string | number | boolean>;

  /** If set, auto-fills this API param with the sender's avatar when not given via a value flag. */
  autoAvatarParam?: string;
  /** If set, auto-fills this API param with the current ISO timestamp when not given via a value flag. */
  autoTimestampParam?: string;
  /**
   * Only meaningful alongside pipeParams. When true and the user types no
   * "a | b" pair, the entire input is treated as the second field's value and
   * the first field is auto-filled with the invoking user's display name.
   */
  autoFirstFromSender?: boolean;
}

/** Runs the shared composite-media flow for a family config. */
export async function runPopcatMedia(
  ctx: AppCtx,
  config: PopcatMediaConfig,
): Promise<void> {
  const { chat, args, usage } = ctx;

  const booleanFlagNames = config.booleanFlags ?? [];
  const valueFlagNames = config.valueFlags ?? [];
  const { text, values, flags } = parseArgs(
    args,
    booleanFlagNames,
    valueFlagNames,
  );

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
        message: NO_COMPOSITE_IMAGE_MESSAGE,
      });
      return;
    }
    params.image = imageUrl;
  }

  // ── Boolean flags (default false unless overridden in config.defaults) ──
  for (const flagName of booleanFlagNames) {
    params[flagName] =
      flags.has(flagName) || Boolean(config.defaults?.[flagName]);
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

  // ── Fixed params — always sent as configured, never user-overridable ──
  if (config.fixedParams) {
    for (const [key, value] of Object.entries(config.fixedParams)) {
      params[key] = value;
    }
  }

  // ── Auto-fill avatar / timestamp when not explicitly supplied ──
  if (config.autoAvatarParam && !params[config.autoAvatarParam]) {
    const avatar = await tryResolveSenderAvatar(ctx);
    if (avatar) params[config.autoAvatarParam] = avatar;
  }
  if (config.autoTimestampParam && !params[config.autoTimestampParam]) {
    params[config.autoTimestampParam] = new Date()
      .toISOString()
      .replace(/\.\d{3}Z$/, 'Z');
  }

  const delivery = createMessageDelivery(ctx, { fallbackOnEditFailure: true });

  try {
    const requestUrl = createUrl('popcat', config.path, params);

    await delivery.deliver({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **${config.label}**`,
      attachment_url: [{ name: `${config.name}.png`, url: requestUrl }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await delivery.fail(`⚠️ Failed to generate the image: \`${message}\``);
  }
}

export const captionConfig: PopcatMediaConfig = {
  name: 'caption',
  path: '/v2/caption',
  label: 'Caption',
  needsImage: true,
  textParam: 'text',
  // bottom/dark/fontsize are no longer user-configurable — every request uses
  // the endpoint's recommended defaults.
  fixedParams: { bottom: false, dark: true, fontsize: 30 },
};

export const discordMessageConfig: PopcatMediaConfig = {
  name: 'discordmessage',
  path: '/v2/discord-message',
  label: 'Discord Message',
  pipeParams: ['username', 'content'],
  valueFlags: ['avatar', 'color', 'timestamp'],
  autoAvatarParam: 'avatar',
  autoTimestampParam: 'timestamp',
  autoFirstFromSender: true,
};

export const opinionConfig: PopcatMediaConfig = {
  name: 'opinion',
  path: '/v2/opinion',
  label: 'Opinion',
  needsImage: true,
  textParam: 'text',
};
