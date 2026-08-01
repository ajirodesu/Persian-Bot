/**
 * Session Manager — Multi-session lifecycle registry.
 * Holds start/stop references for all active platform listener sessions, identified by
 * `${userId}:${platform}:${sessionId}`. Allows independent restart of any specific instance.
 */

import { EventEmitter } from 'node:events';
import { botRepo } from '@/server/repos/bot.repo.js';

export interface SessionLifecycle {
  start: () => Promise<void>;
  /**
   * Tears down the live transport.
   * @param signal - Optional shutdown signal name forwarded to platform cleanup.
   * @param persist - When true (default), writes isRunning=false to DB. Pass false for
   *   process-wide shutdown so sessions auto-resume on next boot.
   */
  stop: (signal?: string, persist?: boolean) => Promise<void>;
}

class SessionManager extends EventEmitter {
  readonly #sessions = new Map<string, SessionLifecycle>();
  readonly #active = new Map<string, number>(); // key → startedAt ms
  readonly #locked = new Map<string, number>(); // key → reentrant lock count
  // Stored as { abort fn, unique token } — token prevents a stale finally block from evicting
  // a fresher markRetrying() entry when startBot() fires a new retry before the old one unwinds.
  readonly #retrying = new Map<string, { abort: () => void; token: symbol }>();

  // ── Lock ──────────────────────────────────────────────────────────────────────

  markLocked(key: string): void {
    const count = this.#locked.get(key) ?? 0;
    this.#locked.set(key, count + 1);
    if (count === 0) this.emit('locked', { key, locked: true });
  }

  markUnlocked(key: string): void {
    const count = this.#locked.get(key) ?? 0;
    if (count <= 1) { this.#locked.delete(key); this.emit('locked', { key, locked: false }); }
    else this.#locked.set(key, count - 1);
  }

  isLocked(key: string): boolean { return this.#locked.has(key); }

  getLockedBySessionId(sessionId: string): boolean {
    for (const key of this.#locked.keys()) { if (key.endsWith(`:${sessionId}`)) return true; }
    return false;
  }

  // ── Retry state ───────────────────────────────────────────────────────────────

  /** Returns a unique token that must be passed to markNotRetrying to prevent stale cleanup. */
  markRetrying(key: string, abort: () => void): symbol {
    const token = Symbol('retry-token');
    this.#retrying.set(key, { abort, token });
    return token;
  }

  /** Clears retry state only when the stored token matches — prevents stale eviction. */
  markNotRetrying(key: string, token: symbol): void {
    if (this.#retrying.get(key)?.token === token) this.#retrying.delete(key);
  }

  isRetrying(key: string): boolean { return this.#retrying.has(key); }

  /**
   * Cancels the active back-off loop. Returns false when not in retry state (no-op safe).
   * Clicking Start during retry immediately aborts the loop to boot with the latest credentials.
   */
  abortRetry(key: string): boolean {
    const entry = this.#retrying.get(key);
    if (!entry) return false;
    entry.abort();
    this.#retrying.delete(key);
    return true;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────────

  register(key: string, lifecycle: SessionLifecycle): void {
    this.#sessions.set(key, lifecycle);
  }

  async restart(key: string): Promise<void> {
    const session = this.#sessions.get(key);
    if (!session) throw new Error(`SessionManager: Session ${key} not found.`);
    await session.stop();
    await session.start();
  }

  async stop(key: string): Promise<void> {
    const session = this.#sessions.get(key);
    if (!session) throw new Error(`SessionManager: Session ${key} not found.`);
    await session.stop();
  }

  async start(key: string): Promise<void> {
    const session = this.#sessions.get(key);
    if (!session) throw new Error(`SessionManager: Session ${key} not found.`);
    await session.start();
  }

  // ── Active state ──────────────────────────────────────────────────────────────

  /** Records session as running and broadcasts status. Called after successful start(). */
  async markActive(key: string): Promise<void> {
    const now = Date.now();
    this.#active.set(key, now);
    this.emit('status', { key, active: true, startedAt: now });
    const [userId, , sessionId] = key.split(':');
    if (userId && sessionId) {
      try { await botRepo.updateIsRunning(userId, sessionId, true); }
      catch (err) { console.error(`[session-manager] Failed to update isRunning=true for ${key}:`, err); }
    }
  }

  /** Removes session from active set, broadcasts change, and writes isRunning=false to DB. */
  async markInactive(key: string): Promise<void> {
    this.#active.delete(key);
    this.emit('status', { key, active: false });
    const [userId, , sessionId] = key.split(':');
    if (userId && sessionId) {
      try { await botRepo.updateIsRunning(userId, sessionId, false); }
      catch (err) { console.error(`[session-manager] Failed to update isRunning=false for ${key}:`, err); }
    }
  }

  /**
   * Same in-memory/dashboard effect as markInactive, WITHOUT writing isRunning=false to DB.
   * Used by process-wide shutdown (stopAll) so sessions auto-resume on next process boot.
   * Also used during retry back-off to keep isRunning=true while the loop is sleeping.
   */
  markInactiveTransient(key: string): void {
    this.#active.delete(key);
    this.emit('status', { key, active: false });
  }

  isActive(key: string): boolean { return this.#active.has(key); }
  getActiveKeys(): string[] { return [...this.#active.keys()]; }

  /** Returns true when any active key ends with the given sessionId UUID segment. */
  getStatusBySessionId(sessionId: string): boolean {
    for (const key of this.#active.keys()) { if (key.endsWith(`:${sessionId}`)) return true; }
    return false;
  }

  getStartTimeBySessionId(sessionId: string): number | null {
    for (const [key, startTime] of this.#active.entries()) {
      if (key.endsWith(`:${sessionId}`)) return startTime;
    }
    return null;
  }

  getStartTime(key: string): number | null { return this.#active.get(key) ?? null; }
  getUptime(key: string): number | null {
    const start = this.#active.get(key);
    return start !== undefined ? Date.now() - start : null;
  }

  async unregister(key: string): Promise<void> {
    this.#sessions.delete(key);
    if (this.#active.has(key)) await this.markInactive(key);
  }

  // ── Bulk operations ───────────────────────────────────────────────────────────

  async stopAllByUserId(userId: string, signal?: string): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [key, session] of this.#sessions.entries()) {
      if (key.startsWith(`${userId}:`)) {
        promises.push(session.stop(signal).catch((err) =>
          console.error(`[session-manager] Failed to stop ${key} on user ban:`, err)));
      }
    }
    await Promise.all(promises);
  }

  async unregisterAllByUserId(userId: string): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const key of [...this.#sessions.keys()]) {
      if (key.startsWith(`${userId}:`)) {
        this.#sessions.delete(key);
        if (this.#active.has(key)) promises.push(this.markInactive(key));
      }
    }
    await Promise.all(promises);
  }

  async stopAllExcludingUserId(excludeUserId: string, signal?: string): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const [key, session] of this.#sessions.entries()) {
      if (!key.startsWith(`${excludeUserId}:`)) {
        promises.push(session.stop(signal).catch((err) =>
          console.error(`[session-manager] Failed to stop ${key} during database reset:`, err)));
      }
    }
    await Promise.all(promises);
  }

  async unregisterAllExcludingUserId(excludeUserId: string): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const key of [...this.#sessions.keys()]) {
      if (!key.startsWith(`${excludeUserId}:`)) {
        this.#sessions.delete(key);
        if (this.#active.has(key)) promises.push(this.markInactive(key));
      }
    }
    await Promise.all(promises);
  }

  /**
   * Stops all active sessions for graceful process shutdown.
   * Passes persist=false so isRunning=true stays in DB — sessions auto-resume on next boot.
   */
  async stopAll(signal?: string): Promise<void> {
    const promises = [];
    for (const [key, session] of this.#sessions.entries()) {
      promises.push(session.stop(signal, false).catch((err) =>
        console.error(`[session-manager] Failed to stop session ${key}:`, err)));
    }
    await Promise.all(promises);
  }

  /**
   * Resolves when the session lock is released, or rejects after timeoutMs.
   * Uses EventEmitter 'locked' events — zero polling overhead.
   * Resolves immediately when already unlocked.
   */
  waitForUnlock(key: string, timeoutMs = 15_000): Promise<void> {
    if (!this.isLocked(key)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => {
        settled = true;
        clearTimeout(timer);
        this.off('locked', handler);
      };
      const handler = (event: { key: string; locked: boolean }): void => {
        if (event.key !== key || event.locked || settled) return;
        cleanup();
        resolve();
      };
      const timer = setTimeout(() => {
        if (settled) return;
        cleanup();
        reject(new Error(`[session-manager] waitForUnlock timed out after ${timeoutMs}ms for key "${key}"`));
      }, timeoutMs);
      this.on('locked', handler);
    });
  }
}

export const sessionManager = new SessionManager();
