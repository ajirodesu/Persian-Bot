import { getMongoDb } from '../client.js';

const COLLECTION = 'botUserAiConfigs';

export async function getUserAiConfig(
  userId: string,
): Promise<Record<string, unknown> | null> {
  const db = getMongoDb();
  const rec = await db
    .collection<Record<string, unknown>>(COLLECTION)
    .findOne({ userId }, { projection: { _id: 0 } });
  return rec ?? null;
}

export async function saveUserAiConfig(
  userId: string,
  cols: Record<string, unknown>,
): Promise<void> {
  if (Object.keys(cols).length === 0) return;
  const db = getMongoDb();
  await db.collection(COLLECTION).updateOne(
    { userId },
    {
      $set: { ...cols, updatedAt: new Date() },
      $setOnInsert: { userId, createdAt: new Date() },
    },
    { upsert: true },
  );
}

export async function deleteUserAiConfig(userId: string): Promise<void> {
  const db = getMongoDb();
  await db.collection(COLLECTION).deleteMany({ userId });
}
