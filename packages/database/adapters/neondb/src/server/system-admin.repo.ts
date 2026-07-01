import { randomUUID } from 'node:crypto';
import { pool } from '../client.js';
import type { GetAdminUserListResponseDto } from '@persian/server/dtos/admin.dto.js';

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
 * user_id column but no FK constraint, so they're purged explicitly first — same scope
 * as the prisma-sqlite adapter's deleteUser.
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
