/**
 * /waifu — Random Anime Waifu Image
 *
 * Fetches a random waifu image from the Delirius API and sends it along
 * with its metadata (title, likes, size, source). Includes a 🔄 Repeat
 * button so users can keep rolling without re-typing the command; the
 * refresh edits the existing message in place.
 *
 * Flow:
 *   User: /waifu
 *   Bot:  [waifu image + caption + 🔄 Repeat button]
 *   User: [clicks 🔄 Repeat]
 *   Bot:  [edits the same message with a fresh waifu]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface WaifuData {
  id: number;
  title: string;
  likes: number;
  image: string;
  size: string;
  upload: string;
  ext: string;
  nsfw: boolean;
  source: string;
}

interface WaifuResponse {
  status: boolean;
  data?: WaifuData;
}

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchWaifu(): Promise<WaifuData> {
  const url = createUrl('delirius', '/anime/waifu');
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Waifu API responded with status ${response.status}`);

  const data = (await response.json()) as WaifuResponse;
  if (!data.status || !data.data) throw new Error('Invalid response from Waifu API');

  return data.data;
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'waifu',
  aliases: ['randomwaifu'] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Sends a random anime waifu image.',
  category: 'Anime',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

const BUTTON_ID = { repeat: 'repeat' } as const;

// ── Core render logic ─────────────────────────────────────────────────────────
//
// Shared by the initial command and the Repeat button onClick. On refresh the
// existing message is edited in-place; otherwise a fresh reply is sent.

async function renderWaifu(ctx: AppCtx): Promise<void> {
  const { chat, event, native, button, session } = ctx;
  const isRefresh = event['type'] === 'button_action';

  try {
    const waifu = await fetchWaifu();

    // Reuse the active button instance ID on refresh so the button stays live.
    const buttonId = isRefresh
      ? session.id
      : button.generateID({ id: BUTTON_ID.repeat, public: true });

    // Skip attaching flagged content — reply with a plain notice instead of the image.
    if (waifu.nsfw) {
      const notice = {
        style: MessageStyle.MARKDOWN,
        message: '⚠️ Got an NSFW-flagged result — try again for a different one.',
      };
      if (isRefresh) {
        await chat.editMessage({
          ...notice,
          message_id_to_edit: event['messageID'] as string,
        });
      } else {
        await chat.replyMessage(notice);
      }
      return;
    }

    const caption =
      `🌸 **${waifu.title}**\n` +
      ` • ❤️ **Likes:** ${waifu.likes}\n` +
      ` • 📦 **Size:** ${waifu.size}\n` +
      ` • 📅 **Uploaded:** ${waifu.upload}\n` +
      ` • 🔗 **Source:** ${waifu.source}`;

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: caption,
      attachment_url: [{ name: `waifu_${waifu.id}${waifu.ext}`, url: waifu.image }],
      ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
    };

    if (isRefresh) {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(payload);
    }
  } catch (err) {
    const error = err as { message?: string };
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message: `⚠️ Failed to fetch a waifu image: \`${error.message ?? 'Unknown error'}\``,
    };
    if (isRefresh) {
      await chat.editMessage({
        ...errPayload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
}

// ── Button definitions ────────────────────────────────────────────────────────

export const button = {
  [BUTTON_ID.repeat]: {
    label: '🔄 Refresh',
    style: ButtonStyle.PRIMARY,
    onClick: (ctx: AppCtx) => renderWaifu(ctx),
  },
};

// ── Entry point ───────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  await renderWaifu(ctx);
};