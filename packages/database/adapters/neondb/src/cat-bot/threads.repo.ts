import { pool } from '../client.js';
import type { BotThreadData } from '@cat-bot/engine/models/threads.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertThread(data: BotThreadData): Promise<void> {
  const allUserIds = Array.from(
    new Set([...data.participantIDs, ...data.adminIDs]),
  );

  // ATOMICITY — why BEGIN/COMMIT is mandatory here:
  // Replacing the M:M junction rows via DELETE+INSERT must happen inside a single
  // DB transaction. Without explicit BEGIN/COMMIT, a concurrent
  // isThreadAdmin() read arriving between the DELETE and the INSERT sees an empty admin set
  // and incorrectly returns false for every member — observable in high-traffic bursts.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Ghost user rows — satisfy bot_thread_participants / bot_thread_admins FK constraints
    // before the junction inserts run within this same transaction.
    //
    // Each ghost row needs TWO unique $N slots: one for platformId and one for userId.
    // platformId repeats but still needs its own $N per row because pg maps $N to a flat
    // params array `[plat, id0, plat, id1, …]`; sharing $1 would bind only the first slot.
    // Template: $${i*2+1} emits "$1","$3","$5"… for platformId; $${i*2+2} emits "$2","$4","$6"…
    // for userId — first $ is literal, ${expr} is JS interpolation producing the slot number.
    // Contrast with bot-session-commands where $1/$2/$3 ARE reused across rows — valid there
    // because userId/platformId/sessionId are genuinely shared constants, not per-row scalars.
    if (allUserIds.length > 0) {
      const placeholders = allUserIds
        .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}, 'Unknown User')`)
        .join(', ');
      const params = allUserIds.flatMap((id) => [data.platformId, id]);
      await client.query(
        `INSERT INTO bot_users (platform_id, id, name) VALUES ${placeholders}
         ON CONFLICT (id) DO NOTHING`,
        params,
      );
    }

    // Upsert the thread itself
    await client.query(
      `INSERT INTO bot_threads (platform_id, id, name, is_group, type, member_count, avatar_url, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         is_group = EXCLUDED.is_group,
         type = EXCLUDED.type,
         member_count = EXCLUDED.member_count,
         avatar_url = EXCLUDED.avatar_url,
         updated_at = NOW()`,
      [
        data.platformId,
        data.id,
        data.name,
        data.isGroup,
        data.type,
        data.memberCount,
        data.avatarUrl,
      ],
    );

    // Atomically replace participants and admins M:M sets — DELETE+INSERT replaces
    // the full junction set within a single transaction.
    // $1 = threadId (shared constant across all rows); $${i+2} emits "$2","$3"… for each userId.
    await client.query(
      `DELETE FROM bot_thread_participants WHERE thread_id = $1`,
      [data.id],
    );
    if (data.participantIDs.length > 0) {
      const pValues = data.participantIDs
        .map((_, i) => `($1, $${i + 2})`)
        .join(', ');
      await client.query(
        `INSERT INTO bot_thread_participants (thread_id, user_id) VALUES ${pValues} ON CONFLICT DO NOTHING`,
        [data.id, ...data.participantIDs],
      );
    }

    await client.query(`DELETE FROM bot_thread_admins WHERE thread_id = $1`, [
      data.id,
    ]);
    if (data.adminIDs.length > 0) {
      const aValues = data.adminIDs.map((_, i) => `($1, $${i + 2})`).join(', ');
      await client.query(
        `INSERT INTO bot_thread_admins (thread_id, user_id) VALUES ${aValues} ON CONFLICT DO NOTHING`,
        [data.id, ...data.adminIDs],
      );
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
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
  const res = await pool.query(`SELECT 1 FROM bot_threads WHERE id = $1`, [
    threadId,
  ]);
  return (res.rowCount ?? 0) > 0;
}

export async function threadSessionExists(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<boolean> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query(
    `SELECT 1 FROM bot_threads_session
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
    [userId, platformId, sessionId, threadId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function upsertThreadSession(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  // Always set last_updated_at = NOW() on conflict — PostgreSQL does not auto-stamp
  // on UPDATE, so the explicit assignment is required for staleness checks.
  await pool.query(
    `INSERT INTO bot_threads_session (user_id, platform_id, session_id, bot_thread_id, last_updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (user_id, platform_id, session_id, bot_thread_id)
     DO UPDATE SET last_updated_at = NOW()`,
    [userId, platformId, sessionId, threadId],
  );
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
  const res = await pool.query<{ last_updated_at: Date }>(
    `SELECT last_updated_at FROM bot_threads_session
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
    [userId, platformId, sessionId, threadId],
  );
  return res.rows[0]?.last_updated_at ?? null;
}

export async function isThreadAdmin(
  threadId: string,
  userId: string,
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM bot_thread_admins WHERE thread_id = $1 AND user_id = $2`,
    [threadId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

/** Returns 'Unknown thread' when the thread has not been synced yet — safe fallback for display purposes. */
export async function getThreadName(threadId: string): Promise<string> {
  const res = await pool.query<{ name: string | null }>(
    `SELECT name FROM bot_threads WHERE id = $1`,
    [threadId],
  );
  return res.rows[0]?.name ?? 'Unknown thread';
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
  const res = await pool.query<{
    platform_id: number;
    name: string | null;
    is_group: boolean;
    type: string | null;
    member_count: number | null;
    avatar_url: string | null;
    created_at: Date | null;
  }>(
    `SELECT platform_id, name, is_group, type, member_count, avatar_url, created_at
     FROM bot_threads WHERE id = $1`,
    [groupId],
  );
  const row = res.rows[0];
  if (!row) return null;
  return {
    id: groupId,
    platformId: row.platform_id,
    name: row.name,
    isGroup: row.is_group,
    type: row.type,
    memberCount: row.member_count,
    avatarUrl: row.avatar_url,
    createdAt: row.created_at,
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
  const res = await pool.query<{ data: string | null }>(
    `SELECT data FROM bot_threads_session
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
    [userId, platformId, sessionId, botThreadId],
  );
  if (!res.rows[0]?.data) return {};
  try {
    return JSON.parse(res.rows[0].data) as Record<string, unknown>;
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
  await pool.query(
    `UPDATE bot_threads_session SET data = $5
     WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
    [userId, platformId, sessionId, botThreadId, JSON.stringify(data)],
  );
}

/**
 * Returns all group thread IDs for a (userId, platform, sessionId) tuple.
 * JOIN to bot_threads filters to group=true so broadcast commands only reach group chats.
 */
export async function getAllGroupThreadIds(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<string[]> {
  const platformId = toPlatformNumericId(platform);
  const res = await pool.query<{ bot_thread_id: string }>(
    `SELECT bts.bot_thread_id
     FROM bot_threads_session bts
     INNER JOIN bot_threads bt ON bt.id = bts.bot_thread_id
     WHERE bts.user_id = $1 AND bts.platform_id = $2 AND bts.session_id = $3
       AND bt.is_group = TRUE`,
    [userId, platformId, sessionId],
  );
  return res.rows.map((r) => r.bot_thread_id);
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
 * The session-scoped deletes commit in their own transaction FIRST, so a
 * best-effort GC failure can never roll back the primary cleanup. GC runs after
 * commit and swallows FK violations — the shared bot_threads row simply stays
 * because another live session needs it, which is the correct outcome.
 */
export async function deleteThread(
  userId: string,
  platform: string,
  sessionId: string,
  threadId: string,
): Promise<void> {
  const platformId = toPlatformNumericId(platform);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM bot_threads_session
       WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
      [userId, platformId, sessionId, threadId],
    );
    await client.query(
      `DELETE FROM bot_threads_session_banned
       WHERE user_id = $1 AND platform_id = $2 AND session_id = $3 AND bot_thread_id = $4`,
      [userId, platformId, sessionId, threadId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Orphan cleanup — best-effort, after the critical transaction committed.
  // A concurrent session linking the thread between the count and the delete
  // trips the FK constraint; that error is swallowed and the shared row kept.
  try {
    const res = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM bot_threads_session WHERE bot_thread_id = $1`,
      [threadId],
    );
    if (Number(res.rows[0]?.cnt ?? 0) === 0) {
      // Cascades bot_thread_participants / bot_thread_admins via FK ON DELETE CASCADE.
      await pool.query(`DELETE FROM bot_threads WHERE id = $1`, [threadId]);
    }
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code ?? '';
    const msg = err instanceof Error ? err.message : String(err);
    if (code !== '23503' && !msg.includes('FOREIGN KEY')) {
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
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      `DELETE FROM bot_discord_server_session WHERE user_id = $1 AND session_id = $2 AND bot_server_id = $3`,
      [userId, sessionId, serverId],
    );

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  // Orphan cleanup — best-effort, after the session link is committed.
  try {
    const res = await pool.query<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt FROM bot_discord_server_session WHERE bot_server_id = $1`,
      [serverId],
    );
    if (Number(res.rows[0]?.cnt ?? 0) === 0) {
      // Cascades bot_discord_channel / bot_discord_server_participants /
      // bot_discord_server_admins / remaining sessions via FK ON DELETE CASCADE.
      await pool.query(`DELETE FROM bot_discord_server WHERE id = $1`, [
        serverId,
      ]);
    }
  } catch (err) {
    const code = (err as { code?: string } | undefined)?.code ?? '';
    const msg = err instanceof Error ? err.message : String(err);
    if (code !== '23503' && !msg.includes('FOREIGN KEY')) {
      throw err;
    }
  }
}

// ── Discord Server Support ──────────────────────────────────────────────────

export async function upsertDiscordServer(data: any): Promise<void> {
  const allUserIds = Array.from(
    new Set([...data.participantIDs, ...data.adminIDs]),
  );
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (allUserIds.length > 0) {
      const placeholders = allUserIds
        .map((_, i) => `($${i * 2 + 1}, $${i * 2 + 2}, 'Unknown User')`)
        .join(', ');
      const params = allUserIds.flatMap((id) => [1, id]); // 1 = Discord
      await client.query(
        `INSERT INTO bot_users (platform_id, id, name) VALUES ${placeholders} ON CONFLICT (id) DO NOTHING`,
        params,
      );
    }
    await client.query(
      `INSERT INTO bot_discord_server (id, name, avatar_url, member_count, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (id) DO UPDATE SET
         name = EXCLUDED.name,
         avatar_url = EXCLUDED.avatar_url,
         member_count = EXCLUDED.member_count,
         updated_at = NOW()`,
      [data.id, data.name, data.avatarUrl, data.memberCount],
    );

    await client.query(
      `DELETE FROM bot_discord_server_participants WHERE server_id = $1`,
      [data.id],
    );
    if (data.participantIDs.length > 0) {
      const pValues = data.participantIDs
        .map((_: any, i: number) => `($1, $${i + 2})`)
        .join(', ');
      await client.query(
        `INSERT INTO bot_discord_server_participants (server_id, user_id) VALUES ${pValues} ON CONFLICT DO NOTHING`,
        [data.id, ...data.participantIDs],
      );
    }

    await client.query(
      `DELETE FROM bot_discord_server_admins WHERE server_id = $1`,
      [data.id],
    );
    if (data.adminIDs.length > 0) {
      const aValues = data.adminIDs
        .map((_: any, i: number) => `($1, $${i + 2})`)
        .join(', ');
      await client.query(
        `INSERT INTO bot_discord_server_admins (server_id, user_id) VALUES ${aValues} ON CONFLICT DO NOTHING`,
        [data.id, ...data.adminIDs],
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function linkDiscordChannel(
  serverId: string,
  threadId: string,
  name?: string | null,
  type?: string | null,
): Promise<void> {
  await pool.query(
    `INSERT INTO bot_discord_channel (server_id, thread_id, name, type)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (thread_id) DO UPDATE SET
       server_id = EXCLUDED.server_id,
       name = EXCLUDED.name,
       type = EXCLUDED.type`,
    [serverId, threadId, name ?? null, type ?? null],
  );
}

export async function getDiscordServerIdByChannel(
  threadId: string,
): Promise<string | null> {
  const res = await pool.query(
    `SELECT server_id FROM bot_discord_channel WHERE thread_id = $1`,
    [threadId],
  );
  return res.rows[0]?.server_id ?? null;
}

export async function upsertDiscordServerSession(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<void> {
  await pool.query(
    `INSERT INTO bot_discord_server_session (user_id, session_id, bot_server_id, last_updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (user_id, session_id, bot_server_id) DO UPDATE SET last_updated_at = NOW()`,
    [userId, sessionId, serverId],
  );
}

export async function getDiscordServerSessionUpdatedAt(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<Date | null> {
  const res = await pool.query(
    `SELECT last_updated_at FROM bot_discord_server_session WHERE user_id = $1 AND session_id = $2 AND bot_server_id = $3`,
    [userId, sessionId, serverId],
  );
  return res.rows[0]?.last_updated_at ?? null;
}

export async function getDiscordServerSessionData(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<Record<string, unknown>> {
  const res = await pool.query(
    `SELECT data FROM bot_discord_server_session WHERE user_id = $1 AND session_id = $2 AND bot_server_id = $3`,
    [userId, sessionId, serverId],
  );
  if (!res.rows[0]?.data) return {};
  try {
    return JSON.parse(res.rows[0].data) as Record<string, unknown>;
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
  await pool.query(
    `UPDATE bot_discord_server_session SET data = $4 WHERE user_id = $1 AND session_id = $2 AND bot_server_id = $3`,
    [userId, sessionId, serverId, JSON.stringify(data)],
  );
}

export async function isDiscordServerAdmin(
  serverId: string,
  userId: string,
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM bot_discord_server_admins WHERE server_id = $1 AND user_id = $2`,
    [serverId, userId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function getDiscordServerName(serverId: string): Promise<string> {
  const res = await pool.query<{ name: string }>(
    `SELECT name FROM bot_discord_server WHERE id = $1`,
    [serverId],
  );
  return res.rows[0]?.name ?? 'Unknown server';
}

export async function getAllDiscordServerIds(
  userId: string,
  sessionId: string,
): Promise<string[]> {
  const res = await pool.query<{ bot_server_id: string }>(
    `SELECT bot_server_id FROM bot_discord_server_session WHERE user_id = $1 AND session_id = $2`,
    [userId, sessionId],
  );
  return res.rows.map((r) => r.bot_server_id);
}

export async function discordServerExists(serverId: string): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM bot_discord_server WHERE id = $1`,
    [serverId],
  );
  return (res.rowCount ?? 0) > 0;
}

export async function discordServerSessionExists(
  userId: string,
  sessionId: string,
  serverId: string,
): Promise<boolean> {
  const res = await pool.query(
    `SELECT 1 FROM bot_discord_server_session WHERE user_id = $1 AND session_id = $2 AND bot_server_id = $3`,
    [userId, sessionId, serverId],
  );
  return (res.rowCount ?? 0) > 0;
}
