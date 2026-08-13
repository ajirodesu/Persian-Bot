/**
 * Fluxer Platform Wrapper — UnifiedApi Adapter Factory
 *
 * Single responsibility: create UnifiedApi instances that delegate to lib/ functions.
 *   - createFluxerApi: plain object factory for all non-interaction events
 *     (messageCreate, message_reaction, guildMemberAdd/Remove, etc.)
 *
 * WHY: Normalizer re-exports were removed — they now live in utils/normalizers.util.ts
 * where event-handlers.ts imports them directly. Wrapper is now a pure API adapter layer.
 *
 * To change any API behaviour, edit the corresponding lib/<method>.ts file.
 */

import type {
  Client,
  Message,
  Guild,
  TextChannel,
  DMChannel,
  EmbedBuilder,
} from '@fluxerjs/core';

import { UnifiedApi } from '@/engine/adapters/models/api.model.js';
import type { SendPayload } from '@/engine/adapters/models/api.model.js';

import { buildFluxerMentionMsg } from './utils/helper.util.js';
import { logger } from '@/engine/modules/logger/logger.lib.js';

import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { sendMessage as sendMessageLib } from './lib/sendMessage.js';
import type { FluxerFile } from './lib/sendMessage.js';
import { unsendMessage as unsendMessageLib } from './lib/unsendMessage.js';
import { getUserInfo as getUserInfoLib } from './lib/getUserInfo.js';
import { setGroupName as setGroupNameLib } from './lib/setGroupName.js';
import { replyMessage as replyMessageLib } from './lib/replyMessage.js';
import { reactToMessage as reactToMessageLib } from './lib/reactToMessage.js';
import { sendTypingIndicator as sendTypingIndicatorLib } from './lib/sendTypingIndicator.js';
import { editMessage as editMessageLib } from './lib/editMessage.js';
import { setNickname as setNicknameLib } from './lib/setNickname.js';
import { getBotID as getBotIDLib } from './lib/getBotID.js';
import { getFullThreadInfo as getFullThreadInfoLib } from './lib/getFullThreadInfo.js';
import { getFullUserInfo as getFullUserInfoLib } from './lib/getFullUserInfo.js';
import { removeUserFromGroup as removeUserFromGroupLib } from './lib/removeUserFromGroup.js';
import {
  restrictUser as restrictUserLib,
  unrestrictUser as unrestrictUserLib,
} from './lib/restrictUser.js';
import { getAvatarUrl as getAvatarUrlLib } from './lib/getAvatarUrl.js';

// Unsupported operations consolidated into single file
import {
  addUserToGroup as addUserToGroupLib,
  setGroupReaction as setGroupReactionLib,
  setGroupImage as setGroupImageLib,
  removeGroupImage as removeGroupImageLib,
} from './unsupported.js';

// Database fallbacks for cross-platform unified name resolution
import { getUserName as dbGetUserName } from '@/engine/repos/users.repo.js';
import { getThreadName as dbGetThreadName } from '@/engine/repos/threads.repo.js';

export type FluxerTextChannel = TextChannel | DMChannel;

// ── createFluxerApi (channel factory) ─────────────────────────────────────────

/**
 * Creates a UnifiedApi that sends messages to a Fluxer text/DM channel.
 * Used for all non-interaction events (messageCreate, messageReactionAdd,
 * guildMemberAdd/Remove, messageDelete) — Fluxer has no slash/interaction path.
 * Each method delegates to the same lib functions as every other platform wrapper.
 *
 * @param channel - Text/DM channel bound to this api instance
 * @param guild   - Guild context when the channel lives in a server; null for DMs
 * @param rawMessage - The originating Message object (zero-REST cached context)
 * @param client  - The logged-in Client for REST fallbacks (names, avatars, guilds)
 */
export function createFluxerApi(
  channel: FluxerTextChannel,
  guild: Guild | null,
  rawMessage: Message | null = null,
  client: Client | null = null,
): UnifiedApi {
  const api = new UnifiedApi();
  api.platform = Platforms.Fluxer;

  /**
   * Resolves the target channel for sends.
   * Returns the bound channel when targetId matches or client is unavailable.
   * Falls back to the bound channel when the target cannot be resolved.
   */
  async function resolveChannel(
    targetId: string,
  ): Promise<FluxerTextChannel> {
    if (!targetId || targetId === channel.id || !client) return channel;
    try {
      const ch = await client.channels.fetch(targetId);
      if (ch && 'send' in ch)
        return ch as unknown as FluxerTextChannel;
    } catch {
      /* unresolvable — fall through to bound channel */
    }
    return channel;
  }

  // sendFn for direct channel sends — returns the Message object so lib can extract .id
  const channelSendFn = async (
    content: string,
    files: FluxerFile[],
    embeds: EmbedBuilder[],
  ): Promise<{ id: string } | undefined> => {
    const sent = await channel.send({
      content,
      ...(files.length > 0 ? { files } : {}),
      ...(embeds.length > 0 ? { embeds } : {}),
    });
    return { id: sent.id };
  };

  api.sendMessage = (msg, _threadID) => {
    logger.debug('[fluxer] sendMessage called', { threadID: _threadID });
    return (async () => {
      const targetCh = await resolveChannel(_threadID);
      if (targetCh !== channel) {
        // Cross-channel send: route directly to the target channel
        const text =
          typeof msg === 'string'
            ? msg
            : ((buildFluxerMentionMsg(msg) as SendPayload).message ?? '');
        const sent = await targetCh.send(text);
        return sent.id;
      }
      return sendMessageLib(channelSendFn, buildFluxerMentionMsg(msg));
    })();
  };

  api.unsendMessage = (messageID) => {
    logger.debug('[fluxer] unsendMessage called', { messageID });
    return unsendMessageLib(channel.messages, messageID);
  };

  api.getUserInfo = (userIds) => {
    logger.debug('[fluxer] getUserInfo called', { userCount: userIds.length });
    return getUserInfoLib(async (id) => {
      try {
        const member = await guild!.fetchMember(id);
        return { name: member.displayName };
      } catch {
        return { name: `User ${id}` };
      }
    }, userIds);
  };

  api.setGroupName = (_tid, name) => {
    logger.debug('[fluxer] setGroupName called', { threadID: _tid, name });
    return setGroupNameLib(guild, name);
  };
  api.setGroupImage = (_tid, _img) => {
    logger.debug('[fluxer] setGroupImage called', { threadID: _tid });
    return setGroupImageLib();
  };
  api.removeGroupImage = (_tid) => {
    logger.debug('[fluxer] removeGroupImage called', { threadID: _tid });
    return removeGroupImageLib();
  };
  api.addUserToGroup = (_tid, _uid) => {
    logger.debug('[fluxer] addUserToGroup called', {
      threadID: _tid,
      userID: _uid,
    });
    return addUserToGroupLib();
  };
  api.removeUserFromGroup = (_tid, uid) => {
    logger.debug('[fluxer] removeUserFromGroup called', {
      threadID: _tid,
      userID: uid,
    });
    return removeUserFromGroupLib(guild, uid);
  };
  api.setGroupReaction = (_tid, _e) => {
    logger.debug('[fluxer] setGroupReaction called', {
      threadID: _tid,
      emoji: _e,
    });
    return setGroupReactionLib();
  };

  api.replyMessage = async (_threadID, options) => {
    logger.debug('[fluxer] replyMessage called', { threadID: _threadID });
    const targetCh = await resolveChannel(_threadID);
    const msgBody =
      (
        buildFluxerMentionMsg({
          message:
            typeof options?.message === 'string'
              ? options.message
              : (options?.message?.message ?? options?.message?.body ?? ''),
          mentions:
            options?.mentions ??
            (typeof options?.message === 'object'
              ? (options.message.mentions ?? [])
              : []),
        }) as SendPayload
      ).message ?? '';
    const resolvedOpts = {
      message: msgBody,
      ...(options?.attachment !== undefined
        ? { attachment: options.attachment }
        : {}),
      ...(options?.attachment_url !== undefined
        ? { attachment_url: options.attachment_url }
        : {}),
      ...(options?.reply_to_message_id !== undefined
        ? { reply_to_message_id: options.reply_to_message_id }
        : {}),
    };
    return replyMessageLib(
      async (content, files, replyId, embeds) => {
        if (replyId) {
          const sent = await targetCh.send({
            content,
            ...(files.length > 0 ? { files } : {}),
            ...(embeds && embeds.length > 0 ? { embeds } : {}),
            replyTo: { channelId: targetCh.id, messageId: replyId },
          });
          return sent.id;
        }
        const sent = await targetCh.send({
          content,
          ...(files.length > 0 ? { files } : {}),
          ...(embeds && embeds.length > 0 ? { embeds } : {}),
        });
        return sent.id;
      },
      resolvedOpts,
    );
  };

  api.reactToMessage = (_tid, mid, emoji) => {
    logger.debug('[fluxer] reactToMessage called', {
      threadID: _tid,
      messageID: mid,
      emoji,
    });
    return reactToMessageLib(channel.messages, mid, emoji, rawMessage);
  };
  api.sendTypingIndicator = (_tid, _action = 'typing') => {
    logger.debug('[fluxer] sendTypingIndicator called', {
      threadID: _tid,
      action: _action,
    });
    return sendTypingIndicatorLib(channel);
  };
  api.editMessage = (mid, options) => {
    logger.debug('[fluxer] editMessage called', { messageID: mid });
    return editMessageLib(channel.messages, mid, options);
  };
  api.setNickname = (_tid, uid, nick) => {
    logger.debug('[fluxer] setNickname called', {
      threadID: _tid,
      userID: uid,
      nickname: nick,
    });
    return setNicknameLib(guild, uid, nick);
  };
  api.restrictUser = (_tid, uid, durationMs) => {
    logger.debug('[fluxer] restrictUser called', {
      threadID: _tid,
      userID: uid,
      durationMs,
    });
    return restrictUserLib(guild, uid, durationMs);
  };
  api.unrestrictUser = (_tid, uid) => {
    logger.debug('[fluxer] unrestrictUser called', {
      threadID: _tid,
      userID: uid,
    });
    return unrestrictUserLib(guild, uid);
  };
  api.getBotID = () => {
    logger.debug('[fluxer] getBotID called');
    return getBotIDLib(client, guild);
  };
  api.getFullThreadInfo = (tid) => {
    logger.debug('[fluxer] getFullThreadInfo called', { threadID: tid });
    return getFullThreadInfoLib(client, channel, tid);
  };
  api.getFullUserInfo = (uid) => {
    logger.debug('[fluxer] getFullUserInfo called', { userID: uid });
    return getFullUserInfoLib(client, guild, uid);
  };
  // Cache-first name resolution — event payloads already carry the author
  api.getUserName = (uid) => {
    logger.debug(
      '[fluxer] getUserName called (cache-first with db fallback)',
      { userID: uid },
    );
    const cachedAuthor = rawMessage?.author;
    if (cachedAuthor?.id === uid)
      return Promise.resolve(cachedAuthor.globalName ?? cachedAuthor.username);
    const cachedUser = client?.users.get?.(uid);
    if (cachedUser) {
      const u = cachedUser;
      return Promise.resolve(u.globalName ?? u.username);
    }
    return dbGetUserName(uid);
  };
  api.getThreadName = (_tid) => {
    logger.debug(
      '[fluxer] getThreadName called (cache-first with db fallback)',
      { threadID: _tid },
    );
    const name = guild?.name || channel.name;
    if (name) return Promise.resolve(name);
    return dbGetThreadName(_tid);
  };
  api.getAvatarUrl = (uid) => {
    logger.debug('[fluxer] getAvatarUrl called', { userID: uid });
    return getAvatarUrlLib(client, guild, uid);
  };
  api.getMemberCount = (_tid) => {
    logger.debug('[fluxer] getMemberCount called', { threadID: _tid });
    return Promise.resolve(guild?.memberCount ?? 0);
  };
  api.leaveThread = async (threadID: string): Promise<void> => {
    logger.debug('[fluxer] leaveThread called', { threadID });
    if (!client?.user) throw new Error('Client not ready — cannot leave guild.');
    await client.user.leaveGuild(threadID);
  };

  return api;
}

export type { FluxerFile };