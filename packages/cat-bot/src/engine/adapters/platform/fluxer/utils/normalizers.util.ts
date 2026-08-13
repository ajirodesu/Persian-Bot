/**
 * Fluxer Platform — Event Normalizers
 *
 * Single responsibility: transform native Fluxer event objects into the
 * unified Cat-Bot event contract (PROTO_EVENT_* shapes from models/prototypes/).
 *
 * WHY: Extracted from helper.util.ts — stream utilities and event normalization
 * are unrelated concerns. Event handlers import only what they need from here;
 * helper.util.ts keeps stream/mention utilities without pulling in normalizers.
 */

import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import type {
  Message,
  PartialMessage,
  MessageReactionPayload,
  GuildMember,
} from '@fluxerjs/core';

// ── Guild member events ───────────────────────────────────────────────────────

/**
 * Normalises a Fluxer guildMemberAdd event into a log:subscribe shape
 * so all platforms share the same subscribe event contract.
 */
export function normalizeGuildMemberAddEvent(
  member: GuildMember,
): Record<string, unknown> {
  return {
    type: 'event',
    platform: Platforms.Fluxer,
    threadID: member.guild.systemChannelId || member.guild.id,
    logMessageType: 'log:subscribe',
    logMessageData: {
      addedParticipants: [
        {
          // userFbId maps to the joining user's ID in the unified contract
          userFbId: member.id,
          firstName: member.user.username,
          fullName: member.displayName,
          groupJoinStatus: 'MEMBER',
          initialFolder: 'FOLDER_INBOX',
          initialFolderId: { systemFolderId: 'INBOX' },
          isMessengerUser: false,
          fanoutPolicy: '',
          lastUnsubscribeTimestampMs: '',
        },
      ],
    },
    logMessageBody: `${member.displayName} joined the server.`,
    // guildMemberAdd does not expose who sent the invite without fetching audit logs
    author: '',
  };
}

/**
 * Normalises a Fluxer guildMemberRemove event into a log:unsubscribe shape.
 * Does not distinguish kick vs voluntary leave — that requires a separate audit log fetch.
 */
export function normalizeGuildMemberRemoveEvent(
  member: GuildMember,
): Record<string, unknown> {
  return {
    type: 'event',
    platform: Platforms.Fluxer,
    threadID: member.guild.systemChannelId || member.guild.id,
    logMessageType: 'log:unsubscribe',
    logMessageData: { leftParticipantFbId: member.id },
    logMessageBody: `${member.displayName} left the server.`,
    author: '',
  };
}

// ── Message events ────────────────────────────────────────────────────────────

/** Maps a Fluxer attachment Collection into the unified attachment shape. */
function normalizeAttachments(
  message: Message,
): Array<{ type: string; ID: string; url: string; filename: string | null }> {
  return [...message.attachments.values()].map((att) => ({
    type: 'file',
    ID: att.id,
    url: att.url ?? att.proxy_url ?? '',
    filename: att.filename || null,
  }));
}

/**
 * Normalises a Fluxer messageCreate event into UnifiedMessageEvent.
 * Bot messages are filtered before this is called.
 */
export function normalizeMessageCreateEvent(
  message: Message,
  args: string[],
  referencedMessage: Message | null = null,
): Record<string, unknown> {
  return {
    // Emit 'message_reply' when Fluxer messageReference is set (user hit "Reply")
    type: message.messageReference ? 'message_reply' : 'message',
    platform: Platforms.Fluxer,
    threadID: message.channelId,
    senderID: message.author.id,
    message: message.content,
    messageID: message.id,
    args,
    attachments: normalizeAttachments(message),
    isGroup: !!message.guildId,
    // Mentions arrive as a User[] — map to the { [userId]: '@username' } contract shape
    mentions: Object.fromEntries(
      message.mentions.map((u) => [u.id, `@${u.username}`]),
    ),
    timestamp: message.createdAt.getTime() || null,
    // messageReference is set when the user hits "Reply" on an existing message
    // referencedMessage is pre-resolved by event-handlers.ts via cache-first fetch
    messageReply: message.messageReference
      ? {
          threadID: message.messageReference.channel_id ?? message.channelId,
          messageID: message.messageReference.message_id,
          senderID: referencedMessage?.author?.id ?? '',
          attachments: referencedMessage
            ? normalizeAttachments(referencedMessage)
            : [],
          args: referencedMessage?.content
            ? referencedMessage.content.trim().split(/\s+/).filter(Boolean)
            : [],
          message: referencedMessage?.content ?? null,
          isGroup: !!message.guildId,
          mentions: {},
          timestamp: referencedMessage?.createdAt.getTime() ?? null,
        }
      : null,
  };
}

// ── Reaction events ───────────────────────────────────────────────────────────

/**
 * Normalises a Fluxer messageReactionAdd event into the unified message_reaction shape.
 * The SDK already supplies a resolved user and emoji in the payload.
 * senderID is the author of the reacted-to message — pre-resolved by the event handler
 * from cache (channel.messages.get) so no REST round-trip is needed here.
 */
export function normalizeMessageReactionAddEvent(
  payload: MessageReactionPayload,
  senderID = '',
): Record<string, unknown> {
  return {
    type: 'message_reaction',
    platform: Platforms.Fluxer,
    threadID: payload.channelId,
    messageID: payload.messageId,
    reaction: payload.emoji.name ?? '',
    senderID,
    userID: payload.userId,
    timestamp: Date.now(), // Fluxer gateway does not surface a reaction timestamp; wall-clock is best-effort
    // MQTT field required by PROTO_EVENT_MESSAGE_REACTION — Fluxer has no equivalent
    offlineThreadingID: '',
  };
}

// ── Message delete (unsend) events ────────────────────────────────────────────

/**
 * Normalises a Fluxer messageDelete event into the unified message_unsend shape.
 * Partial messages (uncached at deletion time) only guarantee .id and .channelId —
 * author and content fields will be absent when the message was sent before bot restart.
 */
export function normalizeMessageDeleteEvent(
  message: PartialMessage,
): Record<string, unknown> {
  return {
    type: 'message_unsend',
    platform: Platforms.Fluxer,
    threadID: message.channelId ?? '',
    messageID: message.id,
    senderID: message.authorId ?? '',
    deletionTimestamp: Date.now(),
    timestamp: undefined,
  };
}