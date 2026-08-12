import { tursoClient } from '../client.js';
import type { BotThreadData } from '@cat-bot/engine/models/threads.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertThread(data: BotThreadData): Promise<void> {
  const allUserIds = Array.from(
    new Set([...data.participantIDs, ...data.adminIDs]),
  );

  // ATOMICITY — why a libSQL write transaction is mandatory here:
  // Replacing the M:M junction rows via DELETE+INSERT must happen inside a single
  // DB transaction. Without it, a concurrent isThreadAdmin() read arriving between
  // the DELETE and the INSERT sees an empty admin set and incorrectly returns false
  // for every member — observable in high-traffic bursts.
  const tx = await tursoClient.transaction('write');
  try {
    // Ghost user rows — satisfy bot_thread_participants / bot_thread_admins FK constraints
    // before the junction inserts run within this same transaction.
    // Each ghost row needs its own uniquely-named `:uidN` param; platformId is a shared
    // named param reused across every row.
    if (allUserIds.length > 0) {
      const placeholders = allUserIds
        .map((_, i) => `(:platformId, :uid${i}, 'Unknown User')`)
        .join(', ');
      const args: Record<string, string | number> = {
        platformId: data.platformId,
      };
      allUserIds.forEach((id, i) => {
        args[`uid${i}`] = id;
      });
      await tx.execute({
        sql: `INSERT INTO bot_users (platform_id, id, name) VALUES ${placeholders}
              ON CONFLICT (id) DO NOTHING`,
        args,
      });
    }

    // Upsert the thread itself
    await tx.execute({
      sql: `INSERT INTO bot_threads (platform_id, id, name, is_group, type, member_count, avatar_url, updated_at)
            VALUES (:platformId, :id, :name, :isGroup, :type, :memberCount, :avatarUrl, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
            ON CONFLICT (id) DO UPDATE SET
              name = excluded.name,
              is_group = excluded.is_group,
              type = excluded.type,
              member_count = excluded.member_count,
              avatar_url = excluded.avatar_url,
              updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      args: {
        platformId: data.platformId,
        id: data.id,
        name: data.name,
        isGroup: data.isGroup ? 1 : 0,
        type: data.type,
        memberCount: data.memberCount,
        avatarUrl: data.avatarUrl,
      },
    });

    // Atomically replace participants and admins M:M sets — DELETE+INSERT replaces
    // the full junction set within a single transaction.
    await tx.execute({
      sql: `DELETE FROM bot_thread_participants WHERE thread_id = :id`,
      args: { id: data.id },
    });
    if (data.participantIDs.length > 0) {
      const pValues = data.participantIDs
        .map((_, i) => `(:id, :pid${i})`)
        .join(', ');
      const pArgs: Record<string, string> = { id: data.id };
      data.participantIDs.forEach((id, i) => {
        pArgs[`pid${i}`] = id;
      });
      await tx.execute({
        sql: `INSERT INTO bot_thread_participants (thread_id, user_id) VALUES ${pValues} ON CONFLICT DO NOTHING`,
        args: pArgs,
      });
    }

    await tx.execute({
      sql: `DELETE FROM bot_thread_admins WHERE thread_id = :id`,
      args: { id: data.id },
    });
    if (data.adminIDs.length > 0) {
      const aValues = data.adminIDs
        .map((_, i) => `(:id, :aid${i})`)
        .join(', ');
      const aArgs: Record<string, string> = { id: data.id };
      data.adminIDs.forEach((id, i) => {
        aArgs[`aid${i}`] = id;
      });
      await tx.execute({
        sql: `INSERT INTO bot_thread_admins (thread_id, user_id) VALUES ${aValues} ON CONFLICT DO NOTHING`,
        args: aArgs,
      });
    }

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export async function threadExists(
  _platform: string,
  threadId: string,
): Promise<boolean> {
  // _platform is intentionally unused — threadId is the globally unique key across all
  // platforms (each platform adapter generates platform-namespaced IDs). Filtering by
  // platform would require a JOIN to bot_threads.platform_id which adds cost with no gain.
  // A lookup by id alone (ignoring platform) is sufficient here.
  const res = await tursoClient.execute({
    sql: `SELECT 1 FROM bot_threads WHERE id = :threadId`,
    args: { threadId },
  });
  return res.rows.length > 0;
}

export async function threadSessionExists(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<boolean> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT 1 FROM bot_threads_session
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_thread_id = :threadId`,
    args: { userId, platformId, sessionId, threadId },
  });
  return res.rows.length > 0;
}

export async function upsertThreadSession(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // Always set last_updated_at to now on conflict — SQLite does not auto-stamp
  // on UPDATE, so the explicit assignment is required for staleness checks.
  await tursoClient.execute({
    sql: `INSERT INTO bot_threads_session (user_id, platform_id, session_id, bot_thread_id, last_updated_at)
          VALUES (:userId, :platformId, :sessionId, :threadId, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT (user_id, platform_id, session_id, bot_thread_id)
          DO UPDATE SET last_updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args: { userId, platformId, sessionId, threadId },
  });
}

/**
 * Returns the lastUpdatedAt timestamp for staleness checks in on-chat.middleware.
 * Returns null when no session row exists — signals middleware to trigger a full sync.
 */
export async function getThreadSessionUpdatedAt(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<Date | null> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT last_updated_at FROM bot_threads_session
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_thread_id = :threadId`,
    args: { userId, platformId, sessionId, threadId },
  });
  const row = res.rows[0] as { last_updated_at: string } | undefined;
  return row?.last_updated_at ? new Date(row.last_updated_at) : null;
}

export async function isThreadAdmin(
  threadId: string,
  userId: string,
): Promise<boolean> {
  const res = await tursoClient.execute({
    sql: `SELECT 1 FROM bot_thread_admins WHERE thread_id = :threadId AND user_id = :userId`,
    args: { threadId, userId },
  });
  return res.rows.length > 0;
}

/** Returns 'Unknown thread' when the thread has not been synced yet — safe fallback for display purposes. */
export async function getThreadName(threadId: string): Promise<string> {
  const res = await tursoClient.execute({
    sql: `SELECT name FROM bot_threads WHERE id = :threadId`,
    args: { threadId },
  });
  const row = res.rows[0] as { name: string | null } | undefined;
  return row?.name ?? 'Unknown thread';
}

/**
 * Returns the full stored record for a group/thread, or null when it has not
 * been synced yet. Powers the AI agent's `get_group` tool (analogous to
 * project-canis's getGroupbyLid) — a rich single-row lookup by chat/thread id.
 */
export async function getGroupById(
  groupId: string,
): Promise<{
  id: string;
  platformId: number;
  name: string | null;
  isGroup: boolean;
  type: string | null;
  memberCount: number | null;
  avatarUrl: string | null;
  createdAt: Date | null;
} | null> {
  const res = await tursoClient.execute({
    sql: `SELECT platform_id, name, is_group, type, member_count, avatar_url, created_at
          FROM bot_threads WHERE id = :groupId`,
    args: { groupId },
  });
  const row = res.rows[0] as
    | {
        platform_id: number;
        name: string | null;
        is_group: number;
        type: string | null;
        member_count: number | null;
        avatar_url: string | null;
        created_at: string;
      }
    | undefined;
  if (!row) return null;
  return {
    id: groupId,
    platformId: row.platform_id,
    name: row.name,
    isGroup: row.is_group === 1,
    type: row.type,
    memberCount: row.member_count,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at ? new Date(row.created_at) : null,
  };
}

// ── Thread Session Data ────────────────────────────────────────────────────────

/**
 * Reads the JSON data blob for a bot_threads_session row.
 * Returns an empty object on missing row, null data, or parse failure —
 * callers always receive a safe default so collection operations never throw on first access.
 */
export async function getThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
): Promise<Record<string, unknown>> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT data FROM bot_threads_session
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_thread_id = :botThreadId`,
    args: { userId, platformId, sessionId, botThreadId },
  });
  const row = res.rows[0] as { data: string | null } | undefined;
  if (!row?.data) return {};
  try {
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Writes the JSON data blob. UPDATE with no matching row is a silent no-op —
 * mirrors updateMany's fail-open contract; avoids an error if upsertThreadSession races.
 */
export async function setThreadSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botThreadId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  await tursoClient.execute({
    sql: `UPDATE bot_threads_session SET data = :data
          WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_thread_id = :botThreadId`,
    args: {
      userId,
      platformId,
      sessionId,
      botThreadId,
      data: JSON.stringify(data),
    },
  });
}

/**
 * Returns all group thread IDs for a (userId, platform, sessionId) tuple.
 * JOIN to bot_threads filters to group=1 so broadcast commands only reach group chats.
 */
export async function getAllGroupThreadIds(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const platformId = toPlatformNumericId(platform);
  const res = await tursoClient.execute({
    sql: `SELECT bts.bot_thread_id AS bot_thread_id
          FROM bot_threads_session bts
          INNER JOIN bot_threads bt ON bt.id = bts.bot_thread_id
          WHERE bts.user_id = :userId AND bts.platform_id = :platformId AND bts.session_id = :sessionId
            AND bt.is_group = 1`,
    args: { userId, platformId, sessionId },
  });
  return (res.rows as unknown as Array<{ bot_thread_id: string }>).map(
    (r) => r.bot_thread_id,
  );
}

// ── Deletion (bot removed from chat/guild) ───────────────────────────────────

/**
 * Removes this bot instance's thread records for a chat the bot has left.
 *
 * Deletes the (userId, platform, sessionId) scoped bot_threads_session row and
 * the matching bot_threads_session_banned row, then garbage-collects the global
 * bot_threads row — and its cascaded participant/admin junctions — but ONLY when
 * no other session still references the thread. bot_threads_session.bot_thread_id
 * has no ON DELETE CASCADE, so deleting the thread row while another session row
 * points at it would throw an FK violation; the orphan-count guard avoids that.
 *
 * The session-scoped deletes run in their own transaction and commit FIRST, so a
 * best-effort GC failure (FK violation when another session still references the
 * thread) can never roll back the primary cleanup. GC runs outside the
 * transaction and swallows FK errors — the shared bot_threads row simply stays
 * because another live session needs it, which is the correct outcome.
 */
export async function deleteThread(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  const tx = await tursoClient.transaction('write');
  try {
    await tx.execute({
      sql: `DELETE FROM bot_threads_session
            WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_thread_id = :threadId`,
      args: { userId, platformId, sessionId, threadId },
    });
    await tx.execute({
      sql: `DELETE FROM bot_threads_session_banned
            WHERE user_id = :userId AND platform_id = :platformId AND session_id = :sessionId AND bot_thread_id = :threadId`,
      args: { userId, platformId, sessionId, threadId },
    });
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  // Orphan cleanup — best-effort, outside the critical transaction.
  // If the FK guard races (another session links the thread between the count
  // and the delete), the constraint error is swallowed and the shared row is
  // kept — the session-scoped deletes above already committed.
  try {
    const res = await tursoClient.execute({
      sql: `SELECT COUNT(*) AS cnt FROM bot_threads_session WHERE bot_thread_id = :threadId`,
      args: { threadId },
    });
    const remaining = Number(
      (res.rows[0] as { cnt: number | bigint | string } | undefined)?.cnt ?? 0,
    );
    if (remaining === 0) {
      // Cascades bot_thread_participants / bot_thread_admins via FK ON DELETE CASCADE.
      await tursoClient.execute({
        sql: `DELETE FROM bot_threads WHERE id = :threadId`,
        args: { threadId },
      });
    }
  } catch (err) {
    // FK violation — another session still references the thread, so the shared
    // bot_threads row must be kept. Any other error is a genuine failure and
    // must not be swallowed.
    const code = (err as { code?: string } | undefined)?.code ?? '';
    const msg = err instanceof Error ? err.message : String(err);
    if (!code.includes('SQLITE_CONSTRAINT') && !msg.includes('FOREIGN KEY')) {
      throw err;
    }
  }
}

/**
 * Removes this bot instance's Discord server records when the bot leaves a guild.
 *
 * Deletes the (userId, sessionId) scoped bot_discord_server_session row in its
 * own committed transaction, then garbage-collects the global bot_discord_server
 * row — cascading channels, participants, and admins — but ONLY when no other
 * session still references the server. bot_discord_server_session.bot_server_id
 * cascades on server delete, so the orphan-count guard prevents nuking another
 * session's association. GC is best-effort after the primary commit, so a GC
 * failure can never leave the session link behind.
 */
export async function deleteDiscordServer(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<void> {
  const tx = await tursoClient.transaction('write');
  try {
    await tx.execute({
      sql: `DELETE FROM bot_discord_server_session
            WHERE user_id = :userId AND session_id = :sessionId AND bot_server_id = :serverId`,
      args: { userId, sessionId, serverId },
    });
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }

  // Orphan cleanup — best-effort, after the session link is committed.
  try {
    const res = await tursoClient.execute({
      sql: `SELECT COUNT(*) AS cnt FROM bot_discord_server_session WHERE bot_server_id = :serverId`,
      args: { serverId },
    });
    const remaining = Number(
      (res.rows[0] as { cnt: number | bigint | string } | undefined)?.cnt ?? 0,
    );
    if (remaining === 0) {
      // Cascades bot_discord_channel / bot_discord_server_participants /
      // bot_discord_server_admins / remaining sessions via FK ON DELETE CASCADE.
      await tursoClient.execute({
        sql: `DELETE FROM bot_discord_server WHERE id = :serverId`,
        args: { serverId },
      });
    }
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code ?? '';
    const msg = err instanceof Error ? err.message : String(err);
    if (!code.includes('SQLITE_CONSTRAINT') && !msg.includes('FOREIGN KEY')) {
      throw err;
    }
  }
}

// ── Discord Server Support ──────────────────────────────────────────────────

export async function upsertDiscordServer(data: any): Promise<void> {
  const allUserIds = Array.from(
    new Set([...data.participantIDs, ...data.adminIDs]),
  );
  const tx = await tursoClient.transaction('write');
  try {
    if (allUserIds.length > 0) {
      const placeholders = allUserIds
        .map((_: any, i: number) => `(1, :uid${i}, 'Unknown User')`)
        .join(', '); // 1 = Discord
      const args: Record<string, string> = {};
      allUserIds.forEach((id: any, i: number) => {
        args[`uid${i}`] = id;
      });
      await tx.execute({
        sql: `INSERT INTO bot_users (platform_id, id, name) VALUES ${placeholders} ON CONFLICT (id) DO NOTHING`,
        args,
      });
    }
    await tx.execute({
      sql: `INSERT INTO bot_discord_server (id, name, avatar_url, member_count, updated_at)
            VALUES (:id, :name, :avatarUrl, :memberCount, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
            ON CONFLICT (id) DO UPDATE SET
              name = excluded.name,
              avatar_url = excluded.avatar_url,
              member_count = excluded.member_count,
              updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
      args: {
        id: data.id,
        name: data.name,
        avatarUrl: data.avatarUrl,
        memberCount: data.memberCount,
      },
    });

    await tx.execute({
      sql: `DELETE FROM bot_discord_server_participants WHERE server_id = :id`,
      args: { id: data.id },
    });
    if (data.participantIDs.length > 0) {
      const pValues = data.participantIDs
        .map((_: any, i: number) => `(:id, :pid${i})`)
        .join(', ');
      const pArgs: Record<string, string> = { id: data.id };
      data.participantIDs.forEach((id: string, i: number) => {
        pArgs[`pid${i}`] = id;
      });
      await tx.execute({
        sql: `INSERT INTO bot_discord_server_participants (server_id, user_id) VALUES ${pValues} ON CONFLICT DO NOTHING`,
        args: pArgs,
      });
    }

    await tx.execute({
      sql: `DELETE FROM bot_discord_server_admins WHERE server_id = :id`,
      args: { id: data.id },
    });
    if (data.adminIDs.length > 0) {
      const aValues = data.adminIDs
        .map((_: any, i: number) => `(:id, :aid${i})`)
        .join(', ');
      const aArgs: Record<string, string> = { id: data.id };
      data.adminIDs.forEach((id: string, i: number) => {
        aArgs[`aid${i}`] = id;
      });
      await tx.execute({
        sql: `INSERT INTO bot_discord_server_admins (server_id, user_id) VALUES ${aValues} ON CONFLICT DO NOTHING`,
        args: aArgs,
      });
    }
    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export async function linkDiscordChannel(
  serverId: string,
  threadId: string,
  name?: string | null,
  type?: string | null,
): Promise<void> {
  await tursoClient.execute({
    sql: `INSERT INTO bot_discord_channel (server_id, thread_id, name, type)
          VALUES (:serverId, :threadId, :name, :type)
          ON CONFLICT (thread_id) DO UPDATE SET
            server_id = excluded.server_id,
            name = excluded.name,
            type = excluded.type`,
    args: {
      serverId,
      threadId,
      name: name ?? null,
      type: type ?? null,
    },
  });
}

export async function getDiscordServerIdByChannel(
  threadId: string,
): Promise<string | null> {
  const res = await tursoClient.execute({
    sql: `SELECT server_id FROM bot_discord_channel WHERE thread_id = :threadId`,
    args: { threadId },
  });
  const row = res.rows[0] as { server_id: string } | undefined;
  return row?.server_id ?? null;
}

export async function upsertDiscordServerSession(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<void> {
  await tursoClient.execute({
    sql: `INSERT INTO bot_discord_server_session (user_id, session_id, bot_server_id, last_updated_at)
          VALUES (:userId, :sessionId, :serverId, STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
          ON CONFLICT (user_id, session_id, bot_server_id) DO UPDATE SET last_updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')`,
    args: { userId, sessionId, serverId },
  });
}

export async function getDiscordServerSessionUpdatedAt(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<Date | null> {
  const res = await tursoClient.execute({
    sql: `SELECT last_updated_at FROM bot_discord_server_session WHERE user_id = :userId AND session_id = :sessionId AND bot_server_id = :serverId`,
    args: { userId, sessionId, serverId },
  });
  const row = res.rows[0] as { last_updated_at: string } | undefined;
  return row?.last_updated_at ? new Date(row.last_updated_at) : null;
}

export async function getDiscordServerSessionData(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<Record<string, unknown>> {
  const res = await tursoClient.execute({
    sql: `SELECT data FROM bot_discord_server_session WHERE user_id = :userId AND session_id = :sessionId AND bot_server_id = :serverId`,
    args: { userId, sessionId, serverId },
  });
  const row = res.rows[0] as { data: string | null } | undefined;
  if (!row?.data) return {};
  try {
    return JSON.parse(row.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function setDiscordServerSessionData(
  userId: string,
  sessionId: string,
  serverId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await tursoClient.execute({
    sql: `UPDATE bot_discord_server_session SET data = :data WHERE user_id = :userId AND session_id = :sessionId AND bot_server_id = :serverId`,
    args: { userId, sessionId, serverId, data: JSON.stringify(data) },
  });
}

export async function isDiscordServerAdmin(
  serverId: string,
  userId: string,
): Promise<boolean> {
  const res = await tursoClient.execute({
    sql: `SELECT 1 FROM bot_discord_server_admins WHERE server_id = :serverId AND user_id = :userId`,
    args: { serverId, userId },
  });
  return res.rows.length > 0;
}

export async function getDiscordServerName(serverId: string): Promise<string> {
  const res = await tursoClient.execute({
    sql: `SELECT name FROM bot_discord_server WHERE id = :serverId`,
    args: { serverId },
  });
  const row = res.rows[0] as { name: string } | undefined;
  return row?.name ?? 'Unknown server';
}

export async function getAllDiscordServerIds(
  userId: string,
  sessionId: string,
): Promise<string[]> {
  const res = await tursoClient.execute({
    sql: `SELECT bot_server_id FROM bot_discord_server_session WHERE user_id = :userId AND session_id = :sessionId`,
    args: { userId, sessionId },
  });
  return (res.rows as unknown as Array<{ bot_server_id: string }>).map(
    (r) => r.bot_server_id,
  );
}

export async function discordServerExists(serverId: string): Promise<boolean> {
  const res = await tursoClient.execute({
    sql: `SELECT 1 FROM bot_discord_server WHERE id = :serverId`,
    args: { serverId },
  });
  return res.rows.length > 0;
}

export async function discordServerSessionExists(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<boolean> {
  const res = await tursoClient.execute({
    sql: `SELECT 1 FROM bot_discord_server_session WHERE user_id = :userId AND session_id = :sessionId AND bot_server_id = :serverId`,
    args: { userId, sessionId, serverId },
  });
  return res.rows.length > 0;
}
