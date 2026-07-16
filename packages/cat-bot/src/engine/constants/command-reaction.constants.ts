/**
 * Command Reaction Registry
 *
 * Defines the emoji the bot reacts with on the user's triggering message once
 * a command has finished executing successfully. Resolved dynamically at call
 * time via getCommandReactEmoji() (never inlined as a literal at call sites)
 * so the reaction can be reconfigured — including per-deployment via the
 * COMMAND_REACT_EMOJI environment variable — without touching dispatcher code.
 */
import { env } from '@/engine/config/env.config.js';

/** Fallback used when COMMAND_REACT_EMOJI is not set in the environment. */
export const DEFAULT_COMMAND_REACT_EMOJI = '🔥';

/**
 * Returns the emoji to react with on a successfully executed command.
 * Reads env on every call (cheap property access) so a reload of env config
 * (e.g. in tests) is always reflected rather than cached at import time.
 */
export function getCommandReactEmoji(): string {
  return env.COMMAND_REACT_EMOJI || DEFAULT_COMMAND_REACT_EMOJI;
}
