/**
 * /cat — Random Cat Image
 *
 * Fetches a random cat image from The Cat API and sends it as an image
 * attachment with a persistent "🔁 Another Cat" button. Occasionally serves
 * an animated GIF alongside static photos.
 *
 * Flow:
 *   User: /cat
 *   Bot:  [cat image + caption + 🔁 Another Cat button, threaded under user's message on Telegram]
 *   User: [clicks 🔁 Another Cat]
 *   Bot:  [edits the same message with a fresh cat image — button stays]
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

interface CatApiImage {
  url: string;
}

async function fetchCat(): Promise<string | null> {
  try {
    const { data } = await axios.get<CatApiImage[]>(
      'https://api.thecatapi.com/v1/images/search',
      {
        params: { mime_types: 'jpg,png,gif' },
        headers: { Accept: 'application/json' },
        timeout: 10000,
      },
    );
    return data?.[0]?.url || null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[cat] fetchCat error:', msg);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'cat',
  aliases: ['catpic', 'catimage', 'meow'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Send a random cat image.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button ────────────────────────────────────────────────────────────────────

const BUTTON_ID = { next: 'next' } as const;

export const button = {
  [BUTTON_ID.next]: {
    label: '🔁 Another Cat',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session } = ctx;

  try {
    const imageUrl = await fetchCat();

    if (!imageUrl) {
      const errPayload = {
        style: MessageStyle.MARKDOWN,
        message: '⚠️ **Error:** Could not retrieve a cat image.',
      };
      if (event['type'] === 'button_action') {
        await chat.editMessage({
          ...errPayload,
          message_id_to_edit: event['messageID'] as string,
        });
      } else {
        await chat.replyMessage(errPayload);
      }
      return;
    }

    // Derive the file extension so MIME detection works correctly on all
    // platforms — The Cat API serves both static images and gifs.
    const extMatch = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
    const ext = extMatch ? extMatch[1] : 'jpg';

    const buttonId =
      event['type'] === 'button_action'
        ? session.id
        : button.generateID({ id: BUTTON_ID.next, public: true });

    if (event['type'] === 'button_action') {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message: '🐱 **Random Cat Image**',
        attachment_url: [{ name: `cat.${ext}`, url: imageUrl }],
        message_id_to_edit: event['messageID'] as string,
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    } else {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '🐱 **Random Cat Image**',
        attachment_url: [{ name: `cat.${ext}`, url: imageUrl }],
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    }
  } catch {
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message:
        '⚠️ **System Error:** Failed to fetch a cat image. Please try again later.',
    };
    if (event['type'] === 'button_action') {
      await chat.editMessage({
        ...errPayload,
        message_id_to_edit: event['messageID'] as string,
      });
    } else {
      await chat.replyMessage(errPayload);
    }
  }
};