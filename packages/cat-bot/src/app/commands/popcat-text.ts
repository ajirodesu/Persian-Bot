/**
 * Popcat Text Effects — multi-command family (single file)
 *
 * Every entry sends the user's text to a api.popcat.xyz/v2/<effect>?text=
 * endpoint and returns the rendered result as an image attachment. Every
 * endpoint serves the rendered image back via the result URL, which is
 * forwarded directly through `attachment_url` — the bot never downloads the
 * bytes.
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand }>` and registers each entry
 * exactly like a standalone command module.
 *
 * Flow (per command):
 *   User: /alert Something happened
 *   Bot:  [effect-rendered image]
 *
 * If the command is invoked with no text but is a reply to a message, the
 * replied-to message's text is used instead (mirrors the reply-fallback
 * convention used by other text-input commands, e.g. say.ts).
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

// ── Config table ──────────────────────────────────────────────────────────────

interface EffectConfig {
  name: string;
  path: string;
  label: string;
  description: string;
  example: string;
}

const EFFECT_CONFIGS: EffectConfig[] = [
  {
    name: 'alert',
    path: '/v2/alert',
    label: 'Alert',
    description: 'Render text as an iOS-style alert popup.',
    example: 'Something happened',
  },
  {
    name: 'biden',
    path: '/v2/biden',
    label: 'Biden Tweet',
    description: 'Render text as a Joe Biden tweet meme.',
    example: 'pop cat is horni',
  },
  {
    name: 'caution',
    path: '/v2/caution',
    label: 'Caution',
    description: 'Render text on a yellow caution sign.',
    example: 'Wet floor',
  },
  {
    name: 'couldread',
    path: '/v2/couldread',
    label: 'Could Read',
    description: 'Render text as a "bet you could read that" meme.',
    example: 'Never Gonna Give You Up',
  },
  {
    name: 'facts',
    path: '/v2/facts',
    label: 'Facts',
    description: 'Render text as a "facts" meme card.',
    example: 'Cats are liquid',
  },
  {
    name: 'pikachu',
    path: '/v2/pikachu',
    label: 'Pikachu',
    description: 'Render text as the surprised Pikachu meme caption.',
    example: 'hello',
  },
  {
    name: 'sadcat',
    path: '/v2/sadcat',
    label: 'Sadcat',
    description: 'Make a Sad Cat Meme!',
    example: 'hello',
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runEffect(
  ctx: AppCtx,
  config: EffectConfig,
): Promise<void> {
  const { event, args, usage } = ctx;

  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | null
    | undefined;

  // Text-first, falling back to the replied-to message's text when the
  // command itself was invoked with no arguments.
  const typed = args.join(' ').trim();
  const text = typed || ((messageReply?.['message'] as string) ?? '').trim();

  if (!text) {
    await usage();
    return;
  }

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
    const requestUrl = createUrl('popcat', config.path, { text });

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

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = EFFECT_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: [],
    version: '1.0.0',
    role: Role.ANYONE,
    author: 'AjiroDesu',
    description: config.description,
    category: 'image',
    usage: '<text> (or reply to a message)',
    cooldown: 8,
    hasPrefix: true,
    platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
    options: [
      {
        type: OptionType.string,
        name: 'text',
        description: `Text to render (e.g. "${config.example}")`,
        required: true,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runEffect(ctx, config),
}));