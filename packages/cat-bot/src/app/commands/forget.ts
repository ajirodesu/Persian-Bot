/**
 * forget.ts — /forget — Clear agent conversation history
 *
 * Port of canis's forget.ts: clears the sender's agent thread and ends the
 * active session in this chat.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import { forgetAgent } from '@/engine/lib/ai-agent/agent-handler.lib.js';

export const meta: CommandMeta = {
  name: 'forget',
  version: '1.0.0',
  role: Role.ANYONE,
  author: 'AjiroDesu (ported from mrepol742/project-canis)',
  description:
    'Clear your conversation history with the AI agent and end the active session.',
  category: 'ai',
  usage: '',
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram, Platforms.Fluxer],
};

export const onCommand = async (ctx: AppCtx): Promise<void> => {
  await forgetAgent(ctx);
};
