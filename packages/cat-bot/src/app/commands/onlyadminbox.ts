/**
 * /onlyadminbox — per-thread group-admin-only mode.
 *
 * Thin command module: metadata and registration only. The toggle flow lives
 * in the shared admin-only settings service.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type { CommandMeta } from '@/engine/types/module-meta.types.js';
import {
  runAdminOnlyToggle,
  type AdminOnlyToggleConfig,
} from '@/engine/services/commands/admin-only-settings.service.js';

const config = {
  scope: 'thread',
  enabledField: 'enabled',
  hideNotiField: 'hideNoti',
  ignoreListField: 'ignoreList',
  scopeLabel: 'thread',
  enabledLabel: 'Admin-only mode',
  audienceLabel: 'in this thread',
  requiresGroup: true,
  adminKind: 'group',
} satisfies AdminOnlyToggleConfig;

export const meta: CommandMeta = {
  name: 'onlyadminbox',
  aliases: ['onlyadbox', 'adboxonly', 'adminboxonly'],
  version: '1.3.0',
  role: Role.THREAD_ADMIN,
  author: 'NTKhang (Cat-Bot port)',
  description:
    'Turn on/off the mode where only group admins can use the bot in this thread.',
  category: 'Thread Admin',
  usage: [
    '[on | off] — Enable/disable admin-only mode mode for this thread',
    'noti [on | off] — Enable/disable the blocked-user notification',
  ],
  cooldown: 5,
  hasPrefix: true,
  platform: [Platforms.Discord, Platforms.Telegram],
  options: [
    {
      type: OptionType.string,
      name: 'toggle',
      description: 'on or off — enable/disable admin-only mode mode',
      required: false,
    },
    {
      type: OptionType.string,
      name: 'noti',
      description: 'noti on | noti off — toggle blocked-user notification',
      required: false,
    },
  ],
};

export const onCommand = async (ctx: AppCtx): Promise<void> =>
  runAdminOnlyToggle(ctx, config);
