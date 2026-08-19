import { getMongoDb } from '../client.js';

/**
 * Per-user AI provider configuration stored in botUserAiConfigs — one
 * key/hint/model field per provider (openrouter, groq, nvidia, openai, gemini).
 * `provider` selects the active one, and each provider's model choice is
 * remembered independently so switching providers keeps the user's preferred
 * model each. The legacy botUserGroqKeys collection (predates the
 * multi-provider feature) is lazily migrated to this collection on first read.
 */
export type AiProvider = 'openrouter' | 'groq' | 'nvidia' | 'openai' | 'gemini' | 'zen';

export interface StoredAiConfig {
  provider: AiProvider;
  openrouterEncryptedKey: string;
  openrouterKeyHint: string;
  openrouterModel: string;
  groqEncryptedKey: string;
  groqKeyHint: string;
  groqModel: string;
  nvidiaEncryptedKey: string;
  nvidiaKeyHint: string;
  nvidiaModel: string;
  openaiEncryptedKey: string;
  openaiKeyHint: string;
  openaiModel: string;
  geminiEncryptedKey: string;
  geminiKeyHint: string;
  geminiModel: string;
  zenEncryptedKey: string;
  zenKeyHint: string;
  zenModel: string;
  /**
   * Free-form per-user agent settings blob. Holds the agent behavior settings:
   * trigger word, behavior toggles/limits. Provider keys/models all live in
   * their own fields. Always an object.
   */
  agentSettings: Record<string, unknown>;
}

interface StoredAiConfigDoc {
  provider?: string;
  openrouterEncryptedKey?: string;
  openrouterKeyHint?: string;
  openrouterModel?: string;
  groqEncryptedKey?: string;
  groqKeyHint?: string;
  groqModel?: string;
  nvidiaEncryptedKey?: string;
  nvidiaKeyHint?: string;
  nvidiaModel?: string;
  openaiEncryptedKey?: string;
  openaiKeyHint?: string;
  openaiModel?: string;
  geminiEncryptedKey?: string;
  geminiKeyHint?: string;
  geminiModel?: string;
  zenEncryptedKey?: string;
  zenKeyHint?: string;
  zenModel?: string;
  agentSettings?: Record<string, unknown>;
}

const COLLECTION = 'botUserAiConfigs';
const LEGACY_COLLECTION = 'botUserGroqKeys';

const FIELD_PREFIXES = [
  'openrouter',
  'groq',
  'nvidia',
  'openai',
  'gemini',
  'zen',
] as const;

function providerOf(value: string | undefined): AiProvider {
  return value === 'groq' ||
    value === 'nvidia' ||
    value === 'openai' ||
    value === 'gemini' ||
    value === 'zen'
    ? value
    : 'openrouter';
}

function providerField(
  provider: AiProvider,
  suffix: 'EncryptedKey' | 'KeyHint' | 'Model',
): string {
  return `${provider}${suffix}`;
}

function mapStoredConfig(doc: StoredAiConfigDoc): StoredAiConfig {
  const out: StoredAiConfig = {
    provider: providerOf(doc.provider),
    agentSettings:
      doc.agentSettings !== null && typeof doc.agentSettings === 'object'
        ? doc.agentSettings
        : {},
  } as StoredAiConfig;
  for (const provider of FIELD_PREFIXES) {
    const record = doc as unknown as Record<string, unknown>;
    (out as unknown as Record<string, unknown>)[`${provider}EncryptedKey`] =
      String(record[`${provider}EncryptedKey`] ?? '');
    (out as unknown as Record<string, unknown>)[`${provider}KeyHint`] = String(
      record[`${provider}KeyHint`] ?? '',
    );
    (out as unknown as Record<string, unknown>)[`${provider}Model`] = String(
      record[`${provider}Model`] ?? '',
    );
  }
  return out;
}

/**
 * Lazily migrates a legacy botUserGroqKeys doc into the unified
 * botUserAiConfigs shape (openai/gemini promoted out of the blob, blob
 * activeProvider folded into provider) and persists it. No-op when the legacy
 * doc is absent. The legacy collection is kept — reads prefer the new one.
 */
async function migrateLegacyDocIfAny(
  userId: string,
): Promise<StoredAiConfigDoc | null> {
  const db = getMongoDb();
  const legacy = await db
    .collection<StoredAiConfigDoc & { agentSettings?: Record<string, unknown> }>(
      LEGACY_COLLECTION,
    )
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
  if (!legacy) return null;

  const blob =
    legacy.agentSettings !== null && typeof legacy.agentSettings === 'object'
      ? legacy.agentSettings
      : {};
  const record = legacy as unknown as Record<string, unknown>;
  const blobProvider = blob['activeProvider'];
  const provider =
    typeof blobProvider === 'string' &&
    isSupportedAiProvider(blobProvider) &&
    String(blob[`${blobProvider}EncryptedKey`] ?? '').length > 0
      ? blobProvider
      : typeof record['provider'] === 'string' &&
          isSupportedAiProvider(record['provider'] as string)
        ? (record['provider'] as string)
        : 'openrouter';

  const cleanBlob: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(blob)) {
    if (
      k === 'activeProvider' ||
      /^(openai|gemini)(EncryptedKey|KeyHint|Model)$/.test(k)
    ) {
      continue;
    }
    cleanBlob[k] = v;
  }

  const migrated: Record<string, unknown> = {
    openrouterEncryptedKey: String(record['openrouterEncryptedKey'] ?? ''),
    openrouterKeyHint: String(record['openrouterKeyHint'] ?? ''),
    openrouterModel: String(record['openrouterModel'] ?? ''),
    groqEncryptedKey: String(record['encryptedKey'] ?? ''),
    groqKeyHint: String(record['keyHint'] ?? ''),
    groqModel: String(record['groqModel'] ?? ''),
    nvidiaEncryptedKey: String(record['nvidiaEncryptedKey'] ?? ''),
    nvidiaKeyHint: String(record['nvidiaKeyHint'] ?? ''),
    nvidiaModel: String(record['nvidiaModel'] ?? ''),
    openaiEncryptedKey: String(blob['openaiEncryptedKey'] ?? ''),
    openaiKeyHint: String(blob['openaiKeyHint'] ?? ''),
    openaiModel: String(blob['openaiModel'] ?? ''),
    geminiEncryptedKey: String(blob['geminiEncryptedKey'] ?? ''),
    geminiKeyHint: String(blob['geminiKeyHint'] ?? ''),
    geminiModel: String(blob['geminiModel'] ?? ''),
    provider,
    agentSettings: cleanBlob,
  };

  await db.collection(COLLECTION).updateOne(
    { userId },
    {
      $set: { ...migrated, updatedAt: new Date() },
      $setOnInsert: { userId, createdAt: new Date() },
    },
    { upsert: true },
  );
  return migrated as StoredAiConfigDoc;
}

function isSupportedAiProvider(value: string): boolean {
  return (
    value === 'openrouter' ||
    value === 'groq' ||
    value === 'nvidia' ||
    value === 'openai' ||
    value === 'gemini' ||
    value === 'zen'
  );
}

export async function getUserAiConfig(
  userId: string,
): Promise<StoredAiConfig | null> {
  const db = getMongoDb();
  let rec: StoredAiConfigDoc | null = await db
    .collection<StoredAiConfigDoc>(COLLECTION)
    .findOne({ userId }, { projection: { _id: 0 } });
  if (!rec) {
    const migrated = await migrateLegacyDocIfAny(userId);
    if (!migrated) return null;
    rec = migrated;
  }
  return mapStoredConfig(rec);
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
    .collection<{ agentSettings?: Record<string, unknown> }>(COLLECTION)
    .findOne({ userId }, { projection: { _id: 0, agentSettings: 1 } });
  const merged: Record<string, unknown> = {
    ...(rec?.agentSettings ?? {}),
    ...settings,
  };
  await db.collection(COLLECTION).updateOne(
    { userId },
    {
      $set: { agentSettings: merged, updatedAt: new Date() },
      $setOnInsert: { userId, createdAt: new Date() },
    },
    { upsert: true },
  );
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
  const set: Record<string, unknown> = {
    [providerField(provider, 'EncryptedKey')]: encryptedKey,
    [providerField(provider, 'KeyHint')]: keyHint,
    [providerField(provider, 'Model')]: model,
    provider,
    updatedAt: new Date(),
  };
  await db.collection(COLLECTION).updateOne(
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
  const set: Record<string, unknown> = {
    [providerField(provider, 'Model')]: model,
    provider,
    updatedAt: new Date(),
  };
  await db.collection(COLLECTION).updateOne({ userId }, { $set: set });
}

/** Clears the key fields for ONE provider ('' = not configured). */
export async function deleteUserAiKey(
  userId: string,
  provider: AiProvider,
): Promise<void> {
  const db = getMongoDb();
  const set: Record<string, unknown> = {
    [providerField(provider, 'EncryptedKey')]: '',
    [providerField(provider, 'KeyHint')]: '',
    updatedAt: new Date(),
  };
  await db.collection(COLLECTION).updateOne({ userId }, { $set: set });
}