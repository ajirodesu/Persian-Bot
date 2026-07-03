/**
 * /coffee — Random Coffee Image
 *
 * Fetches a random coffee picture from the Coffee API (alexflipnote.dev) and
 * sends it as an image attachment with a persistent "🔁 Another Cup" button.
 *
 * Flow:
 *   User: /coffee
 *   Bot:  [coffee image + caption + 🔁 Another Cup button, threaded under user's message on Telegram]
 *   User: [clicks 🔁 Another Cup]
 *   Bot:  [edits the same message with a fresh coffee image — button stays]
 */

import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

interface RandomCoffeeResponse {
  file: string;
}

async function fetchCoffee(): Promise<string | null> {
  try {
    const { data } = await axios.get<RandomCoffeeResponse>(
      'https://coffee.alexflipnote.dev/random.json',
      {
        headers: { Accept: 'application/json' },
        timeout: 10000,
      },
    );
    return data?.file || null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[coffee] fetchCoffee error:', msg);
    return null;
  }
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'coffee',
  aliases: ['coffeepic', 'coffeeimage', 'brew'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Send a random coffee image.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

// ── Button ────────────────────────────────────────────────────────────────────

const BUTTON_ID = { next: 'next' } as const;

export const button = {
  [BUTTON_ID.next]: {
    label: '🔁 Another Cup',
    style: ButtonStyle.PRIMARY,
    onClick: async (ctx: AppCtx) => onCommand(ctx),
  },
};

// ── Command ───────────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, native, event, button, session } = ctx;

  try {
    const imageUrl = await fetchCoffee();

    if (!imageUrl) {
      const errPayload = {
        style: MessageStyle.MARKDOWN,
        message: '⚠️ **Error:** Could not retrieve a coffee image.',
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

    // Derive the file extension so MIME detection works correctly on all platforms
    const extMatch = imageUrl.match(/\.(jpg|jpeg|png|gif|webp)(\?|$)/i);
    const ext = extMatch ? extMatch[1] : 'jpg';

    const buttonId =
      event['type'] === 'button_action'
        ? session.id
        : button.generateID({ id: BUTTON_ID.next, public: true });

    if (event['type'] === 'button_action') {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message: '☕ **Random Coffee Image**',
        attachment_url: [{ name: `coffee.${ext}`, url: imageUrl }],
        message_id_to_edit: event['messageID'] as string,
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    } else {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: '☕ **Random Coffee Image**',
        attachment_url: [{ name: `coffee.${ext}`, url: imageUrl }],
        ...(hasNativeButtons(native.platform) ? { button: [buttonId] } : {}),
      });
    }
  } catch {
    const errPayload = {
      style: MessageStyle.MARKDOWN,
      message:
        '⚠️ **System Error:** Failed to fetch a coffee image. Please try again later.',
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