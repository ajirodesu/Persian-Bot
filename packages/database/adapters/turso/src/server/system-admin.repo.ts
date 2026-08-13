import { randomUUID } from 'node:crypto';
import { tursoClient } from '../client.js';
import type { GetAdminUserListResponseDto } from '@cat-bot/server/dtos/admin.dto.js';

export interface SystemAdminItem {
  id: string;
  adminId: string;
  createdAt: string;
}

export async function listSystemAdmins(): Promise<SystemAdminItem[]> {
  const res = await tursoClient.execute(
    `SELECT id, admin_id, created_at FROM system_admin ORDER BY created_at ASC`,
  );
  return (
    res.rows as unknown as Array<{
      id: string;
      admin_id: string;
      created_at: string;
    }>
  ).map((r) => ({
    id: r.id,
    adminId: r.admin_id,
    createdAt: new Date(r.created_at).toISOString(),
  }));
}

export async function addSystemAdmin(
  adminId: string,
): Promise<SystemAdminItem> {
  const id = randomUUID();
  // ON CONFLICT DO NOTHING returns the existing row via a follow-up SELECT — avoids two round-trips
  // on the happy path while still handling duplicate inserts gracefully.
  await tursoClient.execute({
    sql: `INSERT INTO system_admin (id, admin_id) VALUES (:id, :adminId) ON CONFLICT (admin_id) DO NOTHING`,
    args: { id, adminId },
  });
  const res = await tursoClient.execute({
    sql: `SELECT id, admin_id, created_at FROM system_admin WHERE admin_id = :adminId LIMIT 1`,
    args: { adminId },
  });
  const row = res.rows[0] as
    | { id: string; admin_id: string; created_at: string }
    | undefined;
  if (!row)
    throw new Error(
      `[system-admin] Failed to insert or find admin_id=${adminId}`,
    );
  return {
    id: row.id,
    adminId: row.admin_id,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

export async function removeSystemAdmin(adminId: string): Promise<void> {
  await tursoClient.execute({
    sql: `DELETE FROM system_admin WHERE admin_id = :adminId`,
    args: { adminId },
  });
}

export async function isSystemAdmin(adminId: string): Promise<boolean> {
  const res = await tursoClient.execute({
    sql: `SELECT id FROM system_admin WHERE admin_id = :adminId LIMIT 1`,
    args: { adminId },
  });
  return res.rows.length > 0;
}

/**
 * Permanently deletes a user account and all associated data.
 * Tables with an ON DELETE CASCADE foreign key to "user" (session, account, bot_session,
 * bot_admin, bot_premium, bot_credential_discord, bot_credential_telegram, and
 * bot_credential_fluxer) are cleaned up
 * automatically by libSQL when the user row is deleted below — provided PRAGMA foreign_keys
 * is ON for the connection, which client.ts sets during initDb(). Tables below carry a
 * user_id column but no FK constraint, so they're purged explicitly first.
 */
export async function deleteUser(userId: string): Promise<void> {
  const tx = await tursoClient.transaction('write');
  try {
    await tx.execute({
      sql: `DELETE FROM bot_session_commands WHERE user_id = :userId`,
      args: { userId },
    });
    await tx.execute({
      sql: `DELETE FROM bot_session_events WHERE user_id = :userId`,
      args: { userId },
    });
    await tx.execute({
      sql: `DELETE FROM bot_users_session_banned WHERE user_id = :userId`,
      args: { userId },
    });
    await tx.execute({
      sql: `DELETE FROM bot_threads_session_banned WHERE user_id = :userId`,
      args: { userId },
    });
    await tx.execute({
      sql: `DELETE FROM bot_discord_server_session_banned WHERE user_id = :userId`,
      args: { userId },
    });
    await tx.execute({
      sql: `DELETE FROM bot_users_session WHERE user_id = :userId`,
      args: { userId },
    });
    await tx.execute({
      sql: `DELETE FROM bot_threads_session WHERE user_id = :userId`,
      args: { userId },
    });
    await tx.execute({
      sql: `DELETE FROM bot_discord_server_session WHERE user_id = :userId`,
      args: { userId },
    });

    // Cascades to session, account, bot_session, bot_admin, bot_premium,
    // bot_credential_discord, bot_credential_telegram, bot_credential_fluxer
    // via ON DELETE CASCADE.
    await tx.execute({
      sql: `DELETE FROM "user" WHERE id = :userId`,
      args: { userId },
    });

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
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
 *   2. Delete every "user" row except excludeUserId — libSQL cascades this to
 *      session, account, bot_session, bot_admin, bot_premium, bot_credential_discord,
 *      bot_credential_telegram, and bot_credential_fluxer automatically via their
 *      ON DELETE CASCADE FKs.
 *   3. Fully clear global, non-owner-scoped bot-identity/system tables (bot_users,
 *      bot_threads, Discord server/channel mappings, system_admin, verification) —
 *      these hold no per-admin ownership, so there is nothing to selectively keep
 *      beyond what already survives via step 1/2 for the excluded admin's rows.
 */
export async function resetAllDatabase(excludeUserId: string): Promise<void> {
  const tx = await tursoClient.transaction('write');
  try {
    // ── Step 1: user-scoped tables with no cascading FK to "user" ──────────────
    await tx.execute({
      sql: `DELETE FROM bot_session_commands WHERE user_id <> :excludeUserId`,
      args: { excludeUserId },
    });
    await tx.execute({
      sql: `DELETE FROM bot_session_events WHERE user_id <> :excludeUserId`,
      args: { excludeUserId },
    });
    // bot_users_session_banned / bot_threads_session_banned carry no FK, but bot_users_session
    // and bot_threads_session hold a non-cascading FK into bot_users / bot_threads, both of
    // which step 3 wipes globally (including rows owned by excludeUserId). So these four are
    // cleared unconditionally rather than scoped to non-excluded users — otherwise the excluded
    // admin's leftover rows still point at bot_users/bot_threads ids step 3 is about to delete,
    // which trips the bot_threads_session/bot_users_session FK.
    await tx.execute('DELETE FROM bot_users_session_banned');
    await tx.execute('DELETE FROM bot_threads_session_banned');
    await tx.execute('DELETE FROM bot_discord_server_session_banned');
    await tx.execute('DELETE FROM bot_users_session');
    await tx.execute('DELETE FROM bot_threads_session');
    await tx.execute({
      sql: `DELETE FROM bot_discord_server_session WHERE user_id <> :excludeUserId`,
      args: { excludeUserId },
    });

    // ── Step 2: every other user account — cascades to session, account,
    // bot_session, bot_admin, bot_premium, bot_credential_discord,
    // bot_credential_telegram, bot_credential_fluxer
    await tx.execute({
      sql: `DELETE FROM "user" WHERE id <> :excludeUserId`,
      args: { excludeUserId },
    });

    // ── Step 3: global bot-identity + system tables, no owner scoping ──────────
    // Deleted in FK-dependency order (children before parents) for clarity, even
    // though ON DELETE CASCADE on these tables would also handle it.
    await tx.execute('DELETE FROM bot_thread_participants');
    await tx.execute('DELETE FROM bot_thread_admins');
    await tx.execute('DELETE FROM bot_discord_server_participants');
    await tx.execute('DELETE FROM bot_discord_server_admins');
    await tx.execute('DELETE FROM bot_discord_channel');
    await tx.execute('DELETE FROM bot_discord_server');
    await tx.execute('DELETE FROM bot_threads');
    await tx.execute('DELETE FROM bot_users');
    await tx.execute('DELETE FROM system_admin');
    await tx.execute('DELETE FROM system_settings');
    await tx.execute('DELETE FROM verification');

    await tx.commit();
  } catch (err) {
    await tx.rollback();
    throw err;
  }
}

export async function listAllUsers(
  search: string = '',
  page: number = 1,
  limit: number = 10,
): Promise<GetAdminUserListResponseDto> {
  const offset = (page - 1) * limit;
  let whereClause = '';
  const queryArgs: Record<string, string | number> = {};

  if (search) {
    const searchPattern = `%${search}%`;
    queryArgs['search'] = searchPattern;
    // SQLite's LIKE is case-insensitive for ASCII by default, matching Postgres ILIKE semantics here.
    whereClause = `WHERE name LIKE :search OR email LIKE :search OR role LIKE :search`;
  }

  const countRes = await tursoClient.execute({
    sql: `
    SELECT COUNT(*) as count FROM "user"
    ${whereClause}
  `,
    args: queryArgs,
  });

  const res = await tursoClient.execute({
    sql: `
    SELECT id, name, email, role, createdAt, banned, emailVerified
    FROM "user"
    ${whereClause}
    ORDER BY createdAt DESC
    LIMIT :limit OFFSET :offset
  `,
    args: { ...queryArgs, limit, offset },
  });

  const statsRes = await tursoClient.execute(`
    SELECT
      COUNT(*) as total_users,
      COUNT(*) FILTER (WHERE role = 'admin') as admin_count,
      COUNT(*) FILTER (WHERE banned = 1) as banned_count
    FROM "user"
  `);

  const total = Number(
    (countRes.rows[0] as { count: number | bigint } | undefined)?.count ?? 0,
  );
  const statsRow = statsRes.rows[0] as
    | {
        total_users: number | bigint;
        admin_count: number | bigint;
        banned_count: number | bigint;
      }
    | undefined;
  if (!statsRow) throw new Error('[system-admin] Failed to compute stats');

  return {
    users: (
      res.rows as unknown as Array<{
        id: string;
        name: string;
        email: string;
        role: string | null;
        createdAt: string;
        banned: number | null;
        emailVerified: number | null;
      }>
    ).map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email,
      role: r.role,
      createdAt: new Date(r.createdAt).toISOString(),
      banned: r.banned === 1,
      // Include the projected email verification status
      emailVerified: r.emailVerified === 1,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    stats: {
      totalUsers: Number(statsRow.total_users),
      adminCount: Number(statsRow.admin_count),
      bannedCount: Number(statsRow.banned_count),
    },
  };
}
