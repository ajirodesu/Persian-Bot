/**
 * Session Logger — Chalk-based Per-Session Log Emitter
 *
 * Lightweight replacement for Winston child loggers in platform adapter contexts.
 * Formats ANSI strings directly with chalk (matching Winston devFormat byte-for-byte)
 * and emits them straight to logRelay — bypassing the Winston transport pipeline entirely.
 *
 * WHY chalk over Winston child loggers:
 *   winston.createLogger() allocates a full Transport + Writable stream per session.
 *   With N concurrent sessions across M platforms, that's N transports all competing
 *   on the same logRelay EventEmitter and flushing through async stream.write().
 *   A direct logRelay.emit() with chalk formatting eliminates stream allocation and
 *   the async flush overhead on every log call.
 *
 * Output format matches Winston devFormat exactly:
 *   YYYY-MM-DD HH:mm:ss <level>: <message> [meta JSON]
 *   ──────────────────── entire line colorised by level ─────────────────────
 *
 * Consumers bind a specific userId, platformId, and sessionId at construction time.
 * These identifiers are automatically merged into every log entry's meta suffix
 * so the web dashboard and log aggregators can filter by session without parsing
 * message strings — identical to Winston's `defaultMeta` behaviour.
 */
export interface SessionLoggerMeta {
    userId: string;
    platformId: number | string;
    sessionId: string;
}
export declare class SessionLogger {
    #private;
    constructor(meta: SessionLoggerMeta);
    info(message: string, meta?: Record<string, unknown>): void;
    warn(message: string, meta?: Record<string, unknown>): void;
    error(message: string, meta?: Record<string, unknown>): void;
    verbose(message: string, meta?: Record<string, unknown>): void;
    debug(message: string, meta?: Record<string, unknown>): void;
}
/**
 * Creates a session-scoped chalk logger bound to the given userId, platformId,
 * and sessionId. Every log call merges these identifiers into the meta suffix
 * so the web dashboard can filter entries by session without parsing message strings.
 *
 * @example
 * ```typescript
 * const log = createSessionLogger({ userId: '1', platformId: 1, sessionId: 'abc' });
 * log.info('Connected');
 * // → '2026-04-03 23:57:12 info: Connected {"userId":"1","platformId":1,"sessionId":"abc"}'
 * log.warn('Rate limited', { retryAfter: 5 });
 * // → '2026-04-03 23:57:12 warn: Rate limited {"userId":"1","platformId":1,"sessionId":"abc","retryAfter":5}'
 * ```
 */
export declare function createSessionLogger(meta: SessionLoggerMeta): SessionLogger;
//# sourceMappingURL=session-logger.lib.d.ts.map