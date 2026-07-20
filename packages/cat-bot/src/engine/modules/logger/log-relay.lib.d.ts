/**
 * Log Relay — Winston → Socket.IO Bridge
 *
 * A zero-dependency EventEmitter that decouples the Winston logger from the
 * Socket.IO server. The logger emits to this relay; bot-monitor.socket.ts
 * subscribes and forwards to connected clients.
 *
 * Why a relay rather than a direct import of socket.lib?
 *   logger.lib.ts is imported very early (before the HTTP server is created).
 *   A direct socket.lib import would create a circular boot-order dependency.
 *   The relay fires-and-forgets — entries emitted before any Socket.IO subscriber
 *   is attached are silently dropped outside the sliding-window history buffer.
 *
 * Each emitted value is a single pre-formatted ANSI string — identical to what
 * Winston's devFormat prints to the terminal. The web client renders it via
 * ansi-to-react so the dashboard console mirrors the server terminal exactly.
 */
import { EventEmitter } from 'node:events';
declare class LogRelay extends EventEmitter {
    #private;
    /**
     * Enqueues a lazy format closure in the per-session sliding window for `key`.
     * The closure is invoked only when a subscriber is actively watching (live emit) or
     * when `getKeyedHistory` is called (hydration) — chalk rendering never runs for idle sessions.
     * Key format matches session-logger: `${userId}:${platformId}:${sessionId}`.
     */
    emitKeyed(key: string, format: () => string): void;
    /** Lazily formats and returns the per-session sliding window for hydrating a newly subscribed client. */
    getKeyedHistory(key: string): string[];
    /**
     *  subscribe hydration delivers only post-restart logs, not stale pre-restart entries. */
    clearKeyedHistory(key: string): void;
    /**
     * Increments the subscriber count for a session key. Called by bot-monitor.socket.ts
     * when a client joins the bot-log room — enables live emission in emitKeyed.
     */
    addSubscriber(key: string): void;
    /**
     * Decrements the subscriber count. Called on unsubscribe and socket disconnect.
     * Dropping to zero means emitKeyed will skip the EventEmitter dispatch again.
     */
    removeSubscriber(key: string): void;
    /** Returns true when at least one Socket.IO client is subscribed to this session's logs. */
    isConnected(key: string): boolean;
}
/**
 * Singleton log relay. Increase max listeners to accommodate multiple
 * Socket.IO namespace subscribers without triggering Node's memory-leak warning.
 */
export declare const logRelay: LogRelay;
export {};
//# sourceMappingURL=log-relay.lib.d.ts.map