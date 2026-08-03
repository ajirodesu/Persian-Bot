import { getMongoDb } from '../client.js';

export async function getUserTimezone(userId: string): Promise<string | null> {
  const db = getMongoDb();
  const rec = await db
    .collection<{ userId: string; timezone: string }>('botUserTimezones')
    .findOne({ userId }, { projection: { _id: 0, timezone: 1 } });
  return rec ? rec.timezone : null;
}

export async function upsertUserTimezone(
  userId: string,
  timezone: string,
): Promise<void> {
  const db = getMongoDb();
  await db.collection('botUserTimezones').updateOne(
    { userId },
    {
      $set: { timezone, updatedAt: new Date() },
      $setOnInsert: { userId, createdAt: new Date() },
    },
    { upsert: true },
  );
}

export async function deleteUserTimezone(userId: string): Promise<void> {
  const db = getMongoDb();
  await db.collection('botUserTimezones').deleteMany({ userId });
}
