import { getMongoDb } from '../client.js';

export interface StoredGroqKey {
  encryptedKey: string;
  keyHint: string;
}

export async function getUserGroqKey(
  userId: string,
): Promise<StoredGroqKey | null> {
  const db = getMongoDb();
  const rec = await db
    .collection<{ encryptedKey: string; keyHint: string }>('botUserGroqKeys')
    .findOne(
      { userId },
      { projection: { _id: 0, encryptedKey: 1, keyHint: 1 } },
    );
  return rec
    ? { encryptedKey: rec.encryptedKey, keyHint: rec.keyHint }
    : null;
}

export async function upsertUserGroqKey(
  userId: string,
  encryptedKey: string,
  keyHint: string,
): Promise<void> {
  const db = getMongoDb();
  await db.collection('botUserGroqKeys').updateOne(
    { userId },
    {
      $set: { encryptedKey, keyHint, updatedAt: new Date() },
      $setOnInsert: { userId, createdAt: new Date() },
    },
    { upsert: true },
  );
}

export async function deleteUserGroqKey(userId: string): Promise<void> {
  const db = getMongoDb();
  await db.collection('botUserGroqKeys').deleteMany({ userId });
}
