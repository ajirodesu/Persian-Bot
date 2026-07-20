/**
 * Structured Logging Utility
 *
 * Centralized logging configuration using Winston with environment-aware settings.
 * Provides consistent logging across the application with proper formatting,
 * transports, and correlation ID support.
 *
 * @module utils/logger.util
 */
import winston from 'winston';
import type { TransformableInfo } from 'logform';
/**
 * Extended log information with optional correlation ID.
 */
export interface LogInfo extends TransformableInfo {
    timestamp?: string;
    correlationId?: string;
    [key: string]: unknown;
}
/**
 * Configured Winston logger instance.
 *
 * Features:
 * - Console logging in all environments
 * - File logging in production (if configured)
 * - Environment-specific formats (JSON for prod, colored for dev)
 * - Error stack trace capture
 * - Correlation ID support
 */
declare const logger: winston.Logger;
/**
 * Main logger instance with standard methods.
 *
 * @example
 * ```typescript
 * import { logger } from '@/lib/logger.lib.js';
 *
 * logger.info('Server started', { port: 3000 });
 * logger.error('Database connection failed', { error: err });
 * ```
 */
export { logger };
/**
 * Creates a session-scoped logger bound to userId, platformId, and sessionId.
 * Delegates to the chalk-based SessionLogger — emits directly to logRelay without
 * the Winston transport pipeline, eliminating stream allocation per session.
 */
export declare function createLogger(meta: {
    userId: string;
    platformId: number | string;
    sessionId: string;
}): import("./session-logger.lib.js").SessionLogger;
export type { SessionLogger } from './session-logger.lib.js';
//# sourceMappingURL=logger.lib.d.ts.map