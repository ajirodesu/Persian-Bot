/**
 * Log Relay — Winston → Socket.IO Bridge
 *
 * Zero-dependency EventEmitter that decouples the Winston logger from the Socket.IO server.
 * logger.lib.ts emits here; bot-monitor.socket.ts subscribes and forwards to connected clients.
 *
 * Direct socket.lib import would create a circular boot-order dependency (logger is imported
 * before the HTTP server). The relay fires-and-forgets — entries emitted with no subscriber
 * are silently dropped except for the per-session sliding-window history buffer.
 *
 * Each emitted value is a pre-formatted ANSI string matching the server terminal.
 * The web client renders it via ansi-to-react.
 */

import { EventEmitter } from 'node:events';

class LogRelay extends EventEmitter {
  readonly #MAX_HISTORY = 100;
  // Per-session sliding windows keyed by `${userId}:${platformId}:${sessionId}`.
  readonly #keyedHistory = new Map<string, Array<{ format: () => string; cached?: string }>>();
  // Active Socket.IO subscriber count per session. When zero, emitKeyed skips dispatch.
  readonly #subscribers = new Map<string, number>();

  /**
   * Enqueues a lazy format closure in the per-session ring buffer.
   * The closure is invoked only when a subscriber is watching (live emit) or on hydration.
   * Idle sessions accumulate cheap closures instead of pre-rendered ANSI strings.
   */
  emitKeyed(key: string, format: () => string): void {
    const entry: { format: () => string; cached?: string } = { format };
    const hist = this.#keyedHistory.get(key) ?? [];
    hist.push(entry);
    if (hist.length > this.#MAX_HISTORY) hist.shift();
    this.#keyedHistory.set(key, hist);
    if ((this.#subscribers.get(key) ?? 0) > 0) {
      const formatted = format();
      entry.cached = formatted;
      this.emit('log:keyed', { key, entry: formatted });
    }
  }

  /** Lazily formats and returns per-session history for hydrating a newly subscribed client. */
  getKeyedHistory(key: string): string[] {
    return (this.#keyedHistory.get(key) ?? []).map((e) => (e.cached ??= e.format()));
  }

  /** Clears history on restart so new subscribers receive only post-restart logs. */
  clearKeyedHistory(key: string): void {
    this.#keyedHistory.delete(key);
  }

  /** Increments subscriber count; enables live emission in emitKeyed. */
  addSubscriber(key: string): void {
    this.#subscribers.set(key, (this.#subscribers.get(key) ?? 0) + 1);
  }

  /** Decrements subscriber count. When zero, emitKeyed skips EventEmitter dispatch. */
  removeSubscriber(key: string): void {
    const count = this.#subscribers.get(key) ?? 0;
    if (count <= 1) this.#subscribers.delete(key);
    else this.#subscribers.set(key, count - 1);
  }

  /** Returns true when at least one Socket.IO client is subscribed to this session's logs. */
  isConnected(key: string): boolean {
    return (this.#subscribers.get(key) ?? 0) > 0;
  }
}

/** Singleton. Max listeners increased to accommodate multiple Socket.IO namespace subscribers. */
export const logRelay = new LogRelay();
