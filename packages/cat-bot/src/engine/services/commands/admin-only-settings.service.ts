/**
 * Admin-Only Settings — shared implementation for the admin-only command pair
 * and their ignore-list commands.
 *
 * Two independent scopes exist:
 *
 *   session — /adminonly + /ignoreonlyad
 *             db.bot → 'session_settings'
 *             adminOnlyEnabled, adminOnlyHideNoti, adminOnlyIgnoreList
 *
 *   thread  — /onlyadminbox + /ignoreonlyadbox
 *             db.threads.collection(threadID) → 'adminbox_settings'
 *             enabled, hideNoti, ignoreList
 *
 * The session scope is shared with the web dashboard's "Bot Admin Only" switch,
 * so session writes go through the same repository functions and cache
 * invalidation as the dashboard. Thread writes clear the LRU fast-path flag so
 * the next enforceAdminOnly invocation reads the fresh value.
 */

import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import { invalidateThreadAdminBox } from '@/engine/lib/admin-only-state.lib.js';
import {
  getSessionAdminOnlyIgnoreList,
  setCommandIgnoredFromAdminOnly,
  setSessionAdminOnlyEnabled,
} from '@/engine/repos/admin-only.repo.js';
import type { AppCtx } from '@/engine/types/controller.types.js';

export type AdminOnlyScope = 'session' | 'thread';

export interface AdminOnlyToggleConfig {
  scope: AdminOnlyScope;
  enabledField: string;
  hideNotiField: string;
  ignoreListField: string;
  scopeLabel: string;
  enabledLabel: string;
  audienceLabel: string;
  requiresGroup: boolean;
  /** Which admin tier the confirmation copy should name. */
  adminKind: 'bot' | 'group';
}

export interface AdminOnlyIgnoreListConfig {
  scope: AdminOnlyScope;
  scopeLabel: string;
  ignoreListField: string;
  requiresGroup: boolean;
}

interface SettingsHandle {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}

/** Opens (and lazily initialises) the settings collection for a scope. */
async function getSettingsHandle(
  ctx: AppCtx,
  config: Pick<
    AdminOnlyToggleConfig,
    'scope' | 'enabledField' | 'hideNotiField' | 'ignoreListField'
  >,
): Promise<SettingsHandle> {
  if (config.scope === 'session') {
    const coll = ctx.db.bot;
    if (!(await coll.isCollectionExist('session_settings'))) {
      await coll.createCollection('session_settings');
      const handle = await coll.getCollection('session_settings');
      await handle.set(config.enabledField, false);
      await handle.set(config.hideNotiField, false);
      await handle.set(config.ignoreListField, []);
      return handle;
    }
    return coll.getCollection('session_settings');
  }

  const threadID = ctx.event['threadID'] as string;
  const coll = ctx.db.threads.collection(threadID);
  if (!(await coll.isCollectionExist('adminbox_settings'))) {
    await coll.createCollection('adminbox_settings');
    const handle = await coll.getCollection('adminbox_settings');
    await handle.set(config.enabledField, false);
    await handle.set(config.hideNotiField, false);
    await handle.set(config.ignoreListField, []);
    return handle;
  }
  return coll.getCollection('adminbox_settings');
}

/** Handles /adminonly and /onlyadminbox. */
export async function runAdminOnlyToggle(
  ctx: AppCtx,
  config: AdminOnlyToggleConfig,
): Promise<void> {
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
  const handle = await getSettingsHandle(ctx, config);

  if (isNoti) {
    // hideNoti is the inverse of "noti on" — enabling notifications means
    // NOT hiding them.
    await handle.set(config.hideNotiField, !value);
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: value
        ? '✅ Notification **enabled** — non-admins will be told when they are blocked.'
        : '✅ Notification **disabled** — non-admins will be silently ignored.',
    });
    return;
  }

  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  if (config.scope === 'session') {
    // Shared with the web dashboard's "Bot Admin Only" switch — same DB write,
    // same cache invalidation, so both surfaces behave identically in real time.
    await setSessionAdminOnlyEnabled(sessionUserId, platform, sessionId, value);
  } else {
    await handle.set(config.enabledField, value);
    // Immediately clear the LRU fast-path flag so the NEXT enforceAdminOnly
    // invocation reads the fresh setting rather than the stale cached value.
    const threadID = (ctx.event['threadID'] as string | undefined) ?? '';
    if (threadID) {
      invalidateThreadAdminBox(sessionUserId, platform, sessionId, threadID);
    }
  }

  await chat.replyMessage({
    style: MessageStyle.MARKDOWN,
    message: value
      ? `✅ ${config.enabledLabel} **enabled** — only ${config.adminKind} admins can use the bot ${config.audienceLabel}.`
      : `✅ ${config.enabledLabel} **disabled** — all users can use the bot ${config.audienceLabel}.`,
  });
}

/** Handles /ignoreonlyad and /ignoreonlyadbox. */
export async function runAdminOnlyIgnoreList(
  ctx: AppCtx,
  config: AdminOnlyIgnoreListConfig,
): Promise<void> {
  const { chat, args, event, usage } = ctx;

  if (config.requiresGroup && !event['isGroup']) {
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: '❌ This command can only be used in group chats.',
    });
    return;
  }

  const handle = await getSettingsHandle(ctx, {
    scope: config.scope,
    enabledField: config.scope === 'session' ? 'adminOnlyEnabled' : 'enabled',
    hideNotiField:
      config.scope === 'session' ? 'adminOnlyHideNoti' : 'hideNoti',
    ignoreListField: config.ignoreListField,
  });

  const sub = args[0]?.toLowerCase();
  // /ignoreonlyad shares its ignore list with the web dashboard's per-command
  // "Ignore Admin-Only" switches — read/write through the same functions so
  // both surfaces stay identical and immediately consistent with each other.
  const isSessionScope = config.scope === 'session';
  const sessionUserId = ctx.native.userId ?? '';
  const sessionId = ctx.native.sessionId ?? '';
  const platform = ctx.native.platform;

  const readIgnoreList = async (): Promise<string[]> =>
    isSessionScope
      ? getSessionAdminOnlyIgnoreList(sessionUserId, platform, sessionId)
      : (((await handle.get(config.ignoreListField)) as string[] | null) ?? []);

  // ── add ───────────────────────────────────────────────────────────────────
  if (sub === 'add') {
    if (!args[1]) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '⚠️ Please enter the command name you want to add to the ignore list.',
      });
      return;
    }

    const commandName = args[1].toLowerCase();
    const ignoreList = await readIgnoreList();

    if (ignoreList.includes(commandName)) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ **${commandName}** is already in the ignore list.`,
      });
      return;
    }

    if (isSessionScope) {
      await setCommandIgnoredFromAdminOnly(
        sessionUserId,
        platform,
        sessionId,
        commandName,
        true,
      );
    } else {
      ignoreList.push(commandName);
      await handle.set(config.ignoreListField, ignoreList);
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Added **${commandName}** to the ${config.scopeLabel} ignore list.`,
    });
    return;
  }

  // ── del / delete / remove / rm / -d ──────────────────────────────────────
  if (['del', 'delete', 'remove', 'rm', '-d'].includes(sub ?? '')) {
    if (!args[1]) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message:
          '⚠️ Please enter the command name you want to remove from the ignore list.',
      });
      return;
    }

    const commandName = args[1].toLowerCase();
    const ignoreList = await readIgnoreList();
    const index = ignoreList.indexOf(commandName);

    if (index === -1) {
      await chat.replyMessage({
        style: MessageStyle.MARKDOWN,
        message: `❌ **${commandName}** is not in the ignore list.`,
      });
      return;
    }

    if (isSessionScope) {
      await setCommandIgnoredFromAdminOnly(
        sessionUserId,
        platform,
        sessionId,
        commandName,
        false,
      );
    } else {
      ignoreList.splice(index, 1);
      await handle.set(config.ignoreListField, ignoreList);
    }

    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message: `✅ Removed **${commandName}** from the ${config.scopeLabel} ignore list.`,
    });
    return;
  }

  // ── list ──────────────────────────────────────────────────────────────────
  if (sub === 'list') {
    const ignoreList = await readIgnoreList();
    await chat.replyMessage({
      style: MessageStyle.MARKDOWN,
      message:
        ignoreList.length === 0
          ? `📑 The ${config.scopeLabel} ignore list is currently empty.`
          : `📑 Commands exempt from admin-only (${config.scopeLabel}):\n${ignoreList.join(', ')}`,
    });
    return;
  }

  return usage();
}
