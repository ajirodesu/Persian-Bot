/**
 * Context factories for Cat-Bot's command execution layer.
 * Each factory creates a scoped interface bound to the triggering event:
 *   createThreadContext  → ctx.thread
 *   createChatContext    → ctx.chat
 *   createBotContext     → ctx.bot
 *   createUserContext    → ctx.user
 *   createStateContext   → ctx.state
 */

import { stateStore } from '@/engine/lib/state.lib.js';
import { buttonContextLib } from '@/engine/lib/button-context.lib.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';
import { stopTypingIndicator } from '@/engine/lib/typing-indicator.lib.js';
import type { UnifiedUserInfo } from './user.model.js';
import type { UnifiedApi } from './api.model.js';
import type { ButtonItem } from './interfaces/index.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';
import { ButtonStyle, type ButtonStyleValue } from '@/engine/constants/button-style.constants.js';
import { type UnifiedThreadInfo } from './thread.model.js';

export type {
  ThreadContext, ReplyOptions, EditOptions, ChatContext,
  BotContext, UserContext, StateContext, ButtonContext,
} from './interfaces/index.js';

import { Platforms } from '@/engine/modules/platform/platform.constants.js';

const GETINFO_TTL_MS: Record<string, number> = {
  [Platforms.Discord]: 30 * 60 * 1000,
  [Platforms.Telegram]: 30 * 60 * 1000,
};
function getInfoCacheTTL(platform: string): number {
  return GETINFO_TTL_MS[platform] ?? 5 * 60 * 1000;
}

// ── Factories ─────────────────────────────────────────────────────────────────

export function createThreadContext(
  api: UnifiedApi,
  event: Record<string, unknown>,
  native?: { userId?: string; platform?: string; sessionId?: string },
): import('./interfaces/index.js').ThreadContext {
  const defaultThreadID = event['threadID'] as string;
  logger.debug('[context.model] createThreadContext called', { threadID: defaultThreadID });

  function getThreadID(opts: unknown): string {
    if (typeof opts === 'object' && opts !== null) {
      const o = opts as Record<string, unknown>;
      return (o.threadID as string) || (o.thread_id as string) || defaultThreadID;
    }
    return defaultThreadID;
  }

  return {
    setName: (nameOrOpts) => {
      const name = typeof nameOrOpts === 'object' && nameOrOpts !== null
        ? (nameOrOpts as unknown as Record<string, unknown>).name
        : nameOrOpts;
      const targetThreadID = getThreadID(nameOrOpts);
      logger.debug('[context.model] ThreadContext.setName called', { threadID: targetThreadID, name });
      return api.setGroupName(targetThreadID, name as string);
    },
    setImage: (sourceOrOpts) => {
      const isObj = typeof sourceOrOpts === 'object' && sourceOrOpts !== null
        && !Buffer.isBuffer(sourceOrOpts) && !('pipe' in sourceOrOpts);
      const imageSource = isObj ? (sourceOrOpts as unknown as Record<string, unknown>).imageSource : sourceOrOpts;
      const targetThreadID = getThreadID(isObj ? sourceOrOpts : null);
      logger.debug('[context.model] ThreadContext.setImage called', { threadID: targetThreadID });
      return api.setGroupImage(targetThreadID, imageSource as Buffer | import('stream').Readable | string);
    },
    removeImage: (opts) => {
      const targetThreadID = getThreadID(opts);
      logger.debug('[context.model] ThreadContext.removeImage called', { threadID: targetThreadID });
      return api.removeGroupImage(targetThreadID);
    },
    addUser: (userOrOpts) => {
      const userID = typeof userOrOpts === 'object' && userOrOpts !== null
        ? (userOrOpts as unknown as Record<string, unknown>).userID
        : userOrOpts;
      const targetThreadID = getThreadID(userOrOpts);
      logger.debug('[context.model] ThreadContext.addUser called', { threadID: targetThreadID, userID });
      return api.addUserToGroup(targetThreadID, userID as string);
    },
    removeUser: (userOrOpts) => {
      const userID = typeof userOrOpts === 'object' && userOrOpts !== null
        ? (userOrOpts as unknown as Record<string, unknown>).userID
        : userOrOpts;
      const targetThreadID = getThreadID(userOrOpts);
      logger.debug('[context.model] ThreadContext.removeUser called', { threadID: targetThreadID, userID });
      return api.removeUserFromGroup(targetThreadID, userID as string);
    },
    setReaction: (emojiOrOpts) => {
      const emoji = typeof emojiOrOpts === 'object' && emojiOrOpts !== null
        ? (emojiOrOpts as unknown as Record<string, unknown>).emoji
        : emojiOrOpts;
      const targetThreadID = getThreadID(emojiOrOpts);
      logger.debug('[context.model] ThreadContext.setReaction called', { threadID: targetThreadID, emoji });
      return api.setGroupReaction(targetThreadID, emoji as string);
    },
    setNickname: (options) => {
      const targetThreadID = getThreadID(options);
      logger.debug('[context.model] ThreadContext.setNickname called', { threadID: targetThreadID, user_id: options.user_id, nickname: options.nickname });
      return api.setNickname(targetThreadID, options.user_id, options.nickname);
    },
    getInfo: async (targetThreadID): Promise<UnifiedThreadInfo> => {
      const target = typeof targetThreadID === 'object' && targetThreadID !== null
        ? getThreadID(targetThreadID)
        : targetThreadID || defaultThreadID;
      logger.debug('[context.model] ThreadContext.getInfo called', { threadID: target });
      const nativeUserId = native?.userId ?? '';
      const nativePlatform = native?.platform ?? api.platform;
      const nativeSessionId = native?.sessionId ?? '';
      const cacheEnabled = Boolean(nativeUserId && nativeSessionId);
      if (cacheEnabled) {
        const cached = lruCache.get<UnifiedThreadInfo>(
          `${nativeUserId}:${nativePlatform}:${nativeSessionId}:thread:fullInfo:${target as string}`,
        );
        if (cached !== undefined) return cached;
      }
      const result = await api.getFullThreadInfo(target as string);
      if (cacheEnabled) {
        lruCache.set(
          `${nativeUserId}:${nativePlatform}:${nativeSessionId}:thread:fullInfo:${target as string}`,
          result,
          getInfoCacheTTL(nativePlatform),
        );
      }
      return result;
    },
    getName: (targetThreadID) => {
      const target = typeof targetThreadID === 'object' && targetThreadID !== null
        ? getThreadID(targetThreadID)
        : targetThreadID || defaultThreadID;
      logger.debug('[context.model] ThreadContext.getName called', { threadID: target });
      return api.getThreadName(target as string);
    },
    getMemberCount: (targetThreadID) => {
      const target = typeof targetThreadID === 'object' && targetThreadID !== null
        ? getThreadID(targetThreadID)
        : targetThreadID || defaultThreadID;
      logger.debug('[context.model] ThreadContext.getMemberCount called', { threadID: target });
      // Use event-provided participantIDs when querying the current thread (zero API cost).
      if (target === defaultThreadID) {
        const participantIDs = event['participantIDs'] as string[] | undefined;
        if (Array.isArray(participantIDs) && participantIDs.length > 0) {
          return Promise.resolve(participantIDs.length);
        }
      }
      return api.getMemberCount(target as string);
    },
  };
}

export function createChatContext(
  api: UnifiedApi,
  event: Record<string, unknown>,
  commandName = '',
  buttonDef: Record<string, { label?: string; style?: ButtonStyleValue; onClick?: (...args: unknown[]) => unknown }> | null = null,
  platform?: string,
): import('./interfaces/index.js').ChatContext {
  const defaultThreadID = event['threadID'] as string;
  const defaultMessageID = event['messageID'] as string;
  logger.debug('[context.model] createChatContext called', { threadID: defaultThreadID, messageID: defaultMessageID });

  // In DM/PM chats (Discord/Telegram), send as plain new messages instead of reply threads.
  const isDmOrPm = (platform === 'discord' || platform === 'telegram') &&
    (event['isGroup'] as boolean | undefined) === false;

  function getThreadID(opts: unknown): string {
    if (typeof opts === 'object' && opts !== null) {
      const o = opts as Record<string, unknown>;
      return (o.threadID as string) || (o.thread_id as string) || defaultThreadID;
    }
    return defaultThreadID;
  }

  function hasExplicitThreadOverride(opts: unknown): boolean {
    if (typeof opts === 'object' && opts !== null) {
      const o = opts as Record<string, unknown>;
      return !!(o.threadID || o.thread_id);
    }
    return false;
  }

  function shouldSendAsNewMessage(opts: unknown): boolean {
    return isDmOrPm && !hasExplicitThreadOverride(opts);
  }

  function getMessageID(opts: unknown): string {
    if (typeof opts === 'object' && opts !== null) {
      const o = opts as Record<string, unknown>;
      return (o.messageID as string) || (o.reply_to_message_id as string) || (o.targetMessageID as string) || defaultMessageID;
    }
    return defaultMessageID;
  }

  /** Strips optional ~userId scope suffix and #instanceId from a raw button ID. */
  function baseKey(id: string): string {
    const tilde = id.indexOf('~');
    const withoutScope = tilde === -1 ? id : id.slice(0, tilde);
    const hash = withoutScope.indexOf('#');
    return hash === -1 ? withoutScope : withoutScope.slice(0, hash);
  }

  /** Normalises flat string[] or 2-D string[][] to an array of rows. */
  function normalizeRows(buttonIds: string[] | string[][]): string[][] {
    if (buttonIds.length === 0) return [];
    const first = buttonIds[0];
    if (first === undefined) return [];
    return Array.isArray(first) ? (buttonIds as string[][]) : [buttonIds as string[]];
  }

  function resolveButtons(buttonIds: string[] | string[][]): ButtonItem[][] {
    logger.debug('[context.model] resolveButtons called', { count: buttonIds.length });
    if (!buttonIds.length) return [];
    return normalizeRows(buttonIds).map((row) =>
      row.map((id) => {
        const bKey = baseKey(id);
        const overrideFull = buttonContextLib.getOverride(`${commandName}:${id}`);
        const overrideBase = buttonContextLib.getOverride(`${commandName}:${bKey}`);
        return {
          id: commandName ? `${commandName}:${id}` : id,
          label: overrideFull?.label ?? overrideBase?.label ?? buttonDef?.[bKey]?.label ?? id,
          style: (overrideFull?.style ?? overrideBase?.style ?? buttonDef?.[bKey]?.style ?? ButtonStyle.SECONDARY) as ButtonStyleValue,
        };
      }),
    );
  }

  return {
    reply: async ({ message = '', attachment = [], attachment_url = [], button = [], style, rich, ...opts } = {}) => {
      const totalAttachCount = attachment.length + attachment_url.length;
      if (button.length > 0 && totalAttachCount > 1) {
        throw new Error(
          `Only 1 attachment (stream or URL, not both) is supported alongside button components. ` +
            `Received ${attachment.length} stream attachment(s) and ${attachment_url.length} URL attachment(s). ` +
            `Reduce to a maximum of 1 total attachment when using buttons.`,
        );
      }
      const targetThreadID = getThreadID(opts);
      const customMessageID = opts.messageID || opts.reply_to_message_id;
      const sendAsNewMessage = shouldSendAsNewMessage(opts);
      logger.debug('[context.model] ChatContext.reply called', { threadID: targetThreadID, hasMessage: !!message, buttonCount: button.length });
      const result = await api.replyMessage(targetThreadID, {
        message,
        attachment,
        attachment_url,
        ...(customMessageID && !sendAsNewMessage ? { reply_to_message_id: customMessageID } : {}),
        button: resolveButtons(button),
        ...(style !== undefined ? { style } : {}),
        ...(rich !== undefined ? { rich } : {}),
      });
      stopTypingIndicator(targetThreadID);
      return result;
    },

    replyMessage: async ({ message = '', attachment = [], attachment_url = [], button = [], style, rich, ...opts } = {}) => {
      const totalAttachCount = attachment.length + attachment_url.length;
      if (button.length > 0 && totalAttachCount > 1) {
        throw new Error(
          `Only 1 attachment (stream or URL, not both) is supported alongside button components. ` +
            `Received ${attachment.length} stream attachment(s) and ${attachment_url.length} URL attachment(s). ` +
            `Reduce to a maximum of 1 total attachment when using buttons.`,
        );
      }
      const targetThreadID = getThreadID(opts);
      const targetMessageID = getMessageID(opts);
      const sendAsNewMessage = shouldSendAsNewMessage(opts);
      logger.debug('[context.model] ChatContext.replyMessage called', { threadID: targetThreadID, messageID: targetMessageID, hasMessage: !!message, buttonCount: button.length, sendAsNewMessage });
      const result = await api.replyMessage(targetThreadID, {
        message,
        attachment,
        attachment_url,
        ...(sendAsNewMessage ? {} : { reply_to_message_id: targetMessageID }),
        button: resolveButtons(button),
        ...(style !== undefined ? { style } : {}),
        ...(rich !== undefined ? { rich } : {}),
      });
      stopTypingIndicator(targetThreadID);
      return result;
    },

    reactMessage: (options) => {
      const isObj = typeof options === 'object' && options !== null;
      const emoji = isObj ? (options as unknown as Record<string, unknown>).emoji : options;
      const targetThreadID = getThreadID(isObj ? options : null);
      const targetMessageID = getMessageID(isObj ? options : null);
      logger.debug('[context.model] ChatContext.reactMessage called', { threadID: targetThreadID, messageID: targetMessageID, emoji });
      return api.reactToMessage(targetThreadID, targetMessageID, emoji as string);
    },

    unsendMessage: (options) => {
      const isObj = typeof options === 'object' && options !== null;
      const targetMessageID = isObj ? getMessageID(options) : options;
      logger.debug('[context.model] ChatContext.unsendMessage called', { targetMessageID });
      return api.unsendMessage(targetMessageID as string);
    },

    editMessage: async (options: import('./interfaces/index.js').EditOptions) => {
      const targetMessageID = options.message_id_to_edit || getMessageID({ messageID: undefined });
      const targetThreadID = getThreadID(options);
      logger.debug('[context.model] ChatContext.editMessage called', { targetMessageID });
      const finalMessage = options.message;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { message, button, ...restOpts } = options;
      return api.editMessage(targetMessageID, {
        ...restOpts,
        threadID: targetThreadID,
        ...(finalMessage !== undefined ? { message: finalMessage } : {}),
        ...(button ? { button: resolveButtons(button) } : {}),
      });
    },
  };
}

export function createBotContext(
  api: UnifiedApi,
  event?: Record<string, unknown>,
): import('./interfaces/index.js').BotContext {
  logger.debug('[context.model] createBotContext called');
  return {
    getID: () => {
      logger.debug('[context.model] BotContext.getID called');
      return api.getBotID();
    },
    leave: async (threadID?: string): Promise<void> => {
      const targetThread = threadID ?? (event?.['threadID'] as string | undefined) ?? '';
      logger.debug('[context.model] BotContext.leave called', { targetThread });
      return api.leaveThread(targetThread);
    },
  };
}

export function createUserContext(
  api: UnifiedApi,
  native?: { userId?: string; platform?: string; sessionId?: string },
): import('./interfaces/index.js').UserContext {
  logger.debug('[context.model] createUserContext called');
  return {
    getInfo: async (userID): Promise<UnifiedUserInfo> => {
      logger.debug('[context.model] UserContext.getInfo called', { userID });
      const nativeUserId = native?.userId ?? '';
      const nativePlatform = native?.platform ?? api.platform;
      const nativeSessionId = native?.sessionId ?? '';
      if (nativeUserId && nativeSessionId) {
        const cached = lruCache.get<UnifiedUserInfo>(
          `${nativeUserId}:${nativePlatform}:${nativeSessionId}:user:fullInfo:${userID}`,
        );
        if (cached !== undefined) return cached;
      }
      const info = await api.getFullUserInfo(userID);
      if (nativeUserId && nativeSessionId) {
        lruCache.set(
          `${nativeUserId}:${nativePlatform}:${nativeSessionId}:user:fullInfo:${userID}`,
          info,
          getInfoCacheTTL(nativePlatform),
        );
      }
      return info;
    },
    getName: (userID) => {
      logger.debug('[context.model] UserContext.getName called', { userID });
      return api.getUserName(userID);
    },
    getAvatarUrl: (userID) => {
      logger.debug('[context.model] UserContext.getAvatarUrl called', { userID });
      return api.getAvatarUrl(userID);
    },
  };
}

export function createStateContext(
  commandName: string,
  event: Record<string, unknown>,
): import('./interfaces/index.js').StateContext {
  logger.debug('[context.model] createStateContext called', { commandName });
  return {
    state: {
      /**
       * Builds a composite routing key scoped to the sender (private) or thread (public).
       * Default (private): `${id}:${senderID}` — only the triggering user can advance.
       * Public: `${id}:${threadID}` — any group member can advance (polls, shared flows).
       */
      generateID({ id, public: isPublic = false }) {
        logger.debug('[context.model] state.generateID called', { id, isPublic });
        if (event['type'] === 'message_reaction') {
          return isPublic ? `${id}:${event['threadID'] as string}` : `${id}:${event['userID'] as string}`;
        }
        return isPublic ? `${id}:${event['threadID'] as string}` : `${id}:${event['senderID'] as string}`;
      },
      create({ id, state, context }) {
        logger.debug('[context.model] state.create called', { id, state });
        stateStore.create(id, { command: commandName, state, context });
      },
      delete(id) {
        logger.debug('[context.model] state.delete called', { id });
        stateStore.delete(id);
      },
    },
  };
}

export function createButtonContext(
  commandName: string,
  event: Record<string, unknown>,
): import('./interfaces/index.js').ButtonContext {
  logger.debug('[context.model] createButtonContext called', { commandName });
  return {
    button: {
      generateID({ id, public: isPublic = false }) {
        logger.debug('[context.model] button.generateID called', { id, isPublic });
        const instanceId = Math.random().toString(36).substring(2, 8);
        const baseWithInstance = `${id}#${instanceId}`;
        if (isPublic) return baseWithInstance;
        return `${baseWithInstance}~${event['senderID'] as string}`;
      },
      createContext({ id, context }) {
        logger.debug('[context.model] button.createContext called', { id });
        buttonContextLib.create(`${commandName}:${id}`, context);
      },
      getContext(id) {
        return buttonContextLib.get(`${commandName}:${id}`);
      },
      deleteContext(id) {
        logger.debug('[context.model] button.deleteContext called', { id });
        buttonContextLib.delete(`${commandName}:${id}`);
      },
      update(options) {
        logger.debug('[context.model] button.update called', { id: options.id });
        const key = `${commandName}:${options.id}`;
        const existing = buttonContextLib.getOverride(key) || {};
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, ...payload } = options;
        buttonContextLib.setOverride(key, { ...existing, ...payload });
      },
      create(options) {
        logger.debug('[context.model] button.create called', { id: options.id });
        const key = `${commandName}:${options.id}`;
        const existing = buttonContextLib.getOverride(key) || {};
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { id, ...payload } = options;
        buttonContextLib.setOverride(key, { ...existing, ...payload });
      },
    },
  };
}
