import type { ReplyOptions } from '@/engine/adapters/models/interfaces/index.js';
import axios from 'axios';
import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';

export const meta: CommandMeta = {
  name: 'say',
  aliases: ['tts'] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'John Lester',
  description: 'Converts text into Google TTS audio',
  category: 'Media',
  usage: '<text> | <lang> (or reply: | <lang>)',
  cooldown: 5,
  hasPrefix: true,
  options: [
    {
      type: OptionType.string,
      name: 'input',
      description:
        'Text and language code separated by | (e.g., "Konnichiwa | ja")',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, event, args, prefix = '' } = ctx;
  const messageReply = event['messageReply'] as
    | Record<string, unknown>
    | undefined;

  // Split on the first '|' to resolve "<text> | <lang>" — pipe unambiguously separates
  // multi-word text from the language code without relying on character-length heuristics.
  const rawInput = args.join(' ');
  const pipeIndex = rawInput.indexOf('|');
  const hasPipe = pipeIndex !== -1;
  const beforePipe = hasPipe
    ? rawInput.slice(0, pipeIndex).trim()
    : rawInput.trim();
  const afterPipe = hasPipe ? rawInput.slice(pipeIndex + 1).trim() : '';

  let lang: string;
  let text: string;

  if (messageReply) {
    const replyMsg = (messageReply['message'] as string) || '';
    // Reply path: the pipe specifies the TTS language only (e.g., "| ja").
    // Without a pipe, the entire input is treated as the lang code (backward-compat shortcut).
    lang = hasPipe ? afterPipe || 'en' : rawInput.trim() || 'en';
    text = replyMsg;
  } else {
    // Non-reply path: text is required on the left side of the pipe.
    if (!beforePipe) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ Usage: ${prefix}say <text> | <lang>\nExample: ${prefix}say Konnichiwa | ja`,
      });
      return;
    }
    text = beforePipe;
    lang = afterPipe || 'en';
  }

  if (!text.trim()) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ No text provided to speak.',
    });
    return;
  }

  // Google TTS restricts query length, typically ~200 characters per request.
  if (text.length > 200) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ Text is too long. Please provide 200 characters or less.',
    });
    return;
  }

  const isButtonAction = ctx.event['type'] === 'button_action';
  const loadingId = isButtonAction
    ? (ctx.event['messageID'] as string | undefined)
    : undefined;
  // Delivers the final result: edits the existing (button-bearing) message
  // in place on a button refresh, or sends a plain reply otherwise. No
  // loading placeholder is sent — the typing indicator covers processing
  // feedback for the whole command duration.
  const deliver = async (payload: ReplyOptions): Promise<void> => {
    if (!loadingId) {
      await ctx.chat.replyMessage(payload);
      return;
    }
    try {
      await ctx.chat.editMessage({ ...payload, message_id_to_edit: loadingId });
    } catch {
      await ctx.chat.unsendMessage(loadingId).catch(() => {});
      await ctx.chat.reply(payload);
    }
  };
  const finish = deliver;
  const fail = (errorMessage: string): Promise<void> =>
    deliver({ style: MessageStyle.MARKDOWN, message: errorMessage });

  try {
    const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodeURIComponent(text)}&tl=${lang}&client=tw-ob`;

    // Fetch as a buffer (rather than a stream) so the download completes
    // before we edit the loading message — editMessage's attachment upload
    // needs a resolvable byte length, and a still-open stream cannot back
    // an edit of an existing message the way it could a fresh reply.
    const response = await axios.get<ArrayBuffer>(url, {
      responseType: 'arraybuffer',
    });

    await finish({
      // We do not provide message string since we just want to send the audio
      message: '',
      attachment: [{ name: 'say.mp3', stream: Buffer.from(response.data) }],
    });
  } catch {
    await fail(
      '❌ An error occurred while generating audio. The service might be temporarily unavailable.',
    );
  }
};
