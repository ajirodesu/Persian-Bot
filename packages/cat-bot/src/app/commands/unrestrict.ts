/**
 * /unrestrict — lift a restriction on a member.
 *
 * Thin command module: metadata and registration only. Shared behavior
 * lives in the command-family service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  runRestriction,
  type RestrictionConfig,
} from '@/engine/services/commands/restriction.service.js';

const config = {
  name: 'unrestrict',
  restrict: false,
  label: 'unrestricted',
} satisfies RestrictionConfig;

export const meta: CommandMeta = {
  name: 'unrestrict',
  aliases: [],
  version: '1.0.0',
  role: Role.THREAD_ADMIN,
  author: 'AjiroDesu',
  description:
    'Lift a restriction on a member, restoring their default ability to send messages and media. Provide a user ID, mention them, or reply to their message.',
  category: 'Thread Admin',
  usage: '<uid | @mention | reply>',
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Telegram],
  options: [
    {
      type: OptionType.user,
      name: 'user',
      description: 'User to unrestrict',
      required: true,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runRestriction(ctx, config);
