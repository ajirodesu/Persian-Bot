/**
 * Media Loading Helper
 *
 * Standardizes the "loading message" flow for commands that fetch/generate
 * media (images, video, etc.) before replying. Previously, several commands
 * implemented this in three different, all-suboptimal ways:
 *
 *   1. No loading message at all — the user sees nothing happen for the
 *      full duration of a slow upstream API/render call (common on
 *      generation endpoints like text2image/ideogram/magicstudio).
 *   2. Loading message sent, then *deleted*, then the media reply sent as a
 *      brand new message (shoti.ts, and the pre-refactor version of several
 *      others). This costs THREE network round trips to the platform API
 *      (send loading, delete loading, send result) instead of one, and
 *      produces a visible flicker where the loading message vanishes right
 *      before the media message pops in.
 *   3. Ad-hoc editMessage calls duplicated per-command with slightly
 *      different button/session-id handling for the button_action case.
 *
 * withLoadingMedia() replaces all of that with a single call: send one
 * lightweight loading message, then swap it in place for the final result
 * via chat.editMessage (one round trip instead of three). If a button
 * triggered the command, the existing (button-bearing) message is reused
 * as the "loading" target instead of sending a new one, matching the
 * established button-refresh convention (see animal-photos.ts / shoti.ts).
 *
 * If editing turns out to be impossible (platform/session edge case throws),
 * this transparently falls back to delete+resend so the command still
 * completes instead of leaving the user with a stuck loading message.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type {
  NamedStreamAttachment,
  NamedUrlAttachment,
} from '@/engine/adapters/models/interfaces/index.js';
import type { MessageStyleValue } from '@/engine/constants/message-style.constants.js';

/** Final payload for a successful media result (mirrors reply/edit shape). */
export interface MediaResultPayload {
  message: string;
  style?: MessageStyleValue;
  attachment?: NamedStreamAttachment[];
  attachment_url?: NamedUrlAttachment[];
  /** Resolved button IDs — same shape chat.replyMessage/editMessage already accept. */
  button?: string[] | string[][];
}

export interface LoadingMediaHandle {
  /** True when this invocation was triggered by a button click on an existing message. */
  isButtonAction: boolean;
  /** Swaps the loading message for the final media result. */
  finish: (payload: MediaResultPayload) => Promise<void>;
  /** Swaps the loading message for an error message (no attachment). */
  fail: (errorMessage: string) => Promise<void>;
}

/**
 * Sends (or reuses, for button refreshes) a loading message, and returns
 * `finish`/`fail` callbacks that edit that same message into the final
 * result in a single round trip.
 */
export async function withLoadingMedia(
  ctx: AppCtx,
  loadingMessage: string,
): Promise<LoadingMediaHandle> {
  const { chat, event } = ctx;
  const isButtonAction = event['type'] === 'button_action';

  const loadingId = isButtonAction
    ? (event['messageID'] as string | undefined)
    : ((await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: loadingMessage,
      })) as string | undefined);

  const deliver = async (payload: MediaResultPayload): Promise<void> => {
    if (!loadingId) {
      // No loading message could be tracked (e.g. platform returned no id) —
      // fall back to a plain reply so the result still reaches the user.
      await chat.replyMessage(payload);
      return;
    }

    try {
      await chat.editMessage({
        ...payload,
        message_id_to_edit: loadingId,
      });
    } catch {
      // Editing failed (e.g. text->media swap unsupported in this context).
      // Fall back to delete+resend rather than leaving a stale message.
      await chat.unsendMessage(loadingId).catch(() => {});
      await chat.replyMessage(payload);
    }
  };

  return {
    isButtonAction,
    finish: (payload) => deliver(payload),
    fail: (errorMessage) =>
      deliver({ style: MessageStyle.MARKDOWN, message: errorMessage }),
  };
}
