/**
 * /duck — Random Duck Image
 *
 * Fetches a random duck image (or occasionally a gif) from the random-d.uk
 * API and sends it as an image attachment with a persistent "🔁 Another
 * Duck" button.
 *
 * Flow:
 *   User: /duck
 *   Bot:  [duck image/gif + caption + 🔁 Another Duck button, threaded under user's message on Telegram]
 *   User: [clicks 🔁 Another Duck]
 *   Bot:  [edits the same message with a fresh duck image — button stays]
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

interface RandomDuckResponse {
  url: string;
  message?: string;
}

async function fetchDuck(): Promise<string | null> {
  try {
    const { data } = await axios.get<RandomDuckResponse>(
      'https://random-d.uk/api/random',
      {
        headers: { Accept: 'application/json' },
        timeout: 10000,
      },
    );
    return data?.url || null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[duck] fetchDuck error:', msg);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'duck',
  aliases: ['duckpic', 'duckimage', 'quack'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Send a random duck image.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button ────────────────────────────────────────────────────────────────────

const BUTTON_ID = { next: 'next' } as const;

export const button = {
  [BUTTON_ID.next]: {
    label: '🔁 Another Duck',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session } = ctx;

  try {
    const imageUrl = await fetchDuck();

    if (!imageUrl) {
      const errPayload = {
        style: MessageStyle.MARKDOWN,
        message: '⚠️ **Error:** Could not retrieve a duck image.',
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
    // platforms — random-d.uk serves both static images and gifs.
    const extMatch = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
    const ext = extMatch ? extMatch[1] : 'jpg';

    const buttonId =
      event['type'] === 'button_action'
        ? session.id
        : button.generateID({ id: BUTTON_ID.next, public: true });

    if (event['type'] === 'button_action') {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message: '🦆 **Random Duck Image**',
        attachment_url: [{ name: `duck.${ext}`, url: imageUrl }],
        message_id_to_edit: event['messageID'] as string,
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    } else {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '🦆 **Random Duck Image**',
        attachment_url: [{ name: `duck.${ext}`, url: imageUrl }],
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    }
  } catch {
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message:
        '⚠️ **System Error:** Failed to fetch a duck image. Please try again later.',
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