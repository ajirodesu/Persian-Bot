/**
 * Structured Logging — Winston with environment-aware configuration.
 * Dev: colored human-readable output. Prod: structured JSON.
 */

import winston from 'winston';
import { env } from '@/engine/config/env.config.js';
import type { TransformableInfo } from 'logform';
import { createSessionLogger } from './session-logger.lib.js';

export interface LogInfo extends TransformableInfo {
  timestamp?: string;
  correlationId?: string;
  [key: string]: unknown;
}

const devFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  winston.format.printf((info: LogInfo) => {
    const { timestamp, level, message, correlationId, ...meta } = info;
    const metaStr = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta)}` : '';
    const correlationStr = correlationId ? ` [${correlationId}]` : '';
    return `${timestamp}${correlationStr} ${level}: ${message}${metaStr}`;
  }),
);

const prodFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  winston.format.json(),
);

const consoleTransport = new winston.transports.Console({
  level: env.isProduction ? 'info' : env.LOG_LEVEL,
  format: env.isProduction ? prodFormat : devFormat,
  stderrLevels: ['error', 'crit', 'alert', 'emerg'],
});

const createFileTransports = () => {
  const transports = [];
  if (env.LOG_FILE_PATH) {
    transports.push(new winston.transports.File({
      filename: env.LOG_FILE_PATH,
      level: env.LOG_LEVEL,
      format: prodFormat,
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 7,
    }));
  }
  if (env.ERROR_LOG_FILE_PATH) {
    transports.push(new winston.transports.File({
      filename: env.ERROR_LOG_FILE_PATH,
      level: 'error',
      format: prodFormat,
      maxsize: 10 * 1024 * 1024,
      maxFiles: 30,
    }));
  }
  return transports;
};

const logger = winston.createLogger({
  level: env.LOG_LEVEL,
  transports: [consoleTransport, ...(env.isProduction ? createFileTransports() : [])],
  exitOnError: env.isDevelopment,
  silent: env.isTest,
});

export { logger };

/** Creates a session-scoped logger bound to userId, platformId, and sessionId. */
export function createLogger(meta: { userId: string; platformId: number | string; sessionId: string }) {
  return createSessionLogger(meta);
}

export type { SessionLogger } from './session-logger.lib.js';
