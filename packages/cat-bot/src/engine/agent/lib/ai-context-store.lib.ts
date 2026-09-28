import { randomUUID } from 'node:crypto';
import { TTLMap } from '@/engine/lib/ttl-map.lib.js';

/**
 * AI Context Store — secure opaque handle binding a remote Needle 3 turn to
 * the authenticated Persian-Bot execution context.
 *
 * Needle 3 must never submit its own execution identity: userId, senderID,
 * platform, sessionId, threadID, messageID, bot identity, permissions, role
 * and database scope always come from the server-side AppCtx. This store
 * mints an opaque id per AI turn that maps 1:1 to those server-side
 * coordinates, so the Needle service session can never be replayed across
 * users, sessions, or threads.
 *
 * Isolation: creation records the full coordinate tuple; validation rejects
 * any use from a non-matching tuple. TTL expiration (fixed, non-sliding)
 * bounds the lifetime of every handle.
 */

const CONTEXT_TTL_MS = 30 * 60 * 1000;

export interface AiContextRecord {
  id: string;
  userId: string;
  platform: string;
  sessionId: string;
  threadId: string;
  senderId: string;
  messageId: string;
  createdAt: number;
  expiresAt: number;
}

export interface AiContextCoordinates {
  userId: string;
  platform: string;
  sessionId: string;
  threadId: string;
  senderId: string;
  messageId: string;
}

const store = new TTLMap<AiContextRecord>({
  ttlMs: CONTEXT_TTL_MS,
  sliding: false,
  cleanupIntervalMs: 60 * 1000,
});

/** Mints a new opaque AI context bound to the given server-side coordinates. */
export function createAiContext(coords: AiContextCoordinates): AiContextRecord {
  const now = Date.now();
  const record: AiContextRecord = {
    id: randomUUID(),
    ...coords,
    createdAt: now,
    expiresAt: now + CONTEXT_TTL_MS,
  };
  store.set(record.id, record);
  return record;
}

/**
 * Returns the record only when it exists, is unexpired, and matches every
 * coordinate of the caller's live context. Any mismatch → undefined
 * (cross-user / cross-session / cross-thread reuse is rejected).
 */
export function validateAiContext(
  id: string,
  coords: AiContextCoordinates,
): AiContextRecord | undefined {
  const record = store.get(id);
  if (!record) return undefined;
  if (
    record.userId !== coords.userId ||
    record.platform !== coords.platform ||
    record.sessionId !== coords.sessionId ||
    record.threadId !== coords.threadId ||
    record.senderId !== coords.senderId ||
    record.messageId !== coords.messageId
  ) {
    return undefined;
  }
  return record;
}

/** Destroys a context handle (called at the end of every AI turn). */
export function destroyAiContext(id: string): void {
  store.delete(id);
}
