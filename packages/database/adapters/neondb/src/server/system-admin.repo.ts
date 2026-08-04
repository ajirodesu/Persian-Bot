import { randomUUID } from 'node:crypto';
import { pool } from '../client.js';
import type { GetAdminUserListResponseDto } from '@cat-bot/server/dtos/admin.dto.js';

export interface SystemAdminItem {
  id: string;
  adminId: string;
  createdAt: string;
}

export async function listSystemAdmins(): Promise<SystemAdminItem[]> {
  const res = await pool.query<{
    id: string;
    admin_id: string;
    created_at: Date;
  }>(
    `SELECT id, admin_id, created_at FROM system_admin ORDER BY created_at ASC`,
  );
  return res.rows.map((r) => ({
    id: r.id,
    adminId: r.admin_id,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function addSystemAdmin(
  adminId: string,
): Promise<SystemAdminItem> {
  const id = randomUUID();
  // ON CONFLICT DO NOTHING returns the existing row via a follow-up SELECT — avoids two round-trips
  // on the happy path while still handling duplicate inserts gracefully.
  await pool.query(
    `INSERT INTO system_admin (id, admin_id) VALUES ($1, $2) ON CONFLICT (admin_id) DO NOTHING`,
    [id, adminId],
  );
  const res = await pool.query<{
    id: string;
    admin_id: string;
    created_at: Date;
  }>(
    `SELECT id, admin_id, created_at FROM system_admin WHERE admin_id = $1 LIMIT 1`,
    [adminId],
  );
  const row = res.rows[0];
  if (!row)
    throw new Error(
      `[system-admin] Failed to insert or find admin_id=${adminId}`,
    );
  return {
    id: row.id,
    adminId: row.admin_id,
    createdAt: row.created_at.toISOString(),
  };
}

export async function removeSystemAdmin(adminId: string): Promise<void> {
  await pool.query(`DELETE FROM system_admin WHERE admin_id = $1`, [adminId]);
}

export async function isSystemAdmin(adminId: string): Promise<boolean> {
  const res = await pool.query<{ id: string }>(
    `SELECT id FROM system_admin WHERE admin_id = $1 LIMIT 1`,
    [adminId],
  );
  return (res.rows[0] ?? null) !== null;
}

/**
 * Permanently deletes a user account and all associated data.
 * Tables with an ON DELETE CASCADE foreign key to "user" (session, account, bot_session,
 * bot_admin, bot_premium, bot_credential_discord, bot_credential_telegram) are cleaned up
 * automatically by Postgres when the user row is deleted below. Tables below carry a
 * user_id column but no FK constraint, so they're purged explicitly first.
 */
export async function deleteUser(userId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await client.query(`DELETE FROM bot_session_commands WHERE user_id = $1`, [
      userId,
    ]);
    await client.query(`DELETE FROM bot_session_events WHERE user_id = $1`, [
      userId,
    ]);
    await client.query(
      `DELETE FROM bot_users_session_banned WHERE user_id = $1`,
      [userId],
    );
    await client.query(
      `DELETE FROM bot_threads_session_banned WHERE user_id = $1`,
      [userId],
    );
    await client.query(
      `DELETE FROM bot_discord_server_session_banned WHERE user_id = $1`,
      [userId],
    );
    await client.query(`DELETE FROM bot_users_session WHERE user_id = $1`, [
      userId,
    ]);
    await client.query(`DELETE FROM bot_threads_session WHERE user_id = $1`, [
      userId,
    ]);
    await client.query(
      `DELETE FROM bot_discord_server_session WHERE user_id = $1`,
      [userId],
    );

    // Cascades to session, account, bot_session, bot_admin, bot_premium,
    // bot_credential_discord, bot_credential_telegram via ON DELETE CASCADE.
    await client.query(`DELETE FROM "user" WHERE id = $1`, [userId]);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Permanently wipes every database record and system-wide setting, with a single
 * exception: the account and all associated data belonging to `excludeUserId` —
 * the currently authenticated admin who triggered the reset. That admin's row in
 * "user" (and everything that cascades from or is scoped to it) is left untouched.
 *
 * Runs inside one transaction so the reset is all-or-nothing — a failure partway
 * through rolls back rather than leaving the database in a half-wiped state.
 *
 * Ordering:
 *   1. Explicitly purge rows in tables carrying a user_id column but no FK/cascade
 *      relationship to "user", scoped to everyone EXCEPT excludeUserId.
 *   2. Delete every "user" row except excludeUserId — Postgres cascades this to
 *      session, account, bot_session, bot_admin, bot_premium, bot_credential_discord,
 *      and bot_credential_telegram automatically via their ON DELETE CASCADE FKs.
 *   3. Fully clear global, non-owner-scoped bot-identity/system tables (bot_users,
 *      bot_threads, Discord server/channel mappings, system_admin, verification) —
 *      these hold no per-admin ownership, so there is nothing to selectively keep
 *      beyond what already survives via step 1/2 for the excluded admin's rows.
 */
export async function resetAllDatabase(excludeUserId: string): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── Step 1: user-scoped tables with no cascading FK to "user" ──────────────
    await client.query(
      `DELETE FROM bot_session_commands WHERE user_id <> $1`,
      [excludeUserId],
    );
    await client.query(`DELETE FROM bot_session_events WHERE user_id <> $1`, [
      excludeUserId,
    ]);
    // bot_users_session_banned / bot_threads_session_banned carry no FK, but bot_users_session
    // and bot_threads_session hold a non-cascading FK into bot_users / bot_threads, both of
    // which step 3 wipes globally (including rows owned by excludeUserId). So these four are
    // cleared unconditionally rather than scoped to non-excluded users — otherwise the excluded
    // admin's leftover rows still point at bot_users/bot_threads ids step 3 is about to delete,
    // which trips "bot_threads_session_bot_thread_id_fkey" / the analogous bot_users_session FK.
    await client.query(`DELETE FROM bot_users_session_banned`);
    await client.query(`DELETE FROM bot_threads_session_banned`);
    await client.query(`DELETE FROM bot_discord_server_session_banned`);
    await client.query(`DELETE FROM bot_users_session`);
    await client.query(`DELETE FROM bot_threads_session`);
    await client.query(
      `DELETE FROM bot_discord_server_session WHERE user_id <> $1`,
      [excludeUserId],
    );

    // ── Step 2: every other user account — cascades to session, account,
    // bot_session, bot_admin, bot_premium, bot_credential_discord, bot_credential_telegram
    await client.query(`DELETE FROM "user" WHERE id <> $1`, [excludeUserId]);

    // ── Step 3: global bot-identity + system tables, no owner scoping ──────────
    // Deleted in FK-dependency order (children before parents) for clarity, even
    // though ON DELETE CASCADE on these tables would also handle it.
    await client.query(`DELETE FROM bot_thread_participants`);
    await client.query(`DELETE FROM bot_thread_admins`);
    await client.query(`DELETE FROM bot_discord_server_participants`);
    await client.query(`DELETE FROM bot_discord_server_admins`);
    await client.query(`DELETE FROM bot_discord_channel`);
    await client.query(`DELETE FROM bot_discord_server`);
    await client.query(`DELETE FROM bot_threads`);
    await client.query(`DELETE FROM bot_users`);
    await client.query(`DELETE FROM system_admin`);
    await client.query(`DELETE FROM verification`);

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function listAllUsers(
  search: string = '',
  page: number = 1,
  limit: number = 10,
): Promise<GetAdminUserListResponseDto> {
  const offset = (page - 1) * limit;
  let whereClause = '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const queryParams: any[] = [];

  if (search) {
    const searchPattern = `%${search}%`;
    queryParams.push(searchPattern);
    whereClause = `WHERE name ILIKE $1 OR email ILIKE $1 OR role ILIKE $1`;
  }

  const countRes = await pool.query<{ count: string }>(
    `
    SELECT COUNT(*) FROM "user"
    ${whereClause}
  `,
    queryParams,
  );

  const queryParamsPaginated = [...queryParams, limit, offset];
  const limitIdx = queryParamsPaginated.length - 1;
  const offsetIdx = queryParamsPaginated.length;

  const res = await pool.query<{
    id: string;
    name: string;
    email: string;
    role: string | null;
    createdAt: Date;
    banned: boolean | null;
    emailVerified: boolean | null;
  }>(
    `
    SELECT id, name, email, role, "createdAt" AS "createdAt", banned, "emailVerified" AS "emailVerified"
    FROM "user" 
    ${whereClause}
    ORDER BY "createdAt" DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `,
    queryParamsPaginated,
  );

  const statsRes = await pool.query<{
    total_users: string;
    admin_count: string;
    banned_count: string;
  }>(`
    SELECT 
      COUNT(*) as total_users,
      COUNT(*) FILTER (WHERE role = 'admin') as admin_count,
      COUNT(*) FILTER (WHERE banned = true) as banned_count
    FROM "user"
  `);

  const total = parseInt(countRes.rows[0]?.count ?? '0', 10);
  const statsRow = statsRes.rows[0]!;

  return {
    users: res.rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      banned: r.banned ?? false,
      // Include the projected email verification status
      emailVerified: r.emailVerified ?? false,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    stats: {
      totalUsers: parseInt(statsRow.total_users, 10),
      adminCount: parseInt(statsRow.admin_count, 10),
      bannedCount: parseInt(statsRow.banned_count, 10),
    },
  };
}
