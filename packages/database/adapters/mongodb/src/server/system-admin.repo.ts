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

  // Collections with no FK relation declared on the user row — cleaned up explicitly
  // since MongoDB has no cross-collection cascade for this set.
  await db.collection('botSessionCommands').deleteMany({ userId });
  await db.collection('botSessionEvents').deleteMany({ userId });
  await db.collection('botUserBanned').deleteMany({ userId });
  await db.collection('botThreadBanned').deleteMany({ userId });
  await db.collection('botUserSessions').deleteMany({ userId });
  await db.collection('botThreadSessions').deleteMany({ userId });
  await db.collection('botDiscordServerSessions').deleteMany({ userId });
  await db.collection('botUserGroqKeys').deleteMany({ userId });
  await db.collection('botUserTimezones').deleteMany({ userId });

  // Collections that would cascade automatically in a relational adapter —
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

/**
 * Permanently wipes every database record and system-wide setting, with a single
 * exception: the account and all associated data belonging to `excludeUserId` —
 * the currently authenticated admin who triggered the reset. That admin's "user"
 * document (and everything scoped to it) is left untouched.
 *
 * MongoDB Atlas free tier does not support multi-document transactions, so this
 * is a sequential deleteMany series — same non-transactional pattern as deleteUser
 * above and BotRepo.deleteById in bot.repo.ts.
 *
 * Ordering:
 *   1. Purge collections scoped by userId but with no cross-collection cascade
 *      (MongoDB has none), for every user EXCEPT excludeUserId.
 *   2. Purge collections that a relational adapter would cascade automatically —
 *      deleted explicitly here since MongoDB enforces no FK relationships.
 *   3. Remove every "user" document except excludeUserId's own row.
 *   4. Fully clear global, non-owner-scoped bot-identity/system collections —
 *      these hold no per-admin ownership, so there is nothing to selectively keep.
 */
export async function resetAllDatabase(excludeUserId: string): Promise<void> {
  const db = getMongoDb();
  const notAdmin = { userId: { $ne: excludeUserId } };

  // ── Step 1: user-scoped collections with no cascade relation ────────────────
  await db.collection('botSessionCommands').deleteMany(notAdmin);
  await db.collection('botSessionEvents').deleteMany(notAdmin);
  // botUserBanned/botThreadBanned/botUserSessions/botThreadSessions reference
  // botUsers/botThreads, which step 4 wipes globally regardless of owner — so these
  // are cleared unconditionally rather than scoped to non-excluded users, or the
  // excluded admin's docs are left orphaned, pointing at ids deleted in step 4.
  await db.collection('botUserBanned').deleteMany({});
  await db.collection('botThreadBanned').deleteMany({});
  await db.collection('botUserSessions').deleteMany({});
  await db.collection('botThreadSessions').deleteMany({});
  await db.collection('botDiscordServerSessions').deleteMany(notAdmin);
  await db.collection('botUserGroqKeys').deleteMany(notAdmin);
  await db.collection('botUserTimezones').deleteMany(notAdmin);

  // ── Step 2: collections that would cascade automatically in a relational adapter ──
  await db.collection('session').deleteMany(notAdmin);
  await db.collection('account').deleteMany(notAdmin);
  await db.collection('botSessions').deleteMany(notAdmin);
  await db.collection('botAdmins').deleteMany(notAdmin);
  await db.collection('botPremiums').deleteMany(notAdmin);
  await db.collection('botCredentialDiscord').deleteMany(notAdmin);
  await db.collection('botCredentialTelegram').deleteMany(notAdmin);

  // ── Step 3: every other user account. Mirrors deleteUser's $or lookup so both
  // the better-auth-generated `id` field and the raw `_id` are honoured. ──────────
  await db.collection('user').deleteMany({
    $nor: [{ id: excludeUserId }, { _id: excludeUserId as never }],
  });

  // ── Step 4: global bot-identity + system collections, no owner scoping ─────
  await db.collection('botThreads').deleteMany({});
  await db.collection('botDiscordServers').deleteMany({});
  await db.collection('botDiscordChannels').deleteMany({});
  await db.collection('botUsers').deleteMany({});
  await db.collection('systemAdmin').deleteMany({});
  await db.collection('systemSettings').deleteMany({});
  await db.collection('verification').deleteMany({});
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
