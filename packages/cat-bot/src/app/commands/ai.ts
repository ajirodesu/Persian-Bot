/**
 * ai.ts — /ai — Talk to the AI agent
 *
 * Port of canis's ai.ts + mj.ts commands: the agent is reachable via
 * "/ai <query>" (and "/<agent-name> <query>", e.g. "/cat hello") and via
 * natural language — mentioning the agent name, @mentioning the bot, or
 * continuing an active session triggers it from any non-command message
 * (onChat activation, mirroring canis message.ts routing).
 *
 *   /ai build me a website
 *   cat what's the weather like?
 */

import type { AppCtx, BaseCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  runAgent,
  maybeRunAgentOnChat,
} from '@/engine/lib/ai-agent/agent-handler.lib.js';
import { AGENT_NAME } from '@/engine/lib/ai-agent/agent-personalities.lib.js';

export const meta: CommandMeta = {
  name: 'ai',
  aliases: [AGENT_NAME] as string[],
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported from mrepol742/project-canis)',
  description: `Talk to the AI assistant (also triggers on "${AGENT_NAME}" or @mention).`,
  category: 'ai',
  usage: '<query>',
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  const query = ctx.args.join(' ').trim();
  // Pass the parsed query explicitly — the event body still carries the
  // "/ai " prefix, which runAgent must not treat as conversation text.
  await runAgent(ctx, query);
};

/**
 * Natural-language activation: runs on every message. Continues active agent
 * sessions, then triggers on the agent name word or a bot @mention. The agent
 * handler starts a typing indicator only once a turn is actually triggered.
 */
export const onChat = async (ctx: BaseCtx): Promise<void> => {
  await maybeRunAgentOnChat(ctx);
};
