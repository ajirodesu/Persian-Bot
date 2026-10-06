/**
 * AI command — explicit (`!ai` / `!ask`) plus automatic mention replies.
 *
 * Explicit invocations and nickname mentions both run the Reze-style agent
 * loop (list_commands → test_command preview → send_result delivery). When
 * `send_result` already delivered the reply, nothing further is posted.
 *
 * Mention behavior (groups: nickname mention; DMs: every message):
 *   - never on command invocations (the command path owns those)
 *   - never on AI-initiated synthetic events (recursion guard)
 *   - rate-limited to one automatic reply per user per thread per minute
 *   - toggleable per owner via the AI Agent dashboard (autoReply)
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';

export const meta: CommandMeta = {
  name: 'ai',
  aliases: ['ask'],
  version: '2.0.0',
  role: Role.ANYONE,
  author: 'Persian-Bot',
  description: 'Talk to the AI agent (also replies when mentioned)',
  category: 'AI',
  usage: '<your question>',
  cooldown: 5,
  hasPrefix: true,
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const { chat, args, event, prefix } = ctx;
  const question = args.join(' ').trim();

  if (!question) {
    await ctx.usage();
    return;
  }

  // Never let an AI-executed command re-enter the agent (recursion guard).
  if (event['aiInitiated'] === true) return;

  const {
    runChatAgent,
    isAiAvailable,
  } = await import('@/engine/ai/service.js');
  if (!(await isAiAvailable(ctx.native.userId))) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🤖 The AI agent is not configured yet. Ask the bot owner to set it up from the dashboard (AI Agent page).',
    });
    return;
  }

  const result = await runChatAgent(ctx, prefix ?? '!', question);

  // send_result already delivered the synthesized reply (text + files +
  // buttons) — posting again would duplicate it.
  if (result.delivered) return;

  // Files collected from tool results that were not delivered via
  // send_result (e.g. a skill that produced an image) go out with the reply.
  const attachments = (result.attachments ?? [])
    .filter((a) => a && typeof a.url === 'string' && /^https?:\/\//i.test(a.url))
    .slice(0, 3)
    .map((a) => ({ name: a.name, url: a.url }));

  if (!result.text && attachments.length === 0) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '🤖 I could not generate a reply just now. Please try again in a moment.',
    });
    return;
  }

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: result.text ? result.text.slice(0, 4000) : ' ',
    ...(attachments.length > 0 ? { attachment_url: attachments } : {}),
  });
};

export const onChat = async (ctx: AppCtx): Promise<void> => {
  const event = ctx.event;
  const text = String(event['message'] ?? event['body'] ?? '');
  if (!text.trim()) return;
  if (event['aiInitiated'] === true) return;

  // Command invocations belong to the command path — never auto-reply.
  const prefix = ctx.prefix ?? '!';
  if (text.startsWith(prefix)) return;

  const threadId = String(event['threadID'] ?? event['thread_id'] ?? 'dm');
  const senderId = String(event['senderID'] ?? event['userID'] ?? '');
  const isGroup = Boolean(event['isGroup'] ?? event['is_group'] ?? false);
  if (!senderId) return;

  const {
    runChatAgent,
    isAiAvailable,
    isAutoReplyEnabled,
    isMentioned,
    resolveBotNicknames,
    claimMentionReply,
  } = await import('@/engine/ai/service.js');

  const ownerId = ctx.native.userId;
  if (!(await isAiAvailable(ownerId))) return;

  if (isGroup) {
    if (!(await isAutoReplyEnabled(ownerId, 'mention'))) return;
    const nicknames = await resolveBotNicknames(ctx);
    if (!nicknames.length) return;
    const mentions = event['mentions'] as Record<string, string> | undefined;
    if (!isMentioned(text, nicknames, mentions)) return;
  } else {
    if (!(await isAutoReplyEnabled(ownerId, 'dm'))) return;
  }

  // One automatic reply per user per thread per minute.
  if (!claimMentionReply(threadId, senderId)) return;

  try {
    const result = await runChatAgent(ctx, prefix, text);
    if (result.delivered) return;

    const attachments = (result.attachments ?? [])
      .filter((a) => a && typeof a.url === 'string' && /^https?:\/\//i.test(a.url))
      .slice(0, 3)
      .map((a) => ({ name: a.name, url: a.url }));
    if (!result.text && attachments.length === 0) return;

    await ctx.chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: result.text ? result.text.slice(0, 4000) : ' ',
      ...(attachments.length > 0 ? { attachment_url: attachments } : {}),
    });
  } catch (err) {
    ctx.logger.error('[ai] mention auto-reply failed', {
      error: (err as Error)?.message ?? String(err),
    });
  }
};
