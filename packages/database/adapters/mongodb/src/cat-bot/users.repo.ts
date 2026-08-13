import { getMongoDb } from '../client.js';
import type {
  BotUserData,
  StoredUserProfile,
} from '@cat-bot/engine/models/users.model.js';
import { toPlatformNumericId } from '@cat-bot/engine/modules/platform/platform-id.util.js';

export async function upsertUser(data: BotUserData): Promise<void> {
  const db = getMongoDb();
  await db.collection('botUsers').updateOne(
    { id: data.id },
    {
      $set: {
        name: data.name,
        firstName: data.firstName,
        username: data.username,
        // avatarUrl intentionally omitted to preserve high-res avatars
        updatedAt: new Date(),
      },
      $setOnInsert: {
        platformId: data.platformId,
        id: data.id,
        avatarUrl: data.avatarUrl,
        createdAt: new Date(),
      },
    },
    { upsert: true },
  );
}

export async function userExists(
  _platform: string,
  userId: string,
): Promise<boolean> {
  const db = getMongoDb();
  const rec = await db
    .collection('botUsers')
    .findOne({ id: userId }, { projection: { _id: 1 } });
  return rec !== null;
}

export async function userSessionExists(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<boolean> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection('botUserSessions')
    .findOne(
      { userId, platformId, sessionId, botUserId },
      { projection: { _id: 1 } },
    );
  return rec !== null;
}

export async function upsertUserSession(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // $set lastUpdatedAt on every upsert — if only $setOnInsert were used, the timestamp
  // would freeze at creation time and every subsequent message would be treated as stale,
  // triggering a getFullUserInfo API call on every single event.
  await db.collection('botUserSessions').updateOne(
    { userId, platformId, sessionId, botUserId },
    {
      $set: { lastUpdatedAt: new Date() },
      $setOnInsert: { userId, platformId, sessionId, botUserId },
    },
    { upsert: true },
  );
}

export async function getUserSessionUpdatedAt(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Date | null> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection<{ lastUpdatedAt: Date }>('botUserSessions')
    .findOne(
      { userId, platformId, sessionId, botUserId },
      { projection: { lastUpdatedAt: 1, _id: 0 } },
    );
  return rec?.lastUpdatedAt ?? null;
}

// WHY: Fulfills the fallback requirement directly at the DB layer so callers never handle undefined.
export async function getUserName(userId: string): Promise<string> {
  const db = getMongoDb();
  const rec = await db
    .collection<{ name: string }>('botUsers')
    .findOne({ id: userId }, { projection: { name: 1, _id: 0 } });
  return rec?.name ?? 'Unknown user';
}

export async function getUserAvatar(userId: string): Promise<string | null> {
  const db = getMongoDb();
  const rec = await db
    .collection<{ avatarUrl?: string | null }>('botUsers')
    .findOne({ id: userId }, { projection: { avatarUrl: 1, _id: 0 } });
  return rec?.avatarUrl ?? null;
}

/**
 * Returns the full stored profile for a user by platform user ID, or null when
 * the user has not been synced yet. A single query (vs. exists + name + avatar).
 */
export async function getUserById(
  platform: string,
  userId: string,
): Promise<StoredUserProfile | null> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection<StoredUserProfile & { platformId?: number }>('botUsers')
    .findOne(
      { id: userId, platformId },
      {
        projection: {
          id: 1,
          name: 1,
          firstName: 1,
          username: 1,
          avatarUrl: 1,
          _id: 0,
        },
      },
    );
  if (!rec) return null;
  return {
    id: rec.id,
    name: rec.name,
    firstName: rec.firstName ?? null,
    username: rec.username ?? null,
    avatarUrl: rec.avatarUrl ?? null,
  };
}

/**
 * Returns the full stored profile for a user by username (no @ prefix),
 * scoped to the given platform so a handle shared across platforms resolves
 * to the right user. Most-recently-synced row wins when multiple match.
 */
export async function getUserByUsername(
  platform: string,
  username: string,
): Promise<StoredUserProfile | null> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  // Case-insensitive match — handles are case-insensitive on most platforms.
  // The username is regex-escaped so a hostile handle can never inject patterns.
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rec = await db
    .collection<StoredUserProfile & { platformId?: number }>('botUsers')
    .findOne(
      { username: { $regex: `^${escaped}$`, $options: 'i' }, platformId },
      {
        sort: { updatedAt: -1 as const },
        projection: {
          id: 1,
          name: 1,
          firstName: 1,
          username: 1,
          avatarUrl: 1,
          _id: 0,
        },
      },
    );
  if (!rec) return null;
  return {
    id: rec.id,
    name: rec.name,
    firstName: rec.firstName ?? null,
    username: rec.username ?? null,
    avatarUrl: rec.avatarUrl ?? null,
  };
}

export async function updateUserAvatar(
  userId: string,
  avatarUrl: string,
): Promise<void> {
  const db = getMongoDb();
  await db
    .collection('botUsers')
    .updateOne({ id: userId }, { $set: { avatarUrl, updatedAt: new Date() } });
}

/**
 * Reads the JSON data blob for a specific bot user session record.
 * Returns empty object on missing record, null data, or parse failure — same fail-open
 * contract as the other adapters so collection callers never need to guard against undefined.
 */
export async function getUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
): Promise<Record<string, unknown>> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rec = await db
    .collection<{ data?: string }>('botUserSessions')
    .findOne(
      { userId, platformId, sessionId, botUserId },
      { projection: { data: 1, _id: 0 } },
    );
  if (!rec?.data) return {};
  try {
    return JSON.parse(rec.data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Writes the JSON data blob for a specific bot user session record.
 * Silently no-ops when the record is absent — this is an intentional fail-open contract.
 */
export async function setUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
  botUserId: string,
  data: Record<string, unknown>,
): Promise<void> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  await db
    .collection('botUserSessions')
    .updateOne(
      { userId, platformId, sessionId, botUserId },
      { $set: { data: JSON.stringify(data) } },
    );
}

/**
 * Returns all bot user session records for a given (userId, platform, sessionId) tuple,
 * with their parsed data blobs. Used by the rank command to sort all users by EXP and
 * compute a leaderboard position without a separate ranking collection.
 */
export async function getAllUserSessionData(
  userId: string,
  platform: string,
  sessionId: string,
): Promise<Array<{ botUserId: string; data: Record<string, unknown> }>> {
  const db = getMongoDb();
  const platformId = toPlatformNumericId(platform);
  const rows = await db
    .collection<{ botUserId: string; data?: string }>('botUserSessions')
    .find(
      { userId, platformId, sessionId },
      { projection: { botUserId: 1, data: 1, _id: 0 } },
    )
    .toArray();
  return rows.map((row) => {
    let parsedData: Record<string, unknown> = {};
    if (row.data) {
      try {
        parsedData = JSON.parse(row.data) as Record<string, unknown>;
      } catch {
        /* malformed JSON — default to empty object */
      }
    }
    return { botUserId: row.botUserId, data: parsedData };
  });
}
