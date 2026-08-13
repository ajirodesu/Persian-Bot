/**
 * Returns a rich UnifiedThreadInfo for a Fluxer guild (server).
 * threadID is a channel ID — the enclosing Guild is the unified "thread" concept.
 * Shared between messaging paths by accepting the relevant context as explicit
 * parameters.
 */
import type { Client, Channel, Guild } from '@fluxerjs/core';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
import { createUnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';
import type { UnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';

/** Maps Fluxer ChannelType numeric values to stable display labels. */
function channelTypeLabel(type: unknown): string | null {
  // 0=text, 2=voice, 4=category, 998=link, 5=announcement, 10/11/12=threads…
  switch (type) {
    case 0:
      return 'text';
    case 2:
      return 'voice';
    case 4:
      return 'category';
    case 5:
      return 'announcement';
    case 10:
    case 11:
    case 12:
      return 'thread';
    default:
      return type == null ? null : String(type);
  }
}

export async function getFullThreadInfo(
  client: Client | null,
  fallbackChannel: Channel | null,
  threadID: string,
): Promise<UnifiedThreadInfo> {
  let channel: Channel | null;
  try {
    channel = client ? await client.channels.fetch(threadID) : fallbackChannel;
  } catch {
    channel = fallbackChannel ?? null;
  }

  const guildId = (channel as { guildId?: string | null } | null)?.guildId ?? null;

  if (!guildId || !client) {
    // DM channel — no server context available
    return createUnifiedThreadInfo({
      platform: Platforms.Fluxer,
      threadID,
      name: (channel as { name?: string | null } | null)?.name ?? null,
      isGroup: false,
    });
  }

  let guild: Guild | null;
  try {
    guild = await client.guilds.fetch(guildId);
  } catch {
    guild = client.guilds.get(guildId) ?? null;
  }

  if (!guild) {
    return createUnifiedThreadInfo({
      platform: Platforms.Fluxer,
      threadID,
      isGroup: true,
    });
  }

  // Best-effort member list — capped to avoid huge REST payloads; empty on failure
  let participantIDs: string[] = [];
  try {
    participantIDs = (
      await guild.members.fetch({ limit: 100 })
    ).map((m) => m.id);
  } catch {
    /* partial list is acceptable */
  }

  return createUnifiedThreadInfo({
    platform: Platforms.Fluxer,
    threadID,
    name: guild.name,
    serverID: guild.id, // Propagate guild ID so the engine can store settings at the Server level
    channelName: (channel as { name?: string | null } | null)?.name ?? null,
    channelType: channelTypeLabel(
      (channel as { type?: unknown } | null)?.type,
    ),
    isGroup: true,
    memberCount: guild.memberCount ?? null,
    participantIDs,
    // Only the guild owner is guaranteed admin; role-based enumeration left to consumers via raw
    adminIDs: guild.ownerId ? [guild.ownerId] : [],
    avatarUrl: guild.iconURL?.() ?? null,
  });
}