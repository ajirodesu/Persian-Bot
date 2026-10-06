/**
 * Preview Result Store — in-memory lookup for intercepted agent command outputs.
 *
 * When the AI agent runs `test_command`, every platform API side-effect is
 * intercepted against a mock proxy, normalized to JSON-safe form, and stored
 * here under a short composite key. The agent reads the captured payload to
 * understand the full command output BEFORE deciding to deliver it, then calls
 * `send_result` with the key to replay the attachments/buttons against the
 * real platform API with a single synthesized message.
 *
 * Intentionally in-memory — turn results are transient and tied to a single
 * agent lifecycle. TTL 10 minutes, single-use keys deleted on delivery.
 *
 * Portions derived from Cat-Bot (ISC) by John Lester:
 *   https://github.com/johnlester-0369/Cat-Bot
 *   (packages/cat-bot/src/engine/agent/lib/command-result-store.lib.ts)
 * See THIRD_PARTY_NOTICES.md. Adapted to Persian-Bot conventions
 * (native TTLMap, Persian-Bot UnifiedApi method shapes).
 */

import type { Readable } from 'node:stream';
import { TTLMap } from '../lib/ttl-map.lib.js';

/**
 * One intercepted UnifiedApi call, normalized to be fully JSON-serializable.
 *
 * Positional args mirror the Persian-Bot UnifiedApi signatures:
 *   replyMessage → [threadID, options]
 *   sendMessage  → [payload, threadID]
 *   editMessage  → [messageID, options]
 */
export interface InterceptedCall {
  /** UnifiedApi method name (e.g. 'replyMessage', 'sendMessage'). */
  type: string;
  /** Normalized positional args matching the method signature. */
  args: unknown[];
  /** The command that triggered this call. */
  sourceCommand?: string;
}

/**
 * A Buffer/Readable attachment extracted BEFORE normalization replaced it
 * with a sentinel. Stored under `${key}:bin` so `send_result` can replay
 * real file bytes instead of dropping them.
 */
export interface BinaryAttachment {
  name: string;
  stream: Buffer | Readable;
}

export interface UrlAttachment {
  name: string;
  url: string;
}

export const STREAM_SENTINEL =
  '[Stream: binary content — consumed during test, cannot be replayed]';
export const BUFFER_SENTINEL =
  '[Buffer: binary content — consumed during test, cannot be replayed]';

const counters = new Map<string, number>();

const resultStore = new TTLMap<InterceptedCall[]>({
  ttlMs: 10 * 60 * 1000,
  sliding: false,
  cleanupIntervalMs: 2 * 60 * 1000,
});

const attachmentResultStore = new TTLMap<UrlAttachment[]>({
  ttlMs: 10 * 60 * 1000,
  sliding: false,
  cleanupIntervalMs: 2 * 60 * 1000,
});

const buttonResultStore = new TTLMap<unknown[][]>({
  ttlMs: 10 * 60 * 1000,
  sliding: false,
  cleanupIntervalMs: 2 * 60 * 1000,
});

const binaryAttachmentStore = new TTLMap<BinaryAttachment[]>({
  ttlMs: 10 * 60 * 1000,
  sliding: false,
  cleanupIntervalMs: 2 * 60 * 1000,
});

/**
 * Recursively normalizes any value to be fully JSON-serializable.
 * Buffers → BUFFER_SENTINEL, Readable streams (duck-typed via .pipe) →
 * STREAM_SENTINEL, bigints → strings. Zero-dependency leaf.
 */
export function normalizeToJson(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return BUFFER_SENTINEL;
  if (
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>)['pipe'] === 'function'
  ) {
    return STREAM_SENTINEL;
  }
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalizeToJson);
  if (typeof value === 'object') {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = normalizeToJson(v);
    }
    return result;
  }
  return value;
}

export const previewResultStore = {
  /**
   * Generates a unique composite lookup key. Must be called exactly once per
   * `test_command` invocation. Returns `${shortHash}:${n}` — short for the
   * model, unique per session/event/commands within the process lifetime.
   */
  generateKey(
    sessionUserId: string,
    platform: string,
    sessionId: string,
    threadID: string,
    messageID: string,
    commandName: string,
  ): string {
    const prefix = `${sessionUserId}:${platform}:${sessionId}:${threadID}:${messageID}:${commandName}`;
    const n = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, n);

    let hash = 5381;
    for (let i = 0; i < prefix.length; i++) {
      hash = (hash << 5) + hash + prefix.charCodeAt(i);
    }
    return `${(hash >>> 0).toString(36)}:${n}`;
  },

  set(key: string, calls: InterceptedCall[]): void {
    resultStore.set(key, calls);
  },
  get(key: string): InterceptedCall[] | null {
    return resultStore.get(key) ?? null;
  },
  delete(key: string): void {
    resultStore.delete(key);
  },

  setAttachments(key: string, urls: UrlAttachment[]): void {
    attachmentResultStore.set(key, urls);
  },
  getAttachments(key: string): UrlAttachment[] | null {
    return attachmentResultStore.get(key) ?? null;
  },
  deleteAttachments(key: string): void {
    attachmentResultStore.delete(key);
  },

  setButtons(key: string, grids: unknown[][]): void {
    buttonResultStore.set(key, grids);
  },
  getButtons(key: string): unknown[][] | null {
    return buttonResultStore.get(key) ?? null;
  },
  deleteButtons(key: string): void {
    buttonResultStore.delete(key);
  },

  setBinaryAttachments(key: string, attachments: BinaryAttachment[]): void {
    binaryAttachmentStore.set(key, attachments);
  },
  getBinaryAttachments(key: string): BinaryAttachment[] | null {
    return binaryAttachmentStore.get(key) ?? null;
  },
  deleteBinaryAttachments(key: string): void {
    binaryAttachmentStore.delete(key);
  },
};
