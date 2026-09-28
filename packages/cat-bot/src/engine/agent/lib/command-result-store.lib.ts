import { TTLMap } from '@/engine/lib/ttl-map.lib.js';
import type { Readable } from 'node:stream';

/**
 * Command Result Store — TTL-backed storage for intercepted command output.
 *
 * Ports Cat-Bot's `command-result-store.lib.ts` architecture to Persian-Bot.
 * `test_command` captures every platform side-effect behind a mock API proxy
 * and stores the normalized calls here under an opaque composite key; the
 * model only ever sees that key (plus an LLM-readable summary), and
 * `send_result` redeems the key exactly once for final delivery.
 *
 * Stores (all fixed-TTL, non-sliding — payloads are single-consumption):
 *   results       — InterceptedCall[] per base key
 *   attachments   — URL attachments per `${key}:a`
 *   buttons       — button grids per `${key}:b`
 *   binaries      — Buffer/Readable attachments per `${key}:bin`
 *
 * Normalization rules (never serialize internal SDK objects):
 *   Buffer          → BUFFER_SENTINEL (raw bytes preserved separately)
 *   Readable stream → STREAM_SENTINEL  (raw stream preserved separately)
 *   bigint          → decimal string
 *   everything else → JSON-safe passthrough (arrays/objects/primitives)
 */

export const BUFFER_SENTINEL = '[BINARY_BUFFER]';
export const STREAM_SENTINEL = '[BINARY_STREAM]';

const RESULT_TTL_MS = 10 * 60 * 1000;

export interface InterceptedCall {
  type: string;
  args: unknown[];
  sourceCommand?: string;
}

export interface BinaryAttachment {
  name: string;
  stream: Buffer | Readable;
}

function isReadable(value: unknown): value is Readable {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>)['pipe'] === 'function'
  );
}

/** Converts arbitrary values to JSON-safe form without leaking SDK internals. */
export function normalizeToJson(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (Buffer.isBuffer(value)) return BUFFER_SENTINEL;
  if (isReadable(value)) return STREAM_SENTINEL;
  if (Array.isArray(value)) return value.map(normalizeToJson);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalizeToJson(v);
    }
    return out;
  }
  return value;
}

/** DJB2 hash — short deterministic fingerprint for key generation. */
function djb2(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) >>> 0;
  }
  return hash.toString(36);
}

interface CommandResultStore {
  generateKey(
    sessionUserId: string,
    platform: string,
    sessionId: string,
    threadID: string,
    messageID: string,
    commandNames: string,
  ): string;
  set(key: string, calls: InterceptedCall[]): void;
  get(key: string): InterceptedCall[] | undefined;
  delete(key: string): void;
  setAttachments(
    key: string,
    attachments: Array<{ name: string; url: string }>,
  ): void;
  getAttachments(key: string): Array<{ name: string; url: string }> | undefined;
  deleteAttachments(key: string): void;
  setButtons(key: string, grids: Array<unknown>): void;
  getButtons(key: string): Array<unknown> | undefined;
  deleteButtons(key: string): void;
  setBinaryAttachments(key: string, binaries: BinaryAttachment[]): void;
  getBinaryAttachments(key: string): BinaryAttachment[] | undefined;
  deleteBinaryAttachments(key: string): void;
}

function createStore(): CommandResultStore {
  let sequence = 0;  const results = new TTLMap<InterceptedCall[]>({
    ttlMs: RESULT_TTL_MS,
    sliding: false,
    cleanupIntervalMs: 60 * 1000,
  });
  const attachments = new TTLMap<Array<{ name: string; url: string }>>({
    ttlMs: RESULT_TTL_MS,
    sliding: false,
    cleanupIntervalMs: 60 * 1000,
  });
  const buttons = new TTLMap<Array<unknown>>({
    ttlMs: RESULT_TTL_MS,
    sliding: false,
    cleanupIntervalMs: 60 * 1000,
  });
  const binaries = new TTLMap<BinaryAttachment[]>({
    ttlMs: RESULT_TTL_MS,
    sliding: false,
    cleanupIntervalMs: 60 * 1000,
  });

  return {
    generateKey(
      sessionUserId,
      platform,
      sessionId,
      threadID,
      messageID,
      commandNames,
    ): string {
      sequence += 1;
      const n = results.size + sequence;
      const shortHash = djb2(
        `${sessionUserId}:${platform}:${sessionId}:${threadID}:${messageID}:${commandNames}:${Date.now()}:${n}`,
      );
      return `${shortHash}:${n}`;
    },
    set: (key, calls) => results.set(key, calls),
    get: (key) => results.get(key),
    delete: (key) => results.delete(key),
    setAttachments: (key, v) => attachments.set(key, v),
    getAttachments: (key) => attachments.get(key),
    deleteAttachments: (key) => attachments.delete(key),
    setButtons: (key, v) => buttons.set(key, v),
    getButtons: (key) => buttons.get(key),
    deleteButtons: (key) => buttons.delete(key),
    setBinaryAttachments: (key, v) => binaries.set(key, v),
    getBinaryAttachments: (key) => binaries.get(key),
    deleteBinaryAttachments: (key) => binaries.delete(key),
  };
}

/** Singleton shared by test_command (write) and send_result (single-use read). */
export const commandResultStore = createStore();
