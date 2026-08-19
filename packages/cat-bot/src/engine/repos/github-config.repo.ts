/**
 * Global GitHub Config Repo — LRU-cached, encrypted single GitHub token.
 *
 * Holds the ONE deployment-level GitHub token that all GitHub authentication
 * shares: the bot commands (/push, /installer, /update), the admin_commit_push
 * agent tool, and the Admin File Manager Git tab all read their token + identity
 * from here instead of a per-request header or an environment variable. Set
 * through the dashboard's Git tab (Admin → Files → Git → GitHub identity).
 *
 * The token is encrypted at rest (AES-256-GCM, enc:v1:) via crypto.util.ts —
 * the database layer only ever sees ciphertext. Reads are cached in the shared
 * LRU; writes and clears write straight through to the cache so a dashboard
 * connect/disconnect takes effect on the very next command — no restart, no
 * waiting out the TTL.
 *
 * Storage lives in the 'database' package (getGitHubConfigStore /
 * saveGitHubConfigStore / clearGitHubConfigStore), persisted per-adapter
 * (systemSettings doc / system_settings row).
 */
import {
  getGitHubConfigStore as _getGitHubConfigStore,
  saveGitHubConfigStore as _saveGitHubConfigStore,
  clearGitHubConfigStore as _clearGitHubConfigStore,
} from 'database';
import { encrypt, decrypt } from '@/engine/utils/crypto.util.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

const GITHUB_CONFIG_CACHE_KEY = 'github:config:stored';

/** The GitHub account behind the stored token (mirrors GitHubUserIdentity). */
export interface StoredGitHubIdentity {
  login: string;
  name: string | null;
  email: string | null;
  avatarUrl: string | null;
}

/** Decrypted global GitHub config, including the usable token. */
export interface StoredGitHubConfig extends StoredGitHubIdentity {
  token: string;
  updatedAt: string;
}

/** Reads the stored config, decrypting the token. Null when unconfigured. */
export async function getStoredGitHubConfig(): Promise<StoredGitHubConfig | null> {
  const cached = lruCache.get<StoredGitHubConfig>(GITHUB_CONFIG_CACHE_KEY);
  if (cached !== undefined) return cached;
  const store = await _getGitHubConfigStore();
  if (!store) return null;
  const config: StoredGitHubConfig = {
    token: decrypt(store.encryptedToken),
    login: store.login,
    name: store.name,
    email: store.email,
    avatarUrl: store.avatarUrl,
    updatedAt: store.updatedAt,
  };
  lruCache.set(GITHUB_CONFIG_CACHE_KEY, config);
  return config;
}

/** The stored GitHub identity only (no token) — used to author commits. */
export async function getStoredGitHubIdentity(): Promise<StoredGitHubIdentity | null> {
  const config = await getStoredGitHubConfig();
  if (!config) return null;
  return {
    login: config.login,
    name: config.name,
    email: config.email,
    avatarUrl: config.avatarUrl,
  };
}

/**
 * Persists a newly verified GitHub token + identity. `token` must already be a
 * verified classic PAT (the caller checks it against GitHub GET /user).
 */
export async function setStoredGitHubConfig(
  token: string,
  identity: StoredGitHubIdentity,
): Promise<StoredGitHubConfig> {
  const config: StoredGitHubConfig = {
    token,
    login: identity.login,
    name: identity.name,
    email: identity.email,
    avatarUrl: identity.avatarUrl,
    updatedAt: new Date().toISOString(),
  };
  await _saveGitHubConfigStore({
    encryptedToken: encrypt(token),
    login: identity.login,
    name: identity.name,
    email: identity.email,
    avatarUrl: identity.avatarUrl,
    updatedAt: config.updatedAt,
  });
  lruCache.set(GITHUB_CONFIG_CACHE_KEY, config);
  return config;
}

/** Removes the stored config entirely (dashboard Disconnect). */
export async function clearStoredGitHubConfig(): Promise<void> {
  await _clearGitHubConfigStore();
  lruCache.del(GITHUB_CONFIG_CACHE_KEY);
}