/**
 * Telegram — sendRichMessageDraft
 *
 * Streams an ephemeral (~30s preview) partial rich message to a PRIVATE chat.
 * Per Bot API docs this is the only method allowed to carry an
 * InputRichBlockThinking block (`<tg-thinking>`), and is otherwise used for
 * ChatGPT-style incremental rendering of AI output. Cat-Bot currently only
 * uses this for the "thinking…" placeholder — see
 * `@/engine/lib/thinking-indicator.lib.ts`.
 *
 * Constraints enforced by the Bot API (not re-validated here beyond the
 * chat_id type, since the caller — thinking-indicator.lib.ts — already gates
 * on private-chat + Telegram before calling in):
 *   - chat_id must be an Integer (never @username / group / channel).
 *   - draft_id must be non-zero; repeated calls with the same draft_id are
 *     animated client-side rather than flashing a new message each time.
 *   - The draft is never persisted — callers MUST send a real
 *     sendRichMessage to finalize once generation completes.
 */
import type { Context } from 'grammy';
import { callRawTelegramApi } from '../utils/raw-api.util.js';
import type {
  InputRichBlockThinking,
  SendRichMessageDraftPayload,
} from './rich-message.types.js';

export interface SendThinkingDraftOptions {
  chatId: number;
  draftId: number;
  text: string;
  message_thread_id?: number;
}

/**
 * Sends/updates a "Thinking…" placeholder draft. Fire-and-forget from the
 * caller's perspective — errors are the caller's responsibility to handle
 * (thinking-indicator.lib.ts swallows them, matching sendTypingIndicator's
 * "must never fail the underlying command" contract).
 */
export async function sendThinkingDraft(
  ctx: Context,
  { chatId, draftId, text, message_thread_id }: SendThinkingDraftOptions,
): Promise<void> {
  const thinkingBlock: InputRichBlockThinking = { type: 'thinking', text };

  const payload: SendRichMessageDraftPayload = {
    chat_id: chatId,
    draft_id: draftId,
    rich_message: { blocks: [thinkingBlock] },
    ...(message_thread_id !== undefined ? { message_thread_id } : {}),
  };

  await callRawTelegramApi<SendRichMessageDraftPayload, true>(
    ctx,
    'sendRichMessageDraft',
    payload,
  );
}
