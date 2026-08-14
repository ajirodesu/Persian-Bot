import { getMongoDb } from '../client.js';

/**
 * Per-user AI provider configuration stored in botUserGroqKeys (the collection
 * name predates the multi-provider feature and is kept for migration
 * compatibility).
 *
 * Each user may configure a key for EITHER provider (or both) — groq keys live
 * in encryptedKey/keyHint, openrouter keys in openrouterEncryptedKey/
 * openrouterKeyHint. `provider` selects the active one, and each provider's
 * model choice is remembered independently so switching providers keeps the
 * user's preferred model for each.
 */
export type AiProvider = 'groq' | 'openrouter';

export interface StoredAiConfig {
  encryptedKey: string;
  keyHint: string;
  openrouterEncryptedKey: string;
  openrouterKeyHint: string;
  provider: AiProvider;
  groqModel: string;
  openrouterModel: string;
}

interface StoredAiConfigDoc {
  encryptedKey?: string;
  keyHint?: string;
  openrouterEncryptedKey?: string;
  openrouterKeyHint?: string;
  provider?: string;
  groqModel?: string;
  openrouterModel?: string;
}

export async function getUserAiConfig(
  userId: string,
): Promise<StoredAiConfig | null> {
  const db = getMongoDb();
  const rec = await db
    .collection<StoredAiConfigDoc>('botUserGroqKeys')
    .findOne(
      { userId },
      {
        projection: {
          _id: 0,
          encryptedKey: 1,
          keyHint: 1,
          openrouterEncryptedKey: 1,
          openrouterKeyHint: 1,
          provider: 1,
          groqModel: 1,
          openrouterModel: 1,
        },
      },
    );
  if (!rec) return null;
  return {
    encryptedKey: rec.encryptedKey ?? '',
    keyHint: rec.keyHint ?? '',
    openrouterEncryptedKey: rec.openrouterEncryptedKey ?? '',
    openrouterKeyHint: rec.openrouterKeyHint ?? '',
    provider: rec.provider === 'openrouter' ? 'openrouter' : 'groq',
    groqModel: rec.groqModel ?? '',
    openrouterModel: rec.openrouterModel ?? '',
  };
}

/**
 * Upserts the encrypted key for ONE provider and makes that provider active
 * with the given model. Only that provider's key fields are touched, so
 * configuring a second provider never wipes the first.
 */
export async function saveUserAiKey(
  userId: string,
  provider: AiProvider,
  encryptedKey: string,
  keyHint: string,
  model: string,
): Promise<void> {
  const db = getMongoDb();
  const set: Record<string, unknown> =
    provider === 'openrouter'
      ? {
          openrouterEncryptedKey: encryptedKey,
          openrouterKeyHint: keyHint,
          provider,
          openrouterModel: model,
        }
      : {
          encryptedKey,
          keyHint,
          provider,
          groqModel: model,
        };
  set.updatedAt = new Date();
  await db.collection('botUserGroqKeys').updateOne(
    { userId },
    {
      $set: set,
      $setOnInsert: { userId, createdAt: new Date() },
    },
    { upsert: true },
  );
}

/** Switches the active provider + its remembered model without touching keys. */
export async function updateUserAiModel(
  userId: string,
  provider: AiProvider,
  model: string,
): Promise<void> {
  const db = getMongoDb();
  const set: Record<string, unknown> =
    provider === 'openrouter'
      ? { provider, openrouterModel: model }
      : { provider, groqModel: model };
  set.updatedAt = new Date();
  await db.collection('botUserGroqKeys').updateOne({ userId }, { $set: set });
}

/** Clears the key fields for ONE provider ('' = not configured). */
export async function deleteUserAiKey(
  userId: string,
  provider: AiProvider,
): Promise<void> {
  const db = getMongoDb();
  const set: Record<string, unknown> =
    provider === 'openrouter'
      ? { openrouterEncryptedKey: '', openrouterKeyHint: '' }
      : { encryptedKey: '', keyHint: '' };
  set.updatedAt = new Date();
  await db.collection('botUserGroqKeys').updateOne({ userId }, { $set: set });
}
