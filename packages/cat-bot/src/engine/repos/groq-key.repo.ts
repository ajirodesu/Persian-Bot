import {
  getUserGroqKey as _getUserGroqKey,
  upsertUserGroqKey as _upsertUserGroqKey,
  deleteUserGroqKey as _deleteUserGroqKey,
} from 'database';
import { encrypt, decrypt } from '@/engine/utils/crypto.util.js';
import { lruCache } from '@/engine/lib/lru-cache.lib.js';

// The per-user key is resolved on EVERY AI invocation (runAgent + ai.ts's key gate)
// — caching it eliminates a DB round-trip from the pre-agent hot path. Keys change
// rarely and save/remove invalidate explicitly, so the 15-min TTL is only a fallback.
const userKeyCacheKey = (userId: string): string => `groq:key:${userId}`;

// Groq API keys always begin with "gsk_" followed by a base64url token that is
// typically ~48 characters long. Reject anything else before it ever touches
// the database or the Groq SDK.
const GROQ_KEY_PATTERN = /^gsk_[A-Za-z0-9_-]{20,}$/;

/** Structural validation only — never sends a request to verify the key. */
export function isValidGroqApiKey(apiKey: string): boolean {
  return GROQ_KEY_PATTERN.test(apiKey.trim());
}

/** Last 4 characters — the only part of the key ever surfaced for display. */
export function getGroqKeyHint(apiKey: string): string {
  return apiKey.trim().slice(-4);
}

/**
 * Returns the user's decrypted Groq API key, or null when unset or undecryptable.
 * The key is scoped to a single user's account — callers must resolve the account
 * id from the bot session (`ctx.native.userId`) and never pass another user's id.
 */
export async function getUserGroqApiKey(userId: string): Promise<string | null> {
  if (!userId) return null;
  const cached = lruCache.get<string | null>(userKeyCacheKey(userId));
  if (cached !== undefined) return cached;
  const stored = await _getUserGroqKey(userId);
  let result: string | null = null;
  if (stored?.encryptedKey) {
    try {
      result = decrypt(stored.encryptedKey);
    } catch {
      // Corrupt/tampered ciphertext — treat as "no key" so AI stays disabled
      // rather than leaking or failing with a cryptic error.
      result = null;
    }
  }
  lruCache.set(userKeyCacheKey(userId), result);
  return result;
}

/** Dashboard status payload — reports presence + hint, never the key itself. */
export async function getUserGroqKeyStatus(
  userId: string,
): Promise<{ hasKey: boolean; keyHint: string | null }> {
  if (!userId) return { hasKey: false, keyHint: null };
  const stored = await _getUserGroqKey(userId);
  return {
    hasKey: stored !== null && stored.encryptedKey.length > 0,
    keyHint: stored?.keyHint ?? null,
  };
}

/** Validates, encrypts (AES-256-GCM at rest), and stores the user's key. */
export async function saveUserGroqApiKey(
  userId: string,
  apiKey: string,
): Promise<void> {
  if (!userId) throw new Error('Not authenticated');
  const key = apiKey.trim();
  if (!isValidGroqApiKey(key)) {
    throw new Error(
      'Invalid Groq API key. Keys start with "gsk_" and are at least 20 characters long.',
    );
  }
  await _upsertUserGroqKey(userId, encrypt(key), getGroqKeyHint(key));
  // Invalidate the cached key so the next AI invocation sees the new value immediately.
  lruCache.del(userKeyCacheKey(userId));
}

export async function removeUserGroqApiKey(userId: string): Promise<void> {
  if (!userId) return;
  await _deleteUserGroqKey(userId);
  // Invalidate the cached key so a subsequent AI invocation falls back to the
  // env key (or the "no key" notice) instead of serving the removed value.
  lruCache.del(userKeyCacheKey(userId));
}
