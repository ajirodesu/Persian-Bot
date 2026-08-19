import { getMongoDb } from '../client.js';

/**
 * MCP Servers Store — the deployment-level custom MCP server registry.
 *
 * System administrators add custom MCP servers (name + URL + optional auth
 * headers) in the Admin dashboard → MCP Servers page. The AI agent loads these
 * from the database on every turn, connects to each enabled server over MCP
 * Streamable HTTP, and exposes its tools to the LLM.
 *
 * Stored as a single document in the systemSettings collection under the
 * `mcpServers` id, upserted in place. MongoDB is schemaless — no DDL required.
 * Header values are encrypted (AES-256-GCM, enc:v1:) by the cat-bot layer
 * before they reach this store — the adapter is encryption-agnostic.
 */

export interface McpServerRecord {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** AES-256-GCM encrypted JSON of the request headers (enc:v1:…) — may be absent. */
  headersEncrypted?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerStore {
  servers: McpServerRecord[];
}

const COLLECTION = 'systemSettings';
const KEY = 'mcpServers';

interface McpServersDoc {
  _id: string;
  value?: McpServerStore;
}

export async function getMcpServersStore(): Promise<McpServerStore | null> {
  const db = getMongoDb();
  const rec = await db
    .collection<McpServersDoc>(COLLECTION)
    .findOne({ _id: KEY }, { projection: { _id: 0, value: 1 } });
  const value = rec?.value;
  if (!value || !Array.isArray(value.servers)) return null;
  const servers = value.servers.filter(
    (s) =>
      s &&
      typeof s.id === 'string' &&
      s.id !== '' &&
      typeof s.name === 'string' &&
      typeof s.url === 'string',
  );
  return { servers };
}

export async function saveMcpServersStore(value: McpServerStore): Promise<void> {
  const db = getMongoDb();
  await db.collection<McpServersDoc>(COLLECTION).updateOne(
    { _id: KEY },
    {
      $set: { value, updatedAt: new Date() },
      $setOnInsert: { createdAt: new Date() },
    },
    { upsert: true },
  );
}