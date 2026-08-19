import { getMongoDb } from '../client.js';

/**
 * Global GitHub Config Store — the single deployment-level GitHub token.
 *
 * All GitHub authentication (bot commands /push, /installer, /update, the
 * admin_commit_push agent tool, and the Admin File Manager Git tab) uses ONE
 * token, set through the dashboard's Git tab. Stored as a single document in
 * the systemSettings collection under the `githubConfig` id, upserted in
 * place. MongoDB is schemaless — no DDL required. The token itself is
 * encrypted (AES-256-GCM, enc:v1:) by the cat-bot layer before it reaches this
 * store — the adapter is encryption-agnostic and simply persists the value.
 */

export interface GitHubConfigStoreValue {
  /** AES-256-GCM encrypted classic GitHub PAT (enc:v1:…). */
  encryptedToken: string;
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
  updatedAt: string;
}

const COLLECTION = 'systemSettings';
const KEY = 'githubConfig';

interface GitHubConfigDoc {
  _id: string;
  value?: GitHubConfigStoreValue;
}

export async function getGitHubConfigStore(): Promise<GitHubConfigStoreValue | null> {
  const db = getMongoDb();
  const rec = await db
    .collection<GitHubConfigDoc>(COLLECTION)
    .findOne({ _id: KEY }, { projection: { _id: 0, value: 1 } });
  const value = rec?.value;
  if (
    !value ||
    typeof value.encryptedToken !== 'string' ||
    value.encryptedToken === '' ||
    typeof value.login !== 'string'
  ) {
    return null;
  }
  return value;
}

export async function saveGitHubConfigStore(value: GitHubConfigStoreValue): Promise<void> {
  const db = getMongoDb();
  await db.collection<GitHubConfigDoc>(COLLECTION).updateOne(
    { _id: KEY },
    {
      $set: { value, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}

export async function clearGitHubConfigStore(): Promise<void> {
  const db = getMongoDb();
  await db.collection<GitHubConfigDoc>(COLLECTION).deleteOne({ _id: KEY });
}