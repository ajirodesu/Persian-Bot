import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { ButtonStyle } from '@/engine/constants/button-style.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { createUrl } from '@/engine/lib/apis.lib.js';

type NotificationResponse = {
  success?: boolean;
  cleared?: boolean;
  error?: string;
  message?: string;
};

const NOTIF_KEY = 'ajiro2005';
const REQUEST_TIMEOUT_MS = 15_000;
const RESET_KEYWORDS = ['reset', 'clear'];
const MESSAGE_PREVIEW_LIMIT = 200;

export const meta: CommandMeta = {
  name: 'notif',
  aliases: [],
  version: '1.2.0',
  role: Role.SYSTEM_ADMIN,
  author: 'AjiroDesu',
  description: 'Pushes a notification to the Aqua APIs dashboard notification feed, or resets the notification feed entirely.',
  category: 'System Admin',
  usage: '<message> | reset',
  cooldown: 10,
  hasPrefix: true,
};

// BUTTON_IDs are local keys — resolveButtons() prefixes them with "notif:" at dispatch time.
const BUTTON_ID = {
  confirmClear: 'confirm_clear',
  cancelClear: 'cancel_clear',
};

/**
 * Shared POST helper for the /api/notification endpoint. Centralizes the
 * timeout/abort handling and response parsing so send/reset/button paths
 * all behave identically.
 */
async function postNotification(
  body: Record<string, unknown>
): Promise<{ ok: boolean; data: NotificationResponse | null; statusText: string }> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(createUrl('aqua', '/api/notification'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        authorization: NOTIF_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const data = (await response.json().catch(() => null)) as NotificationResponse | null;
    return { ok: response.ok, data, statusText: response.statusText };
  } finally {
    clearTimeout(timeoutId);
  }
}

function truncate(text: string, limit: number): string {
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
}

/**
 * Button definitions for the reset confirmation step.
 * Keys match BUTTON_ID values; onClick receives the same ctx shape as onCommand.
 */
export const button = {
  [BUTTON_ID.confirmClear]: {
    label: '🗑️ Confirm',
    style: ButtonStyle.DANGER,
    onClick: async ({ chat, event }: AppCtx) => {
      const messageId = event['messageID'] as string;

      try {
        const { ok, data, statusText } = await postNotification({ clear: true });

        if (!ok || !data?.success) {
          await chat.editMessage({
            style: MessageStyle.MARKDOWN,
            message_id_to_edit: messageId,
            message: `❌ Failed to reset notifications: **${data?.error ?? statusText}**`,
          });
          return;
        }

        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: messageId,
          message: '🗑️ Notification feed cleared.',
        });
      } catch (error) {
        const err = error as Error;
        await chat.editMessage({
          style: MessageStyle.MARKDOWN,
          message_id_to_edit: messageId,
          message: `❌ Couldn't reach the notification API: \`${err.message}\``,
        });
      }
    },
  },

  [BUTTON_ID.cancelClear]: {
    label: '✖️ Cancel',
    style: ButtonStyle.SECONDARY,
    onClick: async ({ chat, event }: AppCtx) => {
      await chat.editMessage({
        style: MessageStyle.MARKDOWN,
        message_id_to_edit: event['messageID'] as string,
        message: 'Reset cancelled — the notification feed was left untouched.',
      });
    },
  },
};

export const onCommand = async ({ args, chat, usage, button }: AppCtx): Promise<void> => {
  const firstArg = (args[0] ?? '').toLowerCase();
  const isResetRequest = RESET_KEYWORDS.includes(firstArg);

  if (isResetRequest) {
    await chat.reply({
      style: MessageStyle.MARKDOWN,
      message:
        '⚠️ This will **permanently clear** the entire notification feed.\n' +
        'Are you sure you want to continue?',
      button: [
        button.generateID({ id: BUTTON_ID.confirmClear, public: true }),
        button.generateID({ id: BUTTON_ID.cancelClear, public: true }),
      ],
    });
    return;
  }

  const message = args.join(' ').trim();
  if (!message) {
    await usage();
    return;
  }

  try {
    const { ok, data, statusText } = await postNotification({ message });

    if (!ok || !data?.success) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Failed to send notification: **${data?.error ?? statusText}**`,
      });
      return;
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Notification sent!\n> ${truncate(message, MESSAGE_PREVIEW_LIMIT)}`,
    });
  } catch (error) {
    const err = error as Error;
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `❌ Couldn't reach the notification API: \`${err.message}\``,
    });
  }
};