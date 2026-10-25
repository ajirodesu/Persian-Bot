/**
 * Message Delivery — shared reply/edit flow for interactive commands.
 *
 * Commands that render a fresh result on invocation and re-render it in place
 * when a button is clicked share the same delivery rule:
 *
 *   - fresh invocation  → chat.replyMessage(payload)
 *   - button interaction → chat.editMessage({ ...payload, message_id_to_edit })
 *
 * Some families fall back to deleting the original message and sending a new
 * one when an edit fails; others deliberately let the edit error propagate.
 * That difference is opt-in via `fallbackOnEditFailure` so each command family
 * keeps its original behaviour.
 */

import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

export interface MessageDelivery {
  /** Sends a fresh reply, or edits the active button message in place. */
  deliver(payload: ReplyOptions): Promise<void>;
  /** Delivers a markdown error message using the same reply/edit rule. */
  fail(message: string): Promise<void>;
}

export interface MessageDeliveryOptions {
  /**
   * When true, a failed in-place edit deletes the original message and sends
   * a fresh reply. When false (default), the edit error propagates unchanged.
   */
  fallbackOnEditFailure?: boolean;
}

/** True when the current invocation originated from a button click. */
export function isButtonAction(ctx: AppCtx): boolean {
  return ctx.event['type'] === 'button_action';
}

/** Returns the active message ID for a button interaction, if any. */
export function getButtonMessageID(ctx: AppCtx): string | undefined {
  if (!isButtonAction(ctx)) return undefined;
  return ctx.event['messageID'] as string | undefined;
}

/**
 * Builds a reply/edit delivery pair bound to the current invocation context.
 *
 * The message ID is captured once so every retry/attempt in the calling
 * command edits the same original message.
 */
export function createMessageDelivery(
  ctx: AppCtx,
  options: MessageDeliveryOptions = {},
): MessageDelivery {
  const loadingId = getButtonMessageID(ctx);

  const deliver = async (payload: ReplyOptions): Promise<void> => {
    if (!loadingId) {
      await ctx.chat.replyMessage(payload);
      return;
    }

    try {
      await ctx.chat.editMessage({
        ...payload,
        message_id_to_edit: loadingId,
      });
    } catch (err) {
      if (!options.fallbackOnEditFailure) throw err;
      await ctx.chat.unsendMessage(loadingId).catch(() => {});
      await ctx.chat.reply(payload);
    }
  };

  return {
    deliver,
    fail: (message: string) =>
      deliver({ style: MessageStyle.MARKDOWN, message }),
  };
}
