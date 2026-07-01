// Single import point for all consumers in the monorepo.
// This file is the adapter barrel — only the database package's src/neondb.ts imports from here.
// Application code always imports from 'database', never from this adapter directly.
export { pool, initDb, dbReady } from './client.js';

export {
  upsertSessionCommands,
  findSessionCommands,
  setCommandEnabled,
  isCommandEnabled,
} from './persian/bot-session-commands.repo.js';

export {
  upsertSessionEvents,
  findSessionEvents,
  setEventEnabled,
  isEventEnabled,
} from './persian/bot-session-events.repo.js';

export {
  findDiscordCredentialState,
  updateDiscordCredentialCommandHash,
  findAllDiscordCredentials,
  findTelegramCredentialState,
  updateTelegramCredentialCommandHash,
  findAllTelegramCredentials,
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
} from './persian/credentials.repo.js';

export {
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
  // Discord server-isolated storage — channel ID maps to server ID so settings and data
  // are stored at the Guild level rather than duplicated across every channel row.
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
} from './persian/threads.repo.js';

export {
  upsertUser,
  userExists,
  userSessionExists,
  upsertUserSession,
  getUserName,
  getUserSessionData,
  setUserSessionData,
  getAllUserSessionData,
  getUserSessionUpdatedAt,
} from './persian/users.repo.js';

export {
  banUser,
  unbanUser,
  isUserBanned,
  banThread,
  unbanThread,
  isThreadBanned,
} from './persian/banned.repo.js';

export { botRepo } from './server/bot.repo.js';

export {
  listSystemAdmins,
  addSystemAdmin,
  removeSystemAdmin,
  isSystemAdmin,
} from './server/system-admin.repo.js';
