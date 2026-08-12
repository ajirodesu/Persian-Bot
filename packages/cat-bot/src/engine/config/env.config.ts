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
// TYPE DEFINITIONS
// ============================================================================

/**
 * Valid Node environment values.
 * Strictly typed to prevent runtime errors from invalid environment strings.
 */
export type NodeEnv = 'development' | 'production' | 'test';

export type DatabaseType = 'mongodb' | 'neondb' | 'turso';

/**
 * Environment configuration type definition.
 * IMPORTANT: With exactOptionalPropertyTypes: true, optional properties
 * must explicitly include undefined in their type.
 */
interface EnvConfig {
  // Core application settings
  readonly NODE_ENV: NodeEnv;
  readonly PORT: string;

  // Logging configuration
  readonly LOG_LEVEL: string;
  readonly LOG_FILE_PATH?: string | undefined;
  readonly ERROR_LOG_FILE_PATH?: string | undefined;
  // Telegram transport — bare HTTPS domain routes webhook mode; absent = long-polling fallback
  readonly TELEGRAM_WEBHOOK_DOMAIN?: string | undefined;

  // Database
  readonly DATABASE_TYPE: DatabaseType;

  // Bot Management API / Web
  readonly BETTER_AUTH_SECRET: string;
  readonly BETTER_AUTH_URL?: string | undefined;
  readonly VITE_URL?: string | undefined;
  readonly VITE_EMAIL_SERVICES_ENABLE?: string | undefined;

  // Brevo transactional email — optional; when absent mailer.lib.ts skips email delivery and logs a warning.
  // Both vars must be set together: BREVO_SENDER_EMAIL is the verified Brevo sender address,
  // BREVO_API_KEY is the API key generated at app.brevo.com → API Keys.
  readonly BREVO_SENDER_EMAIL?: string | undefined;
  readonly BREVO_API_KEY?: string | undefined;

  // GitHub — optional; powers the Admin dashboard's File Manager (a GitHub-native
  // repository browser/editor). When GITHUB_TOKEN is absent the file manager is
  // disabled and the panel shows a "GitHub not configured" setup hint.
  readonly GITHUB_TOKEN?: string | undefined;
  readonly GITHUB_REPO_OWNER?: string | undefined;
  readonly GITHUB_REPO_NAME?: string | undefined;
  // Sub-path inside the repo where packages/cat-bot source lives (defaults to packages/cat-bot).
  readonly GITHUB_REPO_BASE_PATH?: string | undefined;
  // Local repo — the File Manager edits a real checkout and tracks changes with
  // real git (status/stage/commit/push). Defaults to auto-detecting the git
  // checkout that contains this process; override to point at another clone.
  readonly ADMIN_REPO_PATH?: string | undefined;

  // AI agent browser tool (puppeteer-core) — optional. Path to a specific
  // Chrome/Chromium executable. When absent the tool auto-detects a system
  // browser (Windows/macOS/Linux) and only errors if none can be found.
  readonly PUPPETEER_EXEC_PATH?: string | undefined;
  // Controls browser visibility: "true" (default) runs headless, any other value
  // (e.g. "false") opens a visible window — useful when debugging the agent.
  readonly AGENT_BROWSER_HEADLESS?: string | undefined;

  // Security
  readonly ENCRYPTION_KEY: string;
  // Derived boolean helpers
  readonly isDevelopment: boolean;
  readonly isProduction: boolean;
  readonly isTest: boolean;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/**
 * Valid NODE_ENV values as a readonly for validation.
 */
const VALID_NODE_ENVS: readonly NodeEnv[] = [
  'development',
  'production',
  'test',
] as const;

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
] as const;

/**
 * Valid database adapter types. Each maps to a packages/database/adapters/ sub-folder.
 */
const VALID_DATABASE_TYPES = [
  'mongodb',
  'neondb',
  'turso',
] as const;

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Retrieves a required environment variable.
 * @param key - Environment variable key
 * @returns Environment variable value
 * @throws {Error} If the variable is missing or empty
 */
function getRequiredEnv(key: string): string {
  const value = process.env[key];
  if (value === undefined || value === '') {
    throw new Error(
      `[ENV] Missing required environment variable: ${key}\n` +
        `Please check your .env file or environment configuration`,
    );
  }
  return value;
}

/**
 * Retrieves an optional environment variable.
 * @param key - Environment variable key
 * @returns Environment variable value or undefined
 */
function getOptionalEnv(key: string): string | undefined {
  const value = process.env[key];
  return value === '' ? undefined : value;
}

/**
 * Retrieves and validates NODE_ENV environment variable.
 * @returns Validated NodeEnv value
 * @throws {Error} If NODE_ENV is provided but not a valid value
 */
function getNodeEnv(): NodeEnv {
  // Default to development if undefined or empty to improve out-of-the-box DX
  const value = process.env.NODE_ENV || 'development';
  if (!VALID_NODE_ENVS.includes(value as NodeEnv)) {
    throw new Error(
      `[ENV] Invalid NODE_ENV value: "${value}"\n` +
        `Valid values are: ${VALID_NODE_ENVS.join(', ')}`,
    );
  }
  return value as NodeEnv;
}

/**
 * Validates and retrieves LOG_LEVEL environment variable.
 * @returns Validated log level
 */
function getLogLevel(): string {
  const value = process.env.LOG_LEVEL ?? 'info';
  if (!VALID_LOG_LEVELS.includes(value as (typeof VALID_LOG_LEVELS)[number])) {
    console.warn(
      `[ENV] Invalid LOG_LEVEL value: "${value}". Using default: "info".\n` +
        `Valid values are: ${VALID_LOG_LEVELS.join(', ')}`,
    );
    return 'info';
  }
  return value;
}

/**
 * Retrieves and validates DATABASE_TYPE environment variable.
 * Required — fails at startup rather than silently routing all DB calls to the wrong adapter.
 */
function getValidatedDatabaseType(): DatabaseType {
  const value = getRequiredEnv('DATABASE_TYPE');
  if (!VALID_DATABASE_TYPES.includes(value as DatabaseType)) {
    throw new Error(
      `[ENV] Invalid DATABASE_TYPE value: "${value}"\n` +
        `Valid values are: ${VALID_DATABASE_TYPES.join(', ')}`,
    );
  }
  return value as DatabaseType;
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
export const env: EnvConfig = {
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

  // Brevo transactional email — read at startup; absent vars produce undefined without throwing
  BREVO_SENDER_EMAIL: getOptionalEnv('BREVO_SENDER_EMAIL'),
  BREVO_API_KEY: getOptionalEnv('BREVO_API_KEY'),

  // GitHub — read at startup; absent vars disable the Admin File Manager
  GITHUB_TOKEN: getOptionalEnv('GITHUB_TOKEN'),
  GITHUB_REPO_OWNER: getOptionalEnv('GITHUB_REPO_OWNER'),
  GITHUB_REPO_NAME: getOptionalEnv('GITHUB_REPO_NAME'),
  GITHUB_REPO_BASE_PATH: getOptionalEnv('GITHUB_REPO_BASE_PATH'),
  ADMIN_REPO_PATH: getOptionalEnv('ADMIN_REPO_PATH'),

  // AI agent browser tool — absent PUPPETEER_EXEC_PATH disables the tool gracefully
  PUPPETEER_EXEC_PATH: getOptionalEnv('PUPPETEER_EXEC_PATH'),
  AGENT_BROWSER_HEADLESS: getOptionalEnv('AGENT_BROWSER_HEADLESS'),

  // Security
  ENCRYPTION_KEY: getRequiredEnv('ENCRYPTION_KEY'),

  // Derived boolean helpers for convenience
  isDevelopment: nodeEnv === 'development',
  isProduction: nodeEnv === 'production',
  isTest: nodeEnv === 'test',
} as const;