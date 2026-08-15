/**
 * Turso/libSQL Adapter Barrel
 *
 * Consolidates every export from the turso adapter into a single module.
 * This file is ONLY loaded via dynamic import() from src/index.ts when
 * DATABASE_TYPE=turso — never import it directly from application code.
 *
 * better-auth integration: unlike neondb's `pool` (a raw pg.Pool passed straight to
 * betterAuth({ database: pool })), libSQL has no first-class better-auth adapter.
 * better-auth.lib.ts instead wraps the exported `tursoClient` in a `LibsqlDialect`
 * (from `@libsql/kysely-libsql`) and passes `{ dialect, type: 'sqlite' }` to
 * betterAuth({ database: ... }) — see better-auth.lib.ts for the isTurso branch.
 */

// --- BOT SESSION COMMANDS ---
export {
  upsertSessionCommands,
  findSessionCommands,
  setCommandEnabled,
  isCommandEnabled,
} from '../adapters/turso/src/cat-bot/bot-session-commands.repo.js';

// --- BOT SESSION EVENTS ---
export {
  upsertSessionEvents,
  findSessionEvents,
  setEventEnabled,
  isEventEnabled,
} from '../adapters/turso/src/cat-bot/bot-session-events.repo.js';

// --- CREDENTIALS ---
export {
  findDiscordCredentialState,
  updateDiscordCredentialCommandHash,
  findAllDiscordCredentials,
  findTelegramCredentialState,
  updateTelegramCredentialCommandHash,
  findAllTelegramCredentials,
  findAllFluxerCredentials,
  findAllBotSessions,
  isBotAdmin,
  addBotAdmin,
  removeBotAdmin,
  listBotAdmins,
  updateBotSessionPrefix,
  getBotNickname,
  isBotPremium,
  addBotPremium,
  removeBotPremium,
  listBotPremiums,
  getBotSessionData,
  setBotSessionData,
} from '../adapters/turso/src/cat-bot/credentials.repo.js';

// --- THREADS ---
export {
  deleteThread,
  deleteDiscordServer,
  upsertThread,
  threadExists,
  threadSessionExists,
  upsertThreadSession,
  isThreadAdmin,
  getThreadName,
  getThreadSessionData,
  setThreadSessionData,
  getAllGroupThreadIds,
  getThreadSessionUpdatedAt,
  upsertDiscordServer,
  linkDiscordChannel,
  getDiscordServerIdByChannel,
  upsertDiscordServerSession,
  getDiscordServerSessionUpdatedAt,
  getDiscordServerSessionData,
  setDiscordServerSessionData,
  isDiscordServerAdmin,
  getDiscordServerName,
  getAllDiscordServerIds,
  discordServerExists,
  discordServerSessionExists,
} from '../adapters/turso/src/cat-bot/threads.repo.js';

// --- USERS ---
export {
  upsertUser,
  userExists,
  userSessionExists,
  upsertUserSession,
  getUserName,
  getUserAvatar,
  getUserById,
  getUserByUsername,
  updateUserAvatar,
  getUserSessionData,
  setUserSessionData,
  getAllUserSessionData,
  getUserSessionUpdatedAt,
} from '../adapters/turso/src/cat-bot/users.repo.js';

// --- BANNED ---
export {
  banUser,
  unbanUser,
  isUserBanned,
  getUserBanReason,
  banThread,
  unbanThread,
  isThreadBanned,
  getThreadBanReason,
  banDiscordServer,
  unbanDiscordServer,
  isDiscordServerBanned,
  getDiscordServerBanReason,
} from '../adapters/turso/src/cat-bot/banned.repo.js';

// --- SERVER ---
export { botRepo } from '../adapters/turso/src/server/bot.repo.js';

// --- TURSO CLIENT ---
// tursoClient is the @libsql/client Client singleton — exported so better-auth.lib.ts
// can wrap it in a LibsqlDialect for betterAuth({ database: { dialect, type: 'sqlite' } }).
// dbReady is the Promise<void> that resolves when initDb() DDL has completed.
// Deliberately NOT exported as `pool` — that name is reserved for neondb's pg.Pool,
// which is an incompatible type; callers must gate on isTurso and use `tursoClient`.
export { tursoClient, initDb, dbReady } from '../adapters/turso/src/client.js';

// --- SYSTEM ADMIN ---
export {
  listSystemAdmins,
  addSystemAdmin,
  removeSystemAdmin,
  isSystemAdmin,
  listAllUsers,
  deleteUser,
  resetAllDatabase,
} from '../adapters/turso/src/server/system-admin.repo.js';

// --- USER AI PROVIDER KEY ---
export {
  getUserAiConfig,
  saveUserAiKey,
  updateUserAiModel,
  deleteUserAiKey,
} from '../adapters/turso/src/server/provider-key.repo.js';

// --- USER TIMEZONE ---
export {
  getUserTimezone,
  upsertUserTimezone,
  deleteUserTimezone,
} from '../adapters/turso/src/server/timezone.repo.js';

// --- MAINTENANCE MODE ---
export {
  getMaintenanceModeEnabled,
  setMaintenanceModeEnabled,
} from '../adapters/turso/src/server/maintenance-mode.repo.js';
