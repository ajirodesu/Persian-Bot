/**
 * /picsum — Random Picsum Image
 *
 * Fetches a random photo from the Delirius picsum proxy. The endpoint
 * returns the rendered image directly (binary), not JSON. Includes a
 * 🔄 Repeat button so users can keep rolling without re-typing the command;
 * the refresh edits the existing message in place.
 *
 * Flow:
 *   User: /picsum
 *   Bot:  [random photo + 🔄 Repeat button]
 *   User: [clicks 🔄 Repeat]
 *   Bot:  [edits the same message with a fresh photo]
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { hasNativeButtons } from '@/engine/utils/ui-capabilities.util.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

// ── Fetcher ───────────────────────────────────────────────────────────────────

async function fetchPicsum(): Promise<Buffer> {
  const url = createUrl('delirius', '/random/picsum');
  const response = await fetch(url);

  if (!response.ok)
    throw new Error(`Picsum API responded with status ${response.status}`);

  const arrayBuffer = await response.arrayBuffer();
  if (!arrayBuffer.byteLength) throw new Error('Empty image returned');

  return Buffer.from(arrayBuffer);
}

// ── Config ────────────────────────────────────────────────────────────────────

export const meta: CommandMeta = {
  name: 'picsum',
  aliases: ['randomphoto'] as string[],
  version: '1.1.0',
  role: Role.ANYONE,
  author: 'AjiroDesu',
  description: 'Sends a random photo from Picsum.',
  category: 'random',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
};

const BUTTON_ID = { repeat: 'repeat' } as const;

// ── Core render logic ─────────────────────────────────────────────────────────
//
// Shared by the initial command and the Repeat button onClick. On refresh the
// existing message is edited in-place; otherwise a fresh reply is sent.

async function renderPicsum(ctx: AppCtx): Promise<void> {
  const { chat, event, native, button, session } = ctx;
  const isRefresh = event['type'] === 'button_action';

  try {
    const image = await fetchPicsum();

    // Reuse the active button instance ID on refresh so the button stays live.
    const buttonId = isRefresh
      ? session.id
      : button.generateID({ id: BUTTON_ID.repeat, public: true });

    const payload = {
      style: MessageStyle.MARKDOWN,
      message: '🖼️ **Random Picsum Photo**',
      attachment: [{ name: 'picsum.jpg', stream: image }],
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
      message: `⚠️ Failed to fetch a photo: \`${error.message ?? 'Unknown error'}\``,
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
    onClick: (ctx: AppCtx) => renderPicsum(ctx),
  },
};

// ── Entry point ───────────────────────────────────────────────────────────────

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  await renderPicsum(ctx);
};