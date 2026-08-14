// log.ts
//
// Native Cat-Bot event — bot membership audit log, sent to bot admins only.
//
// WHEN THIS FIRES:
//   Subscribes to both log:subscribe and log:unsubscribe (the same unified
//   membership events that power notice.ts / goodbye.ts), but ONLY reacts
//   when the participant being added/removed is the bot itself — mirrors
//   the self-join/self-leave detection already used in notice.ts and
//   goodbye.ts (bot.getID() compared against addedParticipants /
//   leftParticipantFbId).
//
// ACTOR RESOLUTION:
//   The platform normalizers deliberately leave `event.author` empty — the raw
//   gateway/update payloads do not carry the actor id — so this handler resolves
//   the actor itself from native context and NEVER writes "unknown":
//     - Telegram: ctx.message.from (the user who added/removed the bot, or the
//       bot itself for a self-service join/leave) always carries the full
//       identity inline; read directly with zero API round-trips.
//     - Discord:   guild.fetchAuditLogs() → BotAdd for self-adds, MemberKick /
//       MemberBanAdd for removals; the entry whose target is the bot exposes
//       the executor.
//   Only if every resolution path fails is the event logged as an explicit error
//   and the admin DM skipped — an "unknown" placeholder is never emitted.
//
// DATABASE CLEANUP:
//   When the bot is removed (log:unsubscribe) the chat/guild record is deleted
//   from the database as part of handling the event, so no orphaned group record
//   survives a kick/ban/leave/delete on either platform. Cleanup runs BEFORE
//   actor resolution so a resolution failure can never skip the deletion.
//
// WHERE THIS SENDS:
//   Never to the group chat — only DM'd to every registered bot admin
//   (listBotAdmins), same delivery mechanism as /callad.

import type {
  AppCtx,
  NativeContext,
} from '@/engine/types/controller.types.js';
import type { UserContext } from '@/engine/adapters/models/interfaces/index.js';
import { MessageStyle } from '@/engine/constants/message-style.constants.js';
import type { EventMeta } from '@/engine/types/module-meta.types.js';
import { LogMessageType } from '@/engine/adapters/models/enums/index.js';
import { listBotAdmins } from '@/engine/repos/credentials.repo.js';
import { Platforms } from '@/engine/modules/platform/platform.constants.js';

export const meta: EventMeta = {
  name: 'log',
  type: ['log:subscribe', 'log:unsubscribe'],
  platform: ['discord', 'telegram', 'fluxer'],
  version: '1.1.0',
  author: 'AjiroDesu',
  description:
    'Sends a bot membership update log to bot admins when the bot is added to or removed from a group (Discord, Telegram & Fluxer), and deletes the chat/guild database record on removal.',
};

// Discord audit log event type IDs (AuditLogEvent from discord-api-types):
// BotAdd = 28, MemberKick = 20, MemberBanAdd = 22. There is no dedicated
// "bot removed" audit event — Discord records a kick or ban entry instead.
const DISCORD_AUDIT_BOT_ADD = 28;
const DISCORD_AUDIT_MEMBER_KICK = 20;
const DISCORD_AUDIT_MEMBER_BAN_ADD = 22;

// Structural views of the native objects we read actor data from. Kept inline so
// this module stays decoupled from platform SDK types while remaining null-safe.
interface NativeTelegramCtx {
  message?: {
    from?: {
      id?: number;
      first_name?: string;
      last_name?: string;
      username?: string;
    };
  };
}

interface DiscordAuditExecutor {
  id?: string;
  username?: string;
  globalName?: string | null;
  displayName?: string;
}

interface DiscordAuditEntry {
  targetId?: string | null;
  executor?: DiscordAuditExecutor | null;
}

interface NativeDiscordMember {
  id?: string;
  guild?: {
    id?: string;
    fetchAuditLogs?: (opts: {
      type: number;
      limit: number;
    }) => Promise<{ entries?: DiscordAuditEntry[] }>;
  };
}

interface ResolvedActor {
  /** Platform user id of whoever performed the action. */
  id: string;
  /** Human display label — "@username", display name, or the raw id. Never "unknown". */
  label: string;
}

/** Builds a display label from whatever identity fields we have. Last resort is the raw id — a real identifier, never a placeholder. */
function formatActorLabel(
  username: string | undefined,
  name: string,
  id: string,
): string {
  if (username) return `@${username}`;
  const clean = name.trim();
  if (clean) return clean;
  return id;
}

/** Telegram: ctx.message.from carries the actor's full identity inline — no API round-trip needed. */
function resolveTelegramActor(native: NativeContext): ResolvedActor | null {
  const ctx = native['ctx'] as NativeTelegramCtx | undefined;
  const from = ctx?.message?.from;
  if (!from || from.id === undefined) return null;
  const fullName = `${from.first_name ?? ''} ${from.last_name ?? ''}`.trim();
  return {
    id: String(from.id),
    label: formatActorLabel(from.username, fullName, String(from.id)),
  };
}

/**
 * Discord: fetch the guild audit log and find the entry that acted on the bot
 * (BotAdd on join; MemberKick / MemberBanAdd on removal). The audit log can lag
 * behind the gateway event, so this is best-effort — any failure just returns null.
 */
async function resolveDiscordActor(
  event: Record<string, unknown>,
  native: NativeContext,
  botId: string,
): Promise<ResolvedActor | null> {
  const member = native['member'] as NativeDiscordMember | undefined;
  const guild = member?.guild;
  if (!guild?.fetchAuditLogs) return null;

  const logMessageType = (event['logMessageType'] as string | undefined) ?? '';
  const types =
    logMessageType === LogMessageType.SUBSCRIBE
      ? [DISCORD_AUDIT_BOT_ADD]
      : [DISCORD_AUDIT_MEMBER_KICK, DISCORD_AUDIT_MEMBER_BAN_ADD];

  for (const type of types) {
    try {
      const audit = await guild.fetchAuditLogs({ type, limit: 5 });
      const entry = (audit?.entries ?? []).find((e) => e.targetId === botId);
      const executor = entry?.executor;
      if (executor?.id) {
        return {
          id: executor.id,
          label: formatActorLabel(
            executor.username,
            executor.globalName ?? executor.displayName ?? '',
            executor.id,
          ),
        };
      }
    } catch {
      // Audit log may be delayed or unavailable — try the next event type.
    }
  }
  return null;
}

/**
 * Fluxer: like Discord, fetch the guild audit log and find the entry whose target
 * is the bot. The actor id is `entry.userId` and its identity is hydrated in the
 * `users` array returned by the SDK. Best-effort — any failure returns null.
 */
async function resolveFluxerActor(
  native: NativeContext,
  botId: string,
): Promise<ResolvedActor | null> {
  const member = native['member'] as
    | { guild?: { fetchAuditLogs?: (opts?: unknown) => Promise<unknown> } }
    | undefined;
  const guild = member?.guild;
  if (!guild?.fetchAuditLogs) return null;

  try {
    const audit = (await guild.fetchAuditLogs({
      limit: 10,
    })) as {
      entries?: Array<{
        targetId: string | null;
        userId: string | null;
      }>;
      users?: Array<{ id: string; username: string; globalName?: string | null }>;
    };
    const entry = (audit?.entries ?? []).find((e) => e.targetId === botId);
    const actorId = entry?.userId;
    if (!actorId) return null;
    const actorUser = (audit?.users ?? []).find((u) => u.id === actorId);
    return {
      id: actorId,
      label: formatActorLabel(
        actorUser?.username ?? '',
        actorUser?.globalName ?? actorUser?.username ?? '',
        actorId,
      ),
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the actor who added/removed the bot. Returns a ResolvedActor with a
 * real display label, or throws so the caller can log an explicit error — the
 * "unknown" placeholder is never produced.
 */
async function resolveActor(
  event: Record<string, unknown>,
  native: NativeContext,
  user: UserContext,
  botId: string,
  threadID: string,
): Promise<ResolvedActor> {
  const platform = native.platform;

  // 1. Platform-native inline identity — richest data, zero API round-trips.
  if (platform === Platforms.Telegram) {
    const inline = resolveTelegramActor(native);
    if (inline) return inline;
  } else if (platform === Platforms.Discord) {
    const inline = await resolveDiscordActor(event, native, botId);
    if (inline) return inline;
  } else if (platform === Platforms.Fluxer) {
    const inline = await resolveFluxerActor(native, botId);
    if (inline) return inline;
  }

  // 2. Explicit author id supplied by a normalizer (future-proof fallback).
  const authorId = (event['author'] as string | undefined) ?? '';
  if (authorId) {
    try {
      const info = await user.getInfo(authorId);
      if (info.username) {
        return { id: authorId, label: `@${info.username}` };
      }
      const name = info.name.trim();
      if (name && name !== `User ${authorId}`) {
        return { id: authorId, label: name };
      }
    } catch {
      // fall through to the explicit error below
    }
  }

  throw new Error(
    `Unable to resolve actor identity for bot membership event ` +
      `(thread=${threadID}, platform=${platform}, eventType=${String(
        event['logMessageType'] ?? event['type'] ?? '',
      )})`,
  );
}

/**
 * Resolves the database record to delete when the bot leaves a chat/guild.
 * Discord events carry a channel id in threadID, but the record lives under the
 * guild (server) id — prefer native.member.guild.id when present.
 */
function resolveRemovalTarget(
  event: Record<string, unknown>,
  native: NativeContext,
  threadID: string,
): string {
  if (native.platform === Platforms.Discord) {
    const guildId = (native['member'] as NativeDiscordMember | undefined)?.guild
      ?.id;
    if (guildId) return guildId;
  }
  return (event['threadID'] as string | undefined) ?? threadID;
}

export const onEvent = async ({
  event,
  chat,
  bot,
  thread,
  user,
  native,
  db,
  logger,
}: AppCtx): Promise<void> => {
  try {
    const logMessageType = event['logMessageType'] as string | undefined;
    const botId = await bot.getID();

    let isAdded: boolean;
    let threadID: string;

    if (logMessageType === LogMessageType.SUBSCRIBE) {
      const logMessageData = event['logMessageData'] as
        | Record<string, unknown>
        | undefined;
      const added =
        (logMessageData?.['addedParticipants'] as
          | Record<string, unknown>[]
          | undefined) ?? [];
      const botJoined = added.some(
        (p) => String(p['userFbId'] ?? '') === botId,
      );
      if (!botJoined) return;
      isAdded = true;
      threadID = (event['threadID'] as string | undefined) ?? '';
    } else if (logMessageType === LogMessageType.UNSUBSCRIBE) {
      const logMessageData = event['logMessageData'] as
        | Record<string, unknown>
        | undefined;
      const leftId = String(logMessageData?.['leftParticipantFbId'] ?? '');
      if (!leftId || leftId !== botId) return;
      isAdded = false;
      threadID = (event['threadID'] as string | undefined) ?? '';
    } else {
      return;
    }

    const { userId, platform, sessionId } = native;
    if (!userId || !platform || !sessionId) return;

    // ── DATABASE CLEANUP ──────────────────────────────────────────────────
    // The bot left this chat/guild, so its database record must be removed as
    // part of handling this event. Runs before actor resolution so no failure
    // path (actor lookup, DM delivery) can ever skip the deletion.
    if (!isAdded) {
      try {
        await db.threads.remove(resolveRemovalTarget(event, native, threadID));
      } catch (err) {
        logger.error(
          '[log] Failed to delete chat/guild database record on bot removal',
          { threadID, platform, error: err },
        );
      }
    }

    // ── ACTOR RESOLUTION ──────────────────────────────────────────────────
    // Never writes "unknown": an unresolvable actor is logged as an explicit
    // error and the admin DM is skipped.
    let actor: ResolvedActor;
    try {
      actor = await resolveActor(event, native, user, botId, threadID);
    } catch (err) {
      logger.error(
        '[log] Actor identity could not be resolved — bot membership log skipped',
        { threadID, platform, isAdded, error: err },
      );
      return;
    }

    const admins = await listBotAdmins(userId, platform, sessionId);
    if (admins.length === 0) return;

    const [groupName, groupIds] = await Promise.all([
      thread.getName().catch(() => null),
      db.threads.getGroupIds().catch(() => []),
    ]);

    const chatName = groupName || 'this chat';
    const activeChats = groupIds.length;

    const message = isAdded
      ? [
          '✅ **Bot Membership Update**',
          '',
          '📥 **Status:** Added to New Group',
          `💬 **Chat:** ${chatName}`,
          `🆔 **Chat ID:** "${threadID}"`,
          `👤 **Added By:** ${actor.label}`,
          `📊 **Active Chats:** ${activeChats}`,
        ].join('\n')
      : [
          '🚫 **Bot Membership Update**',
          '',
          '📤 **Status:** Removed from Group',
          `💬 **Chat:** ${chatName}`,
          `🆔 **Chat ID:** "${threadID}"`,
          `👤 **Removed By:** ${actor.label}`,
          `📊 **Active Chats:** ${activeChats}`,
        ].join('\n');

    await Promise.allSettled(
      admins.map((adminId) =>
        chat.reply({
          style: MessageStyle.MARKDOWN,
          message,
          thread_id: adminId,
        }),
      ),
    );
  } catch (err) {
    console.error('❌ log event handler failed:', err);
  }
};
