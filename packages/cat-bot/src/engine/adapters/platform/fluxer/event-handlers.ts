/**
 * Fluxer Platform — Event Handler Registration
 *
 * Single responsibility: attach all @fluxerjs/core event listeners to the Client
 * and emit normalised events on the unified emitter.
 *
 * WHY: index.ts must stay transport-agnostic. Isolating "what happens when
 * Fluxer fires an event" from "how the bot starts up" mirrors the discord adapter.
 */

import { EventEmitter } from 'events';
import { Events } from '@fluxerjs/core';
import type { Message, MessageReactionPayload } from '@fluxerjs/core';
import type { SessionLogger } from '@/engine/modules/logger/logger.lib.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { createFluxerApi } from './wrapper.js';
import {
  normalizeMessageCreateEvent,
  normalizeMessageReactionAddEvent,
  normalizeMessageDeleteEvent,
  normalizeGuildMemberAddEvent,
  normalizeGuildMemberRemoveEvent,
} from './utils/normalizers.util.js';

interface AttachEventHandlersOptions {
  client: import('@fluxerjs/core').Client;
  emitter: EventEmitter;
  prefix: string;
  userId: string;
  sessionId: string;
  sessionLogger: SessionLogger;
}

/**
 * Attaches all Fluxer event listeners to the client.
 * Each handler normalises the native event and emits on the unified emitter
 * — the emitter surface is identical across all platforms so app.ts needs
 * zero platform branching.
 */
export async function attachEventHandlers(
  options: AttachEventHandlersOptions,
): Promise<void> {
  const { client, emitter, prefix, userId, sessionId, sessionLogger } =
    options;

  const native = {
    platform: Platforms.Fluxer,
    userId,
    sessionId,
  };

  // ── Message listener → emit 'message' / 'message_reply' ─────────────────────
  client.on(Events.MessageCreate, async (message: Message) => {
    if (message.author.bot) return;
    const channel = message.channel;
    if (!channel || !channel.isTextBased()) return;

    const rawArgs = message.content.trim().split(/\s+/).filter(Boolean);
    const api = createFluxerApi(
      channel,
      message.guild ?? null,
      message,
      client,
    );

    // Cache-first reference fetch: the SDK hydrates referencedMessage inline for
    // Reply-type messages — cache.get() has zero REST cost when present.
    const referencedMessage = message.referencedMessage;
    const event = normalizeMessageCreateEvent(
      message,
      rawArgs,
      referencedMessage,
    );

    // Distinguish replies so app.ts can subscribe granularly via platform.on('message_reply')
    const eventType = message.messageReference
      ? 'message_reply'
      : 'message';
    emitter.emit(eventType, {
      api,
      event,
      native: { ...native, message },
      prefix,
    });
  });

  // ── Message reaction → emit 'message_reaction' ──────────────────────────────
  client.on(
    Events.MessageReactionAdd,
    async (payload: MessageReactionPayload) => {
      if (payload.user.bot) return;

      const channel = client.channels.get(payload.channelId);
      if (!channel || !channel.isTextBased()) return;

      // Best-effort cache-only lookup of the reacted-to message to surface its
      // author as senderID (same contract as discord normalizer) — zero REST.
      const cachedMsg = channel.messages?.get(payload.messageId);
      const senderID = cachedMsg?.author?.id ?? '';

      const api = createFluxerApi(
        channel,
        cachedMsg?.guild ?? null,
        cachedMsg ?? null,
        client,
      );
      const event = normalizeMessageReactionAddEvent(payload, senderID);
      emitter.emit('message_reaction', {
        api,
        event,
        native: {
          ...native,
          reaction: payload.reaction,
          user: payload.user,
        },
        prefix,
      });
    },
  );

  // ── Message delete → emit 'message_unsend' ──────────────────────────────────
  client.on(Events.MessageDelete, async (message) => {
    const channel =
      message.channel ?? client.channels.get(message.channelId);
    if (!channel || !channel.isTextBased()) return;
    const api = createFluxerApi(channel, null, null, client);
    const event = normalizeMessageDeleteEvent(message);
    emitter.emit('message_unsend', {
      api,
      event,
      native: { ...native, message },
      prefix,
    });
  });

  // ── Guild member events → emit 'event' ────────────────────────────────────
  client.on(Events.GuildMemberAdd, async (member) => {
    const channelId = member.guild.systemChannelId;
    if (!channelId) return;
    const channel = await client.channels
      .fetch(channelId)
      .catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const api = createFluxerApi(channel, member.guild, null, client);
    const event = normalizeGuildMemberAddEvent(member);
    emitter.emit('event', {
      api,
      event,
      native: { ...native, member },
      prefix,
    });
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const channelId = member.guild.systemChannelId;
    if (!channelId) return;
    const channel = await client.channels
      .fetch(channelId)
      .catch(() => null);
    if (!channel || !channel.isTextBased()) return;
    const api = createFluxerApi(channel, member.guild, null, client);
    const event = normalizeGuildMemberRemoveEvent(member);
    emitter.emit('event', {
      api,
      event,
      native: { ...native, member },
      prefix,
    });
  });

  void sessionLogger; // reserved — logging lives in index.ts orchestrator
}