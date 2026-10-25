/**
 * /restrict — mute a member without removing them from the group.
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
  name: 'restrict',
  restrict: true,
  label: 'restricted',
} satisfies RestrictionConfig;

export const meta: CommandMeta = {
  name: 'restrict',
  aliases: [],
  version: '1.0.0',
  role: Role.THREAD_ADMIN,
  author: 'AjiroDesu',
  description:
    'Mute a member so they cannot send messages or media, without removing them from the group. Provide a user ID, mention them, or reply to their message. Optionally add a duration (e.g. 10m, 2h, 1d) — omit it to restrict indefinitely.',
  category: 'Thread Admin',
  usage: '<uid | @mention | reply> [duration]',
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Telegram],
  options: [
    {
      type: OptionType.user,
      name: 'user',
      description: 'User to restrict',
      required: true,
    },
    {
      type: OptionType.string,
      name: 'duration',
      description: 'Optional duration (e.g. 10m, 2h, 1d) — omit for indefinite',
      required: false,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runRestriction(ctx, config);
