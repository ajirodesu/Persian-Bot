/**
 * roast.ts — /roast — Interact with the Roast AI agent
 *
 * Port of canis's roast.ts: a dedicated persona that roasts people for fun,
 * using the cached no-tools completion (canis agentHandler).
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { generateSimpleText } from '@/engine/agent/lib/agent-handler.lib.js';

export const meta: CommandMeta = {
  name: 'roast',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported from mrepol742/project-canis)',
  description: 'Interact with the Roast AI agent.',
  category: 'ai',
  usage: '<query>',
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, event } = ctx;
  const query = args.join(' ').trim();

  const replyEvent = event['messageReply'] as { message?: string } | undefined;
  const quoted = replyEvent?.message;

  if (!query && !quoted) {
    await chat.replyMessage({
      message: 'Give me someone or something to roast 😈',
    });
    return;
  }

  const mentioned = (event['mentions'] as Record<string, unknown> | undefined)
    ? Object.keys(event['mentions'] as Record<string, unknown>).length > 0
    : false;

  const prompt = `You are Roast — your job is to roast people for fun.
No hard feelings, you're just doing your job 😈🔥
You can use funny or nasty emojis, but keep it light-hearted and witty.
Always respond briefly and concisely.
The date today is ${new Date().toUTCString()}. If there was not enough topic to roast, create one.
${mentioned ? 'You may also mention users using @.' : ''}
${quoted ? `Quoted Message:\n${quoted}\n` : ''}
Now roast: ${query}`;

  const text = await generateSimpleText(ctx, prompt);

  if (!text) {
    await chat.replyMessage({
      message: "Sorry, I couldn't generate a response. Please try again.",
    });
    return;
  }

  await chat.replyMessage({
    style: MessageStyle.TEXT,
    message: text,
  });
};
