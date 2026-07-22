/**
 * Admin-Only Mode — multi-command family (single file, config-driven)
 *
 * Merges the previously-standalone adminonly.ts and onlyadminbox.ts modules
 * (Cat-Bot ports of GoatBot's adminonly / onlyadminbox by NTKhang) into one
 * file. Both toggle an admin-only enforcement mode and its blocked-user
 * notification flag — the only real difference is scope:
 *
 *   /adminonly    — session-wide,  restricts to bot admins   (db.bot)
 *   /onlyadminbox — per-thread,    restricts to group admins (db.threads)
 *
 * so they're expressed here as one runToggle() handler + a small config
 * table that supplies the DB handle getter, role, and response copy.
 *
 * DB schema:
 *   /adminonly    → db.bot → 'session_settings'
 *                     adminOnlyEnabled, adminOnlyHideNoti, adminOnlyIgnoreList
 *                     (adminOnlyIgnoreList managed separately by /ignoreonlyad)
 *   /onlyadminbox → db.threads.collection(threadID) → 'adminbox_settings'
 *                     enabled, hideNoti, ignoreList
 *                     (ignoreList managed separately by /ignoreonlyadminbox)
 *
 * The loader (`engine/app.ts` loadCommands) natively supports a file
 * exporting `commands: Array<{ meta, onCommand, button? }>` and registers
 * each entry exactly like a standalone command module.
 */

import type { AppCtx } from '@/engine/types/controller.types.js';
import { Role } from '@/engine/constants/role.constants.js';
import { OptionType } from '@/engine/modules/command/command-option.constants.js';
import type { CommandMeta } from '@/engine/types/module-config.types.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { invalidateThreadAdminBox } from '@/engine/lib/admin-only-state.lib.js';
import { setSessionAdminOnlyEnabled } from '@/engine/repos/admin-only.repo.js';

// ── Config ────────────────────────────────────────────────────────────────────

interface ToggleHandle {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

interface AdminOnlyConfig {
  name: string;
  aliases: string[];
  version: string;
  role: (typeof Role)[keyof typeof Role];
  category: string;
  description: string;
  /** DB field names differ between the two scopes' collections. */
  enabledField: string;
  hideNotiField: string;
  ignoreListField: string;
  scopeLabel: string; // "session" | "thread"
  enabledLabel: string; // "bot-admin-only" | "admin-only"
  audienceLabel: string; // "across all threads" | "in this thread"
  requiresGroup: boolean;
  getHandle: (ctx: AppCtx) => Promise<ToggleHandle>;
}

const ADMIN_ONLY_CONFIGS: AdminOnlyConfig[] = [
  {
    name: 'adminonly',
    aliases: ['adonly', 'onlyad', 'onlyadmin'],
    version: '1.5.0',
    role: Role.BOT_ADMIN,
    category: 'Bot Admin',
    description: 'Turn on/off the mode where only bot admins can use the bot (session-wide).',
    enabledField: 'adminOnlyEnabled',
    hideNotiField: 'adminOnlyHideNoti',
    ignoreListField: 'adminOnlyIgnoreList',
    scopeLabel: 'session',
    enabledLabel: 'Admin-only mode',
    audienceLabel: 'across all threads',
    requiresGroup: false,
    getHandle: async ({ db }) => {
      const coll = db.bot;
      if (!(await coll.isCollectionExist('session_settings'))) {
        await coll.createCollection('session_settings');
        const h = await coll.getCollection('session_settings');
        await h.set('adminOnlyEnabled', false);
        await h.set('adminOnlyHideNoti', false);
        await h.set('adminOnlyIgnoreList', []);
        return h;
      }
      return coll.getCollection('session_settings');
    },
  },
  {
    name: 'onlyadminbox',
    aliases: ['onlyadbox', 'adboxonly', 'adminboxonly'],
    version: '1.3.0',
    role: Role.THREAD_ADMIN,
    category: 'Thread Admin',
    description: 'Turn on/off the mode where only group admins can use the bot in this thread.',
    enabledField: 'enabled',
    hideNotiField: 'hideNoti',
    ignoreListField: 'ignoreList',
    scopeLabel: 'thread',
    enabledLabel: 'Admin-only mode',
    audienceLabel: 'in this thread',
    requiresGroup: true,
    getHandle: async ({ db, event }) => {
      const threadID = event['threadID'] as string;
      const coll = db.threads.collection(threadID);
      if (!(await coll.isCollectionExist('adminbox_settings'))) {
        await coll.createCollection('adminbox_settings');
        const h = await coll.getCollection('adminbox_settings');
        await h.set('enabled', false);
        await h.set('hideNoti', false);
        await h.set('ignoreList', []);
        return h;
      }
      return coll.getCollection('adminbox_settings');
    },
  },
];

// ── Shared handler ────────────────────────────────────────────────────────────

async function runToggle(ctx: AppCtx, config: AdminOnlyConfig): Promise<void> {
  const { chat, args, event, usage } = ctx;

  if (config.requiresGroup && !event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  let isNoti = false;
  let argIndex = 0;

  if (args[0]?.toLowerCase() === 'noti') {
    isNoti = true;
    argIndex = 1;
  }

  const toggle = args[argIndex]?.toLowerCase();
  if (toggle !== 'on' && toggle !== 'off') return usage();

  const value = toggle === 'on';
  const handle = await config.getHandle(ctx);

  if (isNoti) {
    // hideNoti is the inverse of "noti on" — enabling notifications means NOT hiding them
    await handle.set(config.hideNotiField, !value);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: value
        ? '✅ Notification **enabled** — non-admins will be told when they are blocked.'
        : '✅ Notification **disabled** — non-admins will be silently ignored.',
    });
  } else {
    const sessionUserId = ctx.native.userId ?? '';
    const sessionId = ctx.native.sessionId ?? '';
    const platform = ctx.native.platform;
    if (config.name === 'adminonly') {
      // Shared with the web dashboard's "Bot Admin Only" switch — same DB write,
      // same cache invalidation, so both surfaces behave identically in real time.
      await setSessionAdminOnlyEnabled(sessionUserId, platform, sessionId, value);
    } else {
      await handle.set(config.enabledField, value);
      // Immediately clear the LRU fast-path flag so the NEXT enforceAdminOnly
      // invocation reads the fresh setting rather than serving the stale cached value.
      const threadID = (ctx.event['threadID'] as string | undefined) ?? '';
      if (threadID) invalidateThreadAdminBox(sessionUserId, platform, sessionId, threadID);
    }
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: value
        ? `✅ ${config.enabledLabel} **enabled** — only ${config.role === Role.BOT_ADMIN ? 'bot' : 'group'} admins can use the bot ${config.audienceLabel}.`
        : `✅ ${config.enabledLabel} **disabled** — all users can use the bot ${config.audienceLabel}.`,
    });
  }
}

// ── Command entry generation ──────────────────────────────────────────────────

interface CommandEntry {
  meta: CommandMeta;
  onCommand: (ctx: AppCtx) => Promise<void>;
}

export const commands: CommandEntry[] = ADMIN_ONLY_CONFIGS.map((config) => ({
  meta: {
    name: config.name,
    aliases: config.aliases,
    version: config.version,
    role: config.role,
    author: 'NTKhang (Cat-Bot port)',
    description: config.description,
    category: config.category,
    usage: [
      `[on | off] — Enable/disable ${config.enabledLabel.toLowerCase()} mode for this ${config.scopeLabel}`,
      'noti [on | off] — Enable/disable the blocked-user notification',
    ],
    cooldown: 5,
    hasPrefix: true,
    platform: [Platforms.Discord, Platforms.Telegram],
    options: [
      {
        type: OptionType.string,
        name: 'toggle',
        description: `on or off — enable/disable ${config.enabledLabel.toLowerCase()} mode`,
        required: false,
      },
      {
        type: OptionType.string,
        name: 'noti',
        description: 'noti on | noti off — toggle blocked-user notification',
        required: false,
      },
    ],
  },
  onCommand: async (ctx: AppCtx) => runToggle(ctx, config),
}));
