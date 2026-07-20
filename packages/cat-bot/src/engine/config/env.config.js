/**
 * Environment Configuration Module
 *
 * Centralized, type-safe environment variable management with runtime validation.
 * Fails fast on missing required variables - validates on import.
 *
 * @module config/env.config.ts
 */
import 'dotenv/config';
// ============================================================================
// CONSTANTS
// ============================================================================
/**
 * Valid NODE_ENV values as a readonly for validation.
 */
const VALID_NODE_ENVS = [
    'development',
    'production',
    'test',
];
/**
 * Valid log levels for winston.
 */
const VALID_LOG_LEVELS = [
    'error',
    'warn',
    'info',
    'http',
    'verbose',
    'debug',
    'silly',
];
/**
 * Valid database adapter types. Each maps to a packages/database/adapters/ sub-folder.
 */
const VALID_DATABASE_TYPES = [
    'mongodb',
    'neondb',
];
// ============================================================================
// HELPER FUNCTIONS
// ============================================================================
/**
 * Retrieves a required environment variable.
 * @param key - Environment variable key
 * @returns Environment variable value
 * @throws {Error} If the variable is missing or empty
 */
function getRequiredEnv(key) {
    const value = process.env[key];
    if (value === undefined || value === '') {
        throw new Error(`[ENV] Missing required environment variable: ${key}\n` +
            `Please check your .env file or environment configuration`);
    }
    return value;
}
/**
 * Retrieves an optional environment variable.
 * @param key - Environment variable key
 * @returns Environment variable value or undefined
 */
function getOptionalEnv(key) {
    const value = process.env[key];
    return value === '' ? undefined : value;
}
/**
 * Retrieves and validates NODE_ENV environment variable.
 * @returns Validated NodeEnv value
 * @throws {Error} If NODE_ENV is provided but not a valid value
 */
function getNodeEnv() {
    // Default to development if undefined or empty to improve out-of-the-box DX
    const value = process.env.NODE_ENV || 'development';
    if (!VALID_NODE_ENVS.includes(value)) {
        throw new Error(`[ENV] Invalid NODE_ENV value: "${value}"\n` +
            `Valid values are: ${VALID_NODE_ENVS.join(', ')}`);
    }
    return value;
}
/**
 * Validates and retrieves LOG_LEVEL environment variable.
 * @returns Validated log level
 */
function getLogLevel() {
    const value = process.env.LOG_LEVEL ?? 'info';
    if (!VALID_LOG_LEVELS.includes(value)) {
        console.warn(`[ENV] Invalid LOG_LEVEL value: "${value}". Using default: "info".\n` +
            `Valid values are: ${VALID_LOG_LEVELS.join(', ')}`);
        return 'info';
    }
    return value;
}
/**
 * Retrieves and validates DATABASE_TYPE environment variable.
 * Required — fails at startup rather than silently routing all DB calls to the wrong adapter.
 */
function getValidatedDatabaseType() {
    const value = getRequiredEnv('DATABASE_TYPE');
    if (!VALID_DATABASE_TYPES.includes(value)) {
        throw new Error(`[ENV] Invalid DATABASE_TYPE value: "${value}"\n` +
            `Valid values are: ${VALID_DATABASE_TYPES.join(', ')}`);
    }
    return value;
}
// ============================================================================
// CONFIGURATION OBJECT
// ============================================================================
// Cache NODE_ENV to avoid multiple validations
const nodeEnv = getNodeEnv();
/**
 * Validated environment configuration.
 * Access environment variables through this object for type safety.
 *
 * @example
 * ```typescript
 * import { env } from '@/config/env.config.js';
 *
 * console.log(env.NODE_ENV);       // 'development' | 'production' | 'test'
 * console.log(env.PORT);           // '3000'
 *
 * if (env.isDevelopment) {
 *   // Development-only code
 * }
 * ```
 */
export const env = {
    // Core environment
    NODE_ENV: nodeEnv,
    // Default to 3000 so operators can omit PORT entirely in development without failing startup.
    PORT: getOptionalEnv('PORT') ?? '3000',
    // Logging configuration
    LOG_LEVEL: getLogLevel(),
    LOG_FILE_PATH: getOptionalEnv('LOG_FILE_PATH'),
    ERROR_LOG_FILE_PATH: getOptionalEnv('ERROR_LOG_FILE_PATH'),
    // Consumed by telegram/listener.ts — centralised here so dotenv is guaranteed to have run first
    TELEGRAM_WEBHOOK_DOMAIN: getOptionalEnv('TELEGRAM_WEBHOOK_DOMAIN'),
    // Database
    DATABASE_TYPE: getValidatedDatabaseType(),
    // Bot Management API / Web
    BETTER_AUTH_SECRET: getRequiredEnv('BETTER_AUTH_SECRET'),
    BETTER_AUTH_URL: getRequiredEnv('BETTER_AUTH_URL'),
    VITE_URL: getOptionalEnv('VITE_URL'),
    VITE_EMAIL_SERVICES_ENABLE: getOptionalEnv('VITE_EMAIL_SERVICES_ENABLE'),
    // Gmail SMTP — read at startup; absent vars produce undefined without throwing
    GMAIL_USER: getOptionalEnv('GMAIL_USER'),
    GOOGLE_APP_PASSWORD: getOptionalEnv('GOOGLE_APP_PASSWORD'),
    // Security
    ENCRYPTION_KEY: getRequiredEnv('ENCRYPTION_KEY'),
    // OpenRouter API — optional; only needed for AI-powered commands/agent
    OPENROUTER_API_KEY: getOptionalEnv('OPENROUTER_API_KEY'),
    // Command-success reaction emoji — optional override, see command-reaction.constants.ts
    COMMAND_REACT_EMOJI: getOptionalEnv('COMMAND_REACT_EMOJI'),
    // Derived boolean helpers for convenience
    isDevelopment: nodeEnv === 'development',
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
};
//# sourceMappingURL=env.config.js.map