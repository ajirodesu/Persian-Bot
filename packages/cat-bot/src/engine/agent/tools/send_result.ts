import type { AppCtx } from '@/engine/types/controller.types.js';
import { commandResultStore } from '../lib/command-result-store.lib.js';
import type {
  NamedStreamAttachment,
  NamedUrlAttachment,
  ButtonItem,
  ReplyMessageOptions,
} from '@/engine/adapters/models/interfaces/index.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { BinaryAttachment } from '../lib/command-result-store.lib.js';

/**
 * send_result tool — unified delivery of the model-synthesized response plus
 * captured attachments/buttons.
 *
 * Every AI turn ends here exactly once: normal conversation, command
 * success, permission failure, and command errors are ALL delivered through
 * send_result, so ai.ts suppresses any bare-text fallback and duplicate
 * replies are impossible. Keys are single-use and deleted after delivery.
 *
 * Key formats:
 *   attachment_key: `${baseKey}:a`   (URL attachments)
 *   binary key:     `${baseKey}:bin` (Buffer/Readable attachments)
 *   button_key:     `${baseKey}:b`   (button grids)
 */

export const config = {
  name: 'send_result',
  description:
    'Deliver a unified reply to the user combining your synthesized message text with ' +
    'URL attachments (attachment_url) and button grids captured by one or more test_command calls. ' +
    'Write the `message` yourself based on the `calls` content returned by test_command. ' +
    'Pass any non-null `attachment_key` values in `attachment_url` and any non-null ' +
    '`button_key` values in `button` — all entries are merged into a single platform reply. ' +
    'Run all needed test_command calls before calling this tool once to combine results. ' +
    'Each key is single-use and is deleted after delivery.',
  parameters: {
    type: 'object',
    properties: {
      message: {
        type: 'string',
        description:
          'Your synthesized reply text. Write this yourself based on the `calls` ' +
          'text returned by test_command — do not copy raw command output verbatim. ' +
          'This is the primary text the user will see.',
      },
      attachment_url: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of `attachment_key` values returned by test_command (the ' +
          '`attachment_key` field, not the main `key`). URL-based file attachments from ' +
          'all provided keys are merged into the single reply. Omit or pass [] when ' +
          'no commands produced attachments.',
      },
      attachment: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of `binary_attachment_key` values returned by test_command. ' +
          'Buffer-based file attachments from all provided keys are merged into the ' +
          'single reply. Omit or pass [] when no commands produced binary attachments.',
      },
      button: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of `button_key` values returned by test_command (the ' +
          '`button_key` field, not the main `key`). Button rows from all provided ' +
          'keys are stacked into one combined keyboard layout. Omit or pass [] when ' +
          'no commands produced buttons.',
      },
    },
    required: ['message'],
  },
};

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? (value as unknown[]).filter((v): v is string => typeof v === 'string')
    : [];
}

export const run = async (
  args: Record<string, unknown>,
  ctx: AppCtx,
): Promise<string> => {
  const message = typeof args['message'] === 'string' ? args['message'] : '';
  const attachmentUrlKeys = asStringArray(args['attachment_url']);
  const binaryKeys = asStringArray(args['attachment']);
  const buttonKeys = asStringArray(args['button']);

  const threadID = (ctx.event['threadID'] as string) || '';
  const replyToID = (ctx.event['messageID'] as string) || '';

  const allAttachmentUrls: NamedUrlAttachment[] = [];
  for (const aKey of attachmentUrlKeys) {
    const urls = commandResultStore.getAttachments(aKey);
    if (urls) allAttachmentUrls.push(...(urls as NamedUrlAttachment[]));
    // Always delete even when null — guard against stale/double-consumed keys
    commandResultStore.deleteAttachments(aKey);
  }

  const allBinaryAttachments: BinaryAttachment[] = [];
  for (const binKey of binaryKeys) {
    const binaries = commandResultStore.getBinaryAttachments(binKey);
    if (binaries) allBinaryAttachments.push(...binaries);
    commandResultStore.deleteBinaryAttachments(binKey);
  }

  const allButtonRows: ButtonItem[][] = [];
  for (const bKey of buttonKeys) {
    const grids = commandResultStore.getButtons(bKey);
    if (grids) {
      for (const grid of grids) {
        allButtonRows.push(...(grid as unknown as ButtonItem[][]));
      }
    }
    commandResultStore.deleteButtons(bKey);
  }

  // Always markdown — the model composes formatted text. Threaded to the
  // triggering message so the reply anchors to the initiating turn.
  const replyOptions: ReplyMessageOptions = {
    message,
    style: MessageStyle.MARKDOWN,
    ...(replyToID ? { reply_to_message_id: replyToID } : {}),
  };
  if (allAttachmentUrls.length > 0) {
    replyOptions.attachment_url = allAttachmentUrls;
  }
  if (allButtonRows.length > 0) replyOptions.button = allButtonRows;
  try {
    if (allBinaryAttachments.length > 0) {
      replyOptions.attachment =
        allBinaryAttachments as unknown as NamedStreamAttachment[];
    }
    await ctx.api.replyMessage(threadID, replyOptions);

    const parts: string[] = ['Message delivered.'];
    if (allAttachmentUrls.length > 0) {
      parts.push(`${allAttachmentUrls.length} attachment(s) included.`);
    }
    if (allButtonRows.length > 0) {
      parts.push(`${allButtonRows.length} button row(s) included.`);
    }
    if (allBinaryAttachments.length > 0) {
      parts.push(`${allBinaryAttachments.length} binary attachment(s) included.`);
    }
    return parts.join(' ');
  } catch (err) {
    return `Delivery failed: ${err instanceof Error ? err.message : String(err)}`;
  }
};
