/**
 * Popcat Two-Panel Memes — multi-command family (single file, config-driven)
 *
 * Same architecture as popcat.ts / popcat-text.ts / popcat-media.ts: one
 * EFFECT_CONFIGS table declares each endpoint (path, label, example text
 * for both panels), and one shared runEffect() dispatches on that config.
 * Adding another two-panel meme later means appending one config object —
 * no new onCommand function required.
 *
 * Every endpoint takes a `text1` / `text2` pair and serves the rendered meme
 * back via the result URL, which is forwarded directly through
 * `attachment_url` — the bot never downloads the bytes.
 *
 * Commands:
 *   /drake  — Drake disapprove/approve meme
 *   /pooh   — Regular Pooh / Fancy Pooh meme
 *
 * Flow (per command):
 *   User: /drake amongus | amogus
 *   Bot:  [effect-rendered image]
 *
 * If invoked with no "|" pair but as a reply to a message, that message's
 * text is used as text2 (top/first panel is left for the caller to type),
 * mirroring the reply-fallback convention used by other text-input
 * commands (see say.ts, popcat-text.ts).
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta, CommandOption } from '@/engine/types/module-meta.types.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { createUrl, type UrlParams } from '@/engine/lib/apis.lib.js';

// ── Config table ──────────────────────────────────────────────────────────────

interface EndpointConfig {
  /** Command name — also the API path segment under /v2/. */
  name: string;
  /** Full path appended to the popcat base URL. */
  path: string;
  /** Display label used in reply messages / error text. */
  label: string;
  description: string;
  /** Example values shown in usage/option hints. */
  example1: string;
  example2: string;
  aliases?: string[];
}

const EFFECT_CONFIGS: EndpointConfig[] = [
  {
    name: 'drake',
    path: '/v2/drake',
    label: 'Drake',
    description: 'Render the Drake disapprove/approve meme.',
    example1: 'amongus',
    example2: 'amogus',
  },
  {
    name: 'pooh',
    path: '/v2/pooh',
    label: 'Pooh',
    description: 'Render the regular Pooh / fancy Pooh meme.',
    example1: 'making a discord bot',
    example2: 'making an api',
    aliases: ['poohmeme'],
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runEffect(ctx: AppCtx, config: EndpointConfig): Promise<void> {
  const { event, args, usage } = ctx;

  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;

  const rawInput = args.join(' ');
  const pipeIndex = rawInput.indexOf('|');

  let text1: string;
  let text2: string;

  if (pipeIndex !== -1) {
    text1 = rawInput.slice(0, pipeIndex).trim();
    text2 = rawInput.slice(pipeIndex + 1).trim();
  } else {
    // No "a | b" pair typed — treat the whole input as the first panel and
    // fall back to the replied-to message's text for the second panel.
    text1 = rawInput.trim();
    text2 = ((messageReply?.['message'] as string) ?? '').trim();
  }

  if (!text1 || !text2) {
    await usage();
    return;
  }

  const params: UrlParams = { text1, text2 };

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
    const requestUrl = createUrl('popcat', config.path, params);

    await finish({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **${config.label}**`,
      attachment_url: [{ name: `${config.name}.png`, url: requestUrl }],
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await fail(`⚠️ Failed to generate the image: \`${message}\``);
  }
}

// ── Dynamic meta generation ──────────────────────────────────────────────────

function buildOptions(config: EndpointConfig): CommandOption[] {
  return [
    {
      type: OptionType.string,
      name: 'text1',
      description: `First panel text (e.g. "${config.example1}")`,
      required: true,
    },
    {
      type: OptionType.string,
      name: 'text2',
      description: `Second panel text (e.g. "${config.example2}")`,
      required: true,
    },
  ];
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
    usage: `<text1> | <text2> (or reply for text2)`,
    cooldown: 8,
    hasPrefix: true,
    options: buildOptions(config),
  },
  onCommand: async (ctx: AppCtx) => runEffect(ctx, config),
}));