/**
 * Environment Configuration Module
 *
 * Centralized, type-safe environment variable management with runtime validation.
 * Fails fast on missing required variables - validates on import.
 *
 * @module config/env.config.ts
 */
import 'dotenv/config';
/**
 * Valid Node environment values.
 * Strictly typed to prevent runtime errors from invalid environment strings.
 */
export type NodeEnv = 'development' | 'production' | 'test';
export type DatabaseType = 'mongodb' | 'neondb';
/**
 * Environment configuration type definition.
 * IMPORTANT: With exactOptionalPropertyTypes: true, optional properties
 * must explicitly include undefined in their type.
 */
interface EnvConfig {
    readonly NODE_ENV: NodeEnv;
    readonly PORT: string;
    readonly LOG_LEVEL: string;
    readonly LOG_FILE_PATH?: string | undefined;
    readonly ERROR_LOG_FILE_PATH?: string | undefined;
    readonly TELEGRAM_WEBHOOK_DOMAIN?: string | undefined;
    readonly DATABASE_TYPE: DatabaseType;
    readonly BETTER_AUTH_SECRET: string;
    readonly BETTER_AUTH_URL?: string | undefined;
    readonly VITE_URL?: string | undefined;
    readonly VITE_EMAIL_SERVICES_ENABLE?: string | undefined;
    readonly GMAIL_USER?: string | undefined;
    readonly GOOGLE_APP_PASSWORD?: string | undefined;
    readonly ENCRYPTION_KEY: string;
    /**
     * OpenRouter API key for AI-powered commands (ai, agent). Optional — bot
     * starts normally when absent but AI features will gracefully reject.
     */
    readonly OPENROUTER_API_KEY?: string | undefined;
    /**
     * Emoji the bot reacts with on the triggering message when a command
     * finishes successfully. Optional — falls back to the default defined in
     * command-reaction.constants.ts when unset, so operators can override the
     * reaction without touching source code.
     */
    readonly COMMAND_REACT_EMOJI?: string | undefined;
    readonly isDevelopment: boolean;
    readonly isProduction: boolean;
    readonly isTest: boolean;
}
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
export declare const env: EnvConfig;
export {};
//# sourceMappingURL=env.config.d.ts.map