import { getMongoDb } from '../client.js';

/**
 * Per-user AI provider configuration stored in botUserGroqKeys (the collection
 * name predates the multi-provider feature and is kept for migration
 * compatibility).
 *
 * Each user may configure a key for ANY provider (or several) — groq keys live
 * in encryptedKey/keyHint, openrouter keys in openrouterEncryptedKey/
 * openrouterKeyHint, nvidia keys in nvidiaEncryptedKey/nvidiaKeyHint. `provider`
 * selects the active one, and each provider's model choice is remembered
 * independently so switching providers keeps the user's preferred model each.
 */
export type AiProvider = 'openrouter' | 'groq' | 'nvidia';

export interface StoredAiConfig {
  encryptedKey: string;
  keyHint: string;
  openrouterEncryptedKey: string;
  openrouterKeyHint: string;
  nvidiaEncryptedKey: string;
  nvidiaKeyHint: string;
  provider: AiProvider;
  groqModel: string;
  openrouterModel: string;
  nvidiaModel: string;
  /**
   * Free-form per-user agent settings blob. Holds everything that isn't one of
   * the provider key/model fields: the trigger word, agent behavior
   * toggles/limits, and the OpenAI/Gemini key+model slots. Always an object.
   */
  agentSettings: Record<string, unknown>;
}

interface StoredAiConfigDoc {
  encryptedKey?: string;
  keyHint?: string;
  openrouterEncryptedKey?: string;
  openrouterKeyHint?: string;
  nvidiaEncryptedKey?: string;
  nvidiaKeyHint?: string;
  provider?: string;
  groqModel?: string;
  openrouterModel?: string;
  nvidiaModel?: string;
  agentSettings?: Record<string, unknown>;
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
          nvidiaEncryptedKey: 1,
          nvidiaKeyHint: 1,
          provider: 1,
          groqModel: 1,
          openrouterModel: 1,
          nvidiaModel: 1,
          agentSettings: 1,
        },
      },
    );
  if (!rec) return null;
  return {
    encryptedKey: rec.encryptedKey ?? '',
    keyHint: rec.keyHint ?? '',
    openrouterEncryptedKey: rec.openrouterEncryptedKey ?? '',
    openrouterKeyHint: rec.openrouterKeyHint ?? '',
    nvidiaEncryptedKey: rec.nvidiaEncryptedKey ?? '',
    nvidiaKeyHint: rec.nvidiaKeyHint ?? '',
    provider: providerOf(rec.provider),
    groqModel: rec.groqModel ?? '',
    openrouterModel: rec.openrouterModel ?? '',
    nvidiaModel: rec.nvidiaModel ?? '',
    agentSettings:
      rec.agentSettings !== null && typeof rec.agentSettings === 'object'
        ? rec.agentSettings
        : {},
  };
}

/**
 * Merges the given agent settings into the user's stored blob and upserts the
 * doc when it doesn't exist yet. Existing provider key/model fields are
 * untouched.
 */
export async function saveUserAgentSettings(
  userId: string,
  settings: Record<string, unknown>,
): Promise<void> {
  const db = getMongoDb();
  const rec = await db
    .collection<{ agentSettings?: Record<string, unknown> }>('botUserGroqKeys')
    .findOne({ userId }, { projection: { _id: 0, agentSettings: 1 } });
  const merged: Record<string, unknown> = {
    ...(rec?.agentSettings ?? {}),
    ...settings,
  };
  await db.collection('botUserGroqKeys').updateOne(
    { userId },
    {
      $set: { agentSettings: merged, updatedAt: new Date() },
      $setOnInsert: { userId, createdAt: new Date() },
    },
    { upsert: true },
  );
}

function providerOf(value: string | undefined): AiProvider {
  if (value === 'groq') return 'groq';
  if (value === 'nvidia') return 'nvidia';
  return 'openrouter';
}

/**
 * Upserts the encrypted key for ONE provider and makes that provider active
 * with the given model. Only that provider's key fields are touched, so
 * configuring another provider never wipes the first.
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
      : provider === 'nvidia'
        ? {
            nvidiaEncryptedKey: encryptedKey,
            nvidiaKeyHint: keyHint,
            provider,
            nvidiaModel: model,
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
      : provider === 'nvidia'
        ? { provider, nvidiaModel: model }
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
      : provider === 'nvidia'
        ? { nvidiaEncryptedKey: '', nvidiaKeyHint: '' }
        : { encryptedKey: '', keyHint: '' };
  set.updatedAt = new Date();
  await db.collection('botUserGroqKeys').updateOne({ userId }, { $set: set });
}
