/**
 * AI Agent — Command Result Store
 *
 * Holds the output captured by test_command's mock API proxy so send_result can
 * merge results from one or more runs into a single platform reply.
 *
 * Storage layout per test_command run:
 *   - base key          → the normalized InterceptedCall[] list (LLM-readable
 *                         `calls` are derived from these, not stored twice)
 *   - `${key}:a`        → URL-based attachments (survive normalizeToJson)
 *   - `${key}:b`        → button grids (JSON-safe plain objects)
 *   - `${key}:bin`      → raw Buffer/Readable attachments, extracted BEFORE
 *                         normalizeToJson replaces them with sentinels
 *
 * All entries are single-use: send_result deletes each key it consumes so a
 * stale key can never deliver duplicate content on a later turn.
 */

import type { Readable } from 'node:stream';

// ── Sentinels ─────────────────────────────────────────────────────────────────
// normalizeToJson replaces non-serializable payload fields with these markers so
// captured calls stay JSON-safe. The raw references are unrecoverable afterwards.

const STREAM_SENTINEL = '__STREAM__';
const BUFFER_SENTINEL = '__BUFFER__';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single API call captured by the mock proxy (positional args array). */
export interface InterceptedCall {
  type: string;
  args: unknown[];
  sourceCommand?: string;
}

/** A Buffer/Readable attachment extracted before normalizeToJson runs. */
export interface BinaryAttachment {
  name: string;
  stream: Buffer | Readable;
}

// ── Normalization ─────────────────────────────────────────────────────────────

function isReadable(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>)['pipe'] === 'function'
  );
}

/**
 * Recursively converts a captured API arg into a JSON-safe value. Readable
 * streams become STREAM_SENTINEL and Buffers become BUFFER_SENTINEL — both are
 * single-use in-memory resources that cannot survive storage. Everything else
 * (strings, numbers, plain objects, arrays, URLs) passes through untouched.
 */
export function normalizeToJson(value: unknown): unknown {
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

// ── Store ─────────────────────────────────────────────────────────────────────

class CommandResultStore {
  readonly #store = new Map<string, unknown>();
  #counter = 0;

  /**
   * Builds a unique lookup key for a test_command run. The counter guarantees
   * uniqueness even when the same session/thread/command combination is tested
   * multiple times within one agent turn.
   */
  generateKey(
    sessionUserId: string,
    platform: string,
    sessionId: string,
    threadID: string,
    eventMessageID: string,
    commandNames: string,
  ): string {
    this.#counter += 1;
    return [
      sessionUserId,
      platform,
      sessionId,
      threadID,
      eventMessageID,
      commandNames,
      `${Date.now()}-${this.#counter}`,
    ].join('::');
  }

  set(key: string, calls: InterceptedCall[]): void {
    this.#store.set(key, calls);
  }

  get(key: string): InterceptedCall[] | null {
    const v = this.#store.get(key);
    return Array.isArray(v) ? (v as InterceptedCall[]) : null;
  }

  setAttachments(key: string, attachments: Array<{ name: string; url: string }>): void {
    this.#store.set(key, attachments);
  }

  getAttachments(key: string): Array<{ name: string; url: string }> | null {
    const v = this.#store.get(key);
    return Array.isArray(v) ? (v as Array<{ name: string; url: string }>) : null;
  }

  deleteAttachments(key: string): void {
    this.#store.delete(key);
  }

  setBinaryAttachments(key: string, attachments: BinaryAttachment[]): void {
    this.#store.set(key, attachments);
  }

  getBinaryAttachments(key: string): BinaryAttachment[] | null {
    const v = this.#store.get(key);
    return Array.isArray(v) ? (v as BinaryAttachment[]) : null;
  }

  deleteBinaryAttachments(key: string): void {
    this.#store.delete(key);
  }

  setButtons(key: string, grids: Array<Array<Array<Record<string, unknown>>>>): void {
    this.#store.set(key, grids);
  }

  getButtons(key: string): Array<Array<Array<Record<string, unknown>>>> | null {
    const v = this.#store.get(key);
    return Array.isArray(v)
      ? (v as Array<Array<Array<Record<string, unknown>>>>)
      : null;
  }
}

/** Singleton shared across all agent tool invocations. */
export const commandResultStore = new CommandResultStore();
