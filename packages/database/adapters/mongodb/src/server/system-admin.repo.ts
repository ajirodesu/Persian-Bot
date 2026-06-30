import { randomUUID } from 'node:crypto';
import { getMongoDb } from '../client.js';
import type { GetAdminUserListResponseDto } from '@cat-bot/server/dtos/admin.dto.js';

export interface SystemAdminItem {
  id: string;
  adminId: string;
  createdAt: string;
}

export async function listSystemAdmins(): Promise<SystemAdminItem[]> {
  const db = getMongoDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = await db
    .collection<any>('systemAdmin')
    .find({})
    .sort({ createdAt: 1 })
    .toArray();
  return rows.map((r) => ({
    id: r.id as string,
    adminId: r.adminId as string,
    createdAt: (r.createdAt instanceof Date
      ? r.createdAt
      : new Date(r.createdAt as string)
    ).toISOString(),
  }));
}

export async function addSystemAdmin(
  adminId: string,
): Promise<SystemAdminItem> {
  const db = getMongoDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = await db.collection<any>('systemAdmin').findOne({ adminId });
  if (existing) {
    return {
      id: existing.id as string,
      adminId: existing.adminId as string,
      createdAt: (existing.createdAt instanceof Date
        ? existing.createdAt
        : new Date(existing.createdAt as string)
      ).toISOString(),
    };
  }
  const item = { id: randomUUID(), adminId, createdAt: new Date() };
  await db.collection('systemAdmin').insertOne(item);
  return {
    id: item.id,
    adminId: item.adminId,
    createdAt: item.createdAt.toISOString(),
  };
}

export async function removeSystemAdmin(adminId: string): Promise<void> {
  const db = getMongoDb();
  await db.collection('systemAdmin').deleteMany({ adminId });
}

export async function isSystemAdmin(adminId: string): Promise<boolean> {
  const db = getMongoDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = await db.collection<any>('systemAdmin').findOne({ adminId });
  return row !== null;
}

/**
 * Permanently deletes a user account and all associated data.
 * MongoDB Atlas free tier does not support multi-document transactions, so this is a
 * sequential deleteMany series — same non-transactional pattern as BotRepo.deleteById
 * in bot.repo.ts. Collection names mirror those used by the other MongoDB repos.
 */
export async function deleteUser(userId: string): Promise<void> {
  const db = getMongoDb();

  // Collections with no FK relation declared on the user row in the Prisma schema —
  // mirrors the explicit cleanup the prisma-sqlite adapter performs for the same set.
  await db.collection('botSessionCommands').deleteMany({ userId });
  await db.collection('botSessionEvents').deleteMany({ userId });
  await db.collection('botUserBanned').deleteMany({ userId });
  await db.collection('botThreadBanned').deleteMany({ userId });
  await db.collection('botUserSessions').deleteMany({ userId });
  await db.collection('botThreadSessions').deleteMany({ userId });
  await db.collection('botDiscordServerSessions').deleteMany({ userId });

  // Collections that cascade automatically in the Prisma adapter (onDelete: Cascade) —
  // deleted explicitly here since MongoDB has no FK enforcement.
  await db.collection('session').deleteMany({ userId });
  await db.collection('account').deleteMany({ userId });
  await db.collection('botSessions').deleteMany({ userId });
  await db.collection('botAdmins').deleteMany({ userId });
  await db.collection('botPremiums').deleteMany({ userId });
  await db.collection('botCredentialDiscord').deleteMany({ userId });
  await db.collection('botCredentialTelegram').deleteMany({ userId });

  // Finally remove the user row itself. better-auth's mongodb adapter stores its
  // generated string id directly — fall back to _id for safety, same pattern listAllUsers uses.
  await db.collection('user').deleteOne({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    $or: [{ id: userId }, { _id: userId as any }],
  });
}

export async function listAllUsers(
  search: string = '',
  page: number = 1,
  limit: number = 10,
): Promise<GetAdminUserListResponseDto> {
  const db = getMongoDb();

  // WHY: Escape regex characters to prevent MongoDB query execution errors on symbols like '['
  const escapedSearch = search
    ? search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    : '';
  const query = search
    ? {
        $or: [
          { name: { $regex: escapedSearch, $options: 'i' } },
          { email: { $regex: escapedSearch, $options: 'i' } },
          { role: { $regex: escapedSearch, $options: 'i' } },
        ],
      }
    : {};

  const [users, total, totalUsers, adminCount, bannedCount] = await Promise.all(
    [
      // Perform cursor pagination natively in MongoDB for O(1) page access efficiency
      db
        .collection<any>('user')
        .find(query)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .toArray(),
      db.collection('user').countDocuments(query),
      db.collection('user').countDocuments(),
      db.collection('user').countDocuments({ role: 'admin' }),
      db.collection('user').countDocuments({ banned: true }),
    ],
  );

  return {
    users: users.map((u) => ({
      id: u.id ?? u._id?.toString(),
      name: u.name,
      email: u.email,
      role: u.role ?? null,
      createdAt:
        u.createdAt instanceof Date
          ? u.createdAt.toISOString()
          : new Date(u.createdAt as string).toISOString(),
      banned: u.banned ?? false,
      // Map emailVerified from the MongoDB user document explicitly
      emailVerified: u.emailVerified ?? false,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    stats: { totalUsers, adminCount, bannedCount },
  };
}
