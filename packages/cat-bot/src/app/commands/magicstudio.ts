/**
 * /magicstudio — Magic Studio Text-to-Image Generator
 *
 * Generates an image from a text prompt via the Nexray "magicstudio"
 * endpoint. The endpoint returns the rendered image directly (binary), not
 * JSON, so the response body is downloaded and forwarded as an attachment.
 *
 * Flow:
 *   User: /magicstudio anime girl with short blue hair
 *   Bot:  [generated image + prompt caption]
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchMagicStudioImage(prompt: string): Promise<Buffer> {
  const url = createUrl('nexray', '/ai/magicstudio', { prompt });
  const response = await fetch(url);

  if (!response.ok)
    throw new Error(`Magic Studio API responded with status ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength) throw new Error('Empty image returned');

  return Buffer.from(arrayBuffer);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Resolves the prompt from args, falling back to a quoted/replied message. */
function resolvePrompt(ctx: AppCtx): string {
  const fromArgs = ctx.args.join(' ').trim();
  if (fromArgs) return fromArgs;

  const messageReply = ctx.event['messageReply'] as
    | Record<string, unknown>
    | undefined;
  if (typeof messageReply?.['message'] === 'string')
    return (messageReply['message'] as string).trim();

  return '';
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'magicstudio',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Generate an image from a text prompt using Magic Studio.',
  category: 'AI Image',
  usage: '<prompt>',
  cooldown: 10,
  hasPrefix: true,
};

// ── Command Handler ───────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { usage } = ctx;
  const prompt = resolvePrompt(ctx);

  if (!prompt) {
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
    const image = await fetchMagicStudioImage(prompt);
    await finish({
      style: MessageStyle.MARKDOWN,
      message: `🖼️ **Prompt:** ${prompt}`,
      attachment: [{ name: 'magicstudio.png', stream: image }],
    });
  } catch (err) {
    const error = err as { message?: string };
    await fail(`⚠️ Failed to generate the image: \`${error.message ?? 'Unknown error'}\``);
  }
};
