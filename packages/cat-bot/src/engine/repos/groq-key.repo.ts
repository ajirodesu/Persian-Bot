import {
  getUserGroqKey as _getUserGroqKey,
  upsertUserGroqKey as _upsertUserGroqKey,
  deleteUserGroqKey as _deleteUserGroqKey,
} from 'database';
import { encrypt, decrypt } from '@/engine/utils/crypto.util.js';

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
  const stored = await _getUserGroqKey(userId);
  if (!stored?.encryptedKey) return null;
  try {
    return decrypt(stored.encryptedKey);
  } catch {
    // Corrupt/tampered ciphertext — treat as "no key" so AI stays disabled
    // rather than leaking or failing with a cryptic error.
    return null;
  }
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
}

export async function removeUserGroqApiKey(userId: string): Promise<void> {
  if (!userId) return;
  await _deleteUserGroqKey(userId);
}
