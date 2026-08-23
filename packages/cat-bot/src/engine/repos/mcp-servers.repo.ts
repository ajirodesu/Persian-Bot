/**
 * MCP Servers Repo — LRU-cached, header-encrypted registry of custom MCP servers.
 *
 * System administrators manage custom MCP servers (name + URL + optional auth
 * headers) in the Admin dashboard → MCP Servers page. The AI agent reads this
 * list on every turn, connects to each ENABLED server over MCP Streamable HTTP
 * (see engine/agent/lib/external-mcp.lib.ts), and merges the servers' tools into
 * the agent's LLM-facing tool set.
 *
 * Header values (e.g. Authorization: Bearer …) are encrypted at rest
 * (AES-256-GCM, enc:v1:) via crypto.util.ts — the database layer only ever sees
 * ciphertext. Reads are cached in the shared LRU; writes invalidate the cache so
 * a dashboard save takes effect on the very next turn — no restart, no TTL wait.
 *
 * Storage lives in the 'database' package (getMcpServersStore /
 * saveMcpServersStore), persisted per-adapter (systemSettings doc /
 * system_settings row).
 */
import {
  getMcpServersStore as _getMcpServersStore,
  saveMcpServersStore as _saveMcpServersStore,
} from 'database';
import crypto from 'crypto';
import { encrypt, decrypt } from '@/engine/utils/crypto.util.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

const MCP_SERVERS_CACHE_KEY = 'mcp:servers:list';
const CACHE_TTL_MS = 10_000; // short TTL so admin edits propagate within seconds

/** A decrypted MCP server entry as the engine consumes it. */
export interface McpServerConfig {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  /** Minimum role required to use this server's tools (RoleLevel, default anyone). */
  role: number;
  /** Request headers sent on every MCP call (already decrypted). */
  headers: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

/** Stored-record shape (the database barrel types these exports as `any`). */
interface StoredMcpServerRecord {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  role?: number;
  headersEncrypted?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

/**
 * Payload accepted when adding/updating a server (headers are optional).
 * On update, an empty-string header value means "preserve the stored secret"
 * and a key absent from the map is removed — the dashboard always sends the
 * full desired key set since it never sees the encrypted values.
 */
export interface McpServerInput {
  name: string;
  url: string;
  enabled?: boolean;
  role?: number;
  headers?: Record<string, string>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function encryptHeaders(headers: Record<string, string>): string | undefined {
  const entries = Object.entries(headers).filter(
    ([k, v]) => k.trim() !== '' && typeof v === 'string' && v.trim() !== '',
  );
  if (entries.length === 0) return undefined;
  return encrypt(JSON.stringify(Object.fromEntries(entries)));
}

function decryptHeaders(encrypted: string | undefined): Record<string, string> {
  if (!encrypted) return {};
  try {
    const parsed = JSON.parse(decrypt(encrypted)) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof v === 'string') out[k] = v;
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

/** Reads the full server list, decrypting headers. Never throws — degrades to [] */
export async function listMcpServers(): Promise<McpServerConfig[]> {
  const cached = lruCache.get<McpServerConfig[]>(MCP_SERVERS_CACHE_KEY);
  if (cached !== undefined) return cached;

  let servers: McpServerConfig[] = [];
  try {
    const store = await _getMcpServersStore();
    servers = ((store?.servers ?? []) as StoredMcpServerRecord[]).map(
      (s) => ({
        id: s.id,
        name: s.name,
        url: s.url,
        enabled: s.enabled === true,
        role: typeof s.role === 'number' ? s.role : 0,
        headers: decryptHeaders(s.headersEncrypted),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
      }),
    );
  } catch (err) {
    console.error('[McpServersRepo] Failed to read store', err);
  }
  lruCache.set(MCP_SERVERS_CACHE_KEY, servers, CACHE_TTL_MS);
  return servers;
}

/** Persists the full list and refreshes the cache. */
async function persist(servers: McpServerConfig[]): Promise<void> {
  await _saveMcpServersStore({
    servers: servers.map((s) => ({
      id: s.id,
      name: s.name,
      url: s.url,
      enabled: s.enabled,
      role: s.role,
      headersEncrypted: encryptHeaders(s.headers),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    })),
  });
  lruCache.set(MCP_SERVERS_CACHE_KEY, servers, CACHE_TTL_MS);
}

/** Adds a new server and returns the created entry. */
export async function addMcpServer(
  input: McpServerInput,
): Promise<McpServerConfig> {
  const servers = await listMcpServers();
  const created: McpServerConfig = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    url: input.url.trim(),
    enabled: input.enabled !== false,
    role: input.role ?? 0,
    headers: input.headers ?? {},
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  await persist([...servers, created]);
  return created;
}

/** Updates an existing server by id. Returns null when the id is unknown. */
export async function updateMcpServer(
  id: string,
  patch: Partial<McpServerInput>,
): Promise<McpServerConfig | null> {
  const servers = await listMcpServers();
  const idx = servers.findIndex((s) => s.id === id);
  if (idx === -1) return null;

  const current = servers[idx]!;
  // Resolve the headers patch: "" values preserve the stored secret (the
  // dashboard never sees plaintext values), absent keys are removed, and
  // concrete values replace or add headers.
  let headers = current.headers;
  if (patch.headers !== undefined) {
    headers = {};
    for (const [k, v] of Object.entries(patch.headers)) {
      if (v === '') {
        if (k in current.headers) headers[k] = current.headers[k]!;
      } else {
        headers[k] = v;
      }
    }
  }
  const updated: McpServerConfig = {
    ...current,
    name: patch.name !== undefined ? patch.name.trim() : current.name,
    url: patch.url !== undefined ? patch.url.trim() : current.url,
    enabled: patch.enabled !== undefined ? patch.enabled : current.enabled,
    role: patch.role !== undefined ? patch.role : current.role,
    headers,
    updatedAt: nowIso(),
  };
  const next = [...servers];
  next[idx] = updated;
  await persist(next);
  return updated;
}

/** Removes a server by id. Returns false when the id was unknown. */
export async function removeMcpServer(id: string): Promise<boolean> {
  const servers = await listMcpServers();
  const next = servers.filter((s) => s.id !== id);
  if (next.length === servers.length) return false;
  await persist(next);
  return true;
}

/** Forces the next read to hit the database (called after admin writes). */
export function invalidateMcpServersCache(): void {
  lruCache.del(MCP_SERVERS_CACHE_KEY);
}