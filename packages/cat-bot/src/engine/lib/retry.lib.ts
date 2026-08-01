/**
 * Platform Retry Utility — Exponential Backoff with Jitter
 *
 * delay(attempt) = min(initialDelayMs × backoffFactor^(attempt-1), maxDelayMs) ± 10% jitter.
 * Jitter prevents thundering-herd when multiple sessions restart after a network outage.
 */

import { logger } from '@/engine/modules/logger/logger.lib.js';

export interface RetryOptions {
  /** Default: 5 */
  maxAttempts?: number;
  /** Initial delay in ms. Default: 2000 */
  initialDelayMs?: number;
  /** Backoff multiplier. Default: 2 */
  backoffFactor?: number;
  /** Hard cap on delay. Default: 60000 */
  maxDelayMs?: number;
  onRetry?: (attempt: number, err: unknown) => void;
  /**
   * Return false to abort retrying immediately (e.g. auth errors that more attempts cannot fix).
   * When absent, all errors are retried up to maxAttempts.
   */
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  /** When aborted, the retry loop exits immediately without waiting for the back-off delay. */
  signal?: AbortSignal;
}

// Abort-aware sleep: fires immediately when signal aborts instead of waiting the full delay.
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Retry aborted')); return; }
    const id = setTimeout(() => { signal?.removeEventListener('abort', handler); resolve(); }, ms);
    const handler = () => { clearTimeout(id); reject(new Error('Retry aborted')); };
    signal?.addEventListener('abort', handler, { once: true });
  });
}

/** ±10% random jitter to avoid thundering-herd on simultaneous failures. */
function jitter(ms: number): number {
  return ms * (0.9 + Math.random() * 0.2);
}

const NETWORK_ERROR_CODES = new Set([
  'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND',
  'EAI_AGAIN', 'EPIPE', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH',
]);

/** Returns true for transient network faults — safe to retry with backoff. */
export function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  const code = (e['code'] ?? e['errno']) as string | undefined;
  if (code && NETWORK_ERROR_CODES.has(code)) return true;
  if (e['type'] === 'system' && code && NETWORK_ERROR_CODES.has(code)) return true;
  const resp = e['response'] as Record<string, unknown> | undefined;
  const status = (e['status'] ?? resp?.['status']) as number | undefined;
  if (typeof status === 'number' && (status === 429 || status >= 500)) return true;
  return false;
}

/**
 * Returns true for invalid-credential errors — retrying will NOT help.
 * Covers Discord TokenInvalid and Telegram HTTP 401.
 */
export function isAuthError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as Record<string, unknown>;
  if ((e['code'] as string | undefined) === 'TokenInvalid') return true;
  const resp = e['response'] as Record<string, unknown> | undefined;
  const status = (e['status'] ?? resp?.['status']) as number | undefined;
  if (status === 401 || status === 403) return true;
  const errCode = String(e['error'] ?? '').toLowerCase();
  const reason = String(e['reason'] ?? '').toLowerCase();
  const typeStr = String(e['type'] ?? '').toLowerCase();
  const message = String(e['message'] ?? e['description'] ?? '').toLowerCase();
  return (
    message.includes('not logged in') || message.includes('login blocked') ||
    message.includes('blocked the login') || message.includes('invalid token') ||
    message.includes('tokeninvalid') || message.includes('unauthorized') ||
    message.includes('invalid credentials') || message.includes('login approval') ||
    errCode === 'login_blocked' || reason === 'auth_error' || typeStr === 'account_inactive'
  );
}

/**
 * Calls `fn()` repeatedly until it resolves or `maxAttempts` is exhausted.
 * Uses exponential backoff with jitter between attempts.
 * @throws The last error encountered if all attempts fail.
 */
export async function withRetry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 5;
  const initialDelayMs = options?.initialDelayMs ?? 2000;
  const backoffFactor = options?.backoffFactor ?? 2;
  const maxDelayMs = options?.maxDelayMs ?? 60_000;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options?.signal?.aborted) throw new Error('Retry aborted');
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (options?.shouldRetry && !options.shouldRetry(err, attempt)) throw err;
      if (attempt === maxAttempts) break;
      const baseDelay = Math.min(initialDelayMs * Math.pow(backoffFactor, attempt - 1), maxDelayMs);
      const delay = Math.round(jitter(baseDelay));
      if (options?.onRetry) {
        options.onRetry(attempt, err);
      } else {
        logger.warn(`[retry] Attempt ${attempt}/${maxAttempts} failed — retrying in ${delay}ms`, { error: err });
      }
      await sleep(delay, options?.signal);
    }
  }
  throw lastErr;
}
