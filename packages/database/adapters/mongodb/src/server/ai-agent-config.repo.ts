import { getMongoDb } from '../client.js';

/**
 * AI Agent Config Store — deployment-level Cactus Needle 3 connection settings.
 *
 * Single document in the systemSettings collection under the `aiAgentConfig`
 * id, upserted in place. MongoDB is schemaless — no DDL required. The Needle
 * auth token is encrypted (AES-256-GCM, enc:v1:) by the cat-bot layer before
 * it reaches this store — the adapter is encryption-agnostic.
 */

export interface AiAgentConfigStoreValue {
  enabled: boolean;
  /** Needle 3 service base URL (e.g. https://…onrender.com). Empty = unconfigured. */
  needleUrl: string;
  /** AES-256-GCM encrypted Needle Bearer token (enc:v1:…). Empty = none set. */
  encryptedToken: string;
  timeoutMs: number;
  /** Per-request inference budget forwarded as max_new_tokens (1-512). */
  maxNewTokens: number;
  /** Minimum Needle confidence required before executing a tool call (0-1). */
  confidenceThreshold: number;
  updatedAt: string;
}

const COLLECTION = 'systemSettings';
const KEY = 'aiAgentConfig';

interface AiAgentConfigDoc {
  _id: string;
  value?: AiAgentConfigStoreValue;
  updatedAt?: Date;
  createdAt?: Date;
}

function parseValue(raw: unknown): AiAgentConfigStoreValue | null {
  if (!raw || typeof raw !== 'object') return null;
  const v = raw as Partial<AiAgentConfigStoreValue>;
  if (typeof v.enabled !== 'boolean') return null;
  return {
    enabled: v.enabled,
    needleUrl: typeof v.needleUrl === 'string' ? v.needleUrl : '',
    encryptedToken: typeof v.encryptedToken === 'string' ? v.encryptedToken : '',
    timeoutMs:
      typeof v.timeoutMs === 'number' && Number.isFinite(v.timeoutMs)
        ? v.timeoutMs
        : 30000,
    maxNewTokens:
      typeof v.maxNewTokens === 'number' && Number.isFinite(v.maxNewTokens)
        ? Math.min(512, Math.max(1, Math.round(v.maxNewTokens)))
        : 256,
    confidenceThreshold:
      typeof v.confidenceThreshold === 'number' &&
      Number.isFinite(v.confidenceThreshold)
        ? v.confidenceThreshold
        : 0.7,
    updatedAt: typeof v.updatedAt === 'string' ? v.updatedAt : '',
  };
}

export async function getAiAgentConfigStore(): Promise<AiAgentConfigStoreValue | null> {
  const db = getMongoDb();
  const rec = await db
    .collection<AiAgentConfigDoc>(COLLECTION)
    .findOne({ _id: KEY }, { projection: { _id: 0, value: 1 } });
  return parseValue(rec?.value);
}

export async function saveAiAgentConfigStore(
  value: AiAgentConfigStoreValue,
): Promise<void> {
  const db = getMongoDb();
  await db.collection<AiAgentConfigDoc>(COLLECTION).updateOne(
    { _id: KEY },
    {
      $set: { value, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}

export async function clearAiAgentConfigStore(): Promise<void> {
  const db = getMongoDb();
  await db.collection<AiAgentConfigDoc>(COLLECTION).deleteOne({ _id: KEY });
}
