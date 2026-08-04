/**
 * Returns a rich UnifiedThreadInfo for a Discord guild (server).
 * threadID is a channel ID — the enclosing Guild is the unified "thread" concept.
 * Shared between DiscordApi (interaction) and createDiscordChannelApi (channel) paths
 * by accepting the relevant context objects as explicit parameters.
 */
import type { Client, TextChannel, Guild } from 'discord.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';
// @/ alias resolves via tsc-alias at build / tsx at dev time — replaces ../../../../models/
import { createUnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';
import type { UnifiedThreadInfo } from '@/engine/adapters/models/thread.model.js';

/** Maps discord.js ChannelType numeric values to stable display labels. */
function channelTypeLabel(type: unknown): string | null {
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
    case 13:
      return 'stage';
    case 15:
      return 'forum';
    case 16:
      return 'media';
    default:
      return type == null ? null : String(type);
  }
}

export async function getFullThreadInfo(
  client: Client | null,
  fallbackChannel: TextChannel | null,
  fallbackGuild: Guild | null,
  threadID: string,
): Promise<UnifiedThreadInfo> {
  let channel: TextChannel | null;
  try {
    channel = client
      ? ((await client.channels.fetch(threadID)) as TextChannel)
      : fallbackChannel;
  } catch {
    channel = fallbackChannel;
  }

  const guild =
    (channel as unknown as { guild?: Guild })?.guild ?? fallbackGuild;

  if (!guild) {
    // DM channel — no server context available
    return createUnifiedThreadInfo({
      platform: Platforms.Discord,
      threadID,
      name: (channel as unknown as { name?: string })?.name ?? null,
      isGroup: false,
    });
  }

  // Re-fetch to hydrate fields like approximateMemberCount that aren't in the cache
  let g: Guild = guild;
  try {
    g = await guild.fetch();
  } catch {
    /* use cached guild */
  }

  const cachedMembers = [...(g.members?.cache?.values() ?? [])];

  return createUnifiedThreadInfo({
    platform: Platforms.Discord,
    threadID,
    name: g.name,
    serverID: g.id, // Propagate guild ID so the engine can store settings at the Server level
    channelName: (channel as unknown as { name?: string })?.name ?? null,
    channelType: channelTypeLabel(
      (channel as unknown as { type?: unknown })?.type,
    ),
    isGroup: true,
    memberCount: g.memberCount ?? null,
    participantIDs: cachedMembers.map((m) => m.id),
    // Only the guild owner is guaranteed admin; role-based enumeration left to consumers via raw
    adminIDs: g.ownerId ? [g.ownerId] : [],
    avatarUrl: g.iconURL?.() ?? null,
  });
}
