// Load .env before any process.env access — DATABASE_TYPE must be readable before the adapter is selected.
import 'dotenv/config';

// Dynamic import defers module resolution entirely to runtime based on DATABASE_TYPE.
const dbType = process.env['DATABASE_TYPE'];
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
const m = (await (dbType === 'mongodb'
  ? import('./mongodb.js')
  : dbType === 'turso'
    ? import('./turso.js')
    : import('./neondb.js'))) as any;

// --- BOT SESSION COMMANDS ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertSessionCommands = m.upsertSessionCommands;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findSessionCommands = m.findSessionCommands;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const setCommandEnabled = m.setCommandEnabled;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isCommandEnabled = m.isCommandEnabled;

// --- BOT SESSION EVENTS ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertSessionEvents = m.upsertSessionEvents;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findSessionEvents = m.findSessionEvents;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const setEventEnabled = m.setEventEnabled;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isEventEnabled = m.isEventEnabled;

// --- CREDENTIALS ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findDiscordCredentialState = m.findDiscordCredentialState;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const updateDiscordCredentialCommandHash =
  m.updateDiscordCredentialCommandHash;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findAllDiscordCredentials = m.findAllDiscordCredentials;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findTelegramCredentialState = m.findTelegramCredentialState;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const updateTelegramCredentialCommandHash =
  m.updateTelegramCredentialCommandHash;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findAllTelegramCredentials = m.findAllTelegramCredentials;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findAllFluxerCredentials = m.findAllFluxerCredentials;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const findAllBotSessions = m.findAllBotSessions;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isBotAdmin = m.isBotAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const addBotAdmin = m.addBotAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const removeBotAdmin = m.removeBotAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const listBotAdmins = m.listBotAdmins;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const updateBotSessionPrefix = m.updateBotSessionPrefix;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getBotNickname = m.getBotNickname;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isBotPremium = m.isBotPremium;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const addBotPremium = m.addBotPremium;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const removeBotPremium = m.removeBotPremium;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const listBotPremiums = m.listBotPremiums;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getBotSessionData = m.getBotSessionData;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const setBotSessionData = m.setBotSessionData;

// --- THREADS ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const deleteThread = m.deleteThread;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const deleteDiscordServer = m.deleteDiscordServer;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertThread = m.upsertThread;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const threadExists = m.threadExists;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const threadSessionExists = m.threadSessionExists;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertThreadSession = m.upsertThreadSession;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isThreadAdmin = m.isThreadAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getThreadName = m.getThreadName;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getThreadSessionData = m.getThreadSessionData;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const setThreadSessionData = m.setThreadSessionData;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getAllGroupThreadIds = m.getAllGroupThreadIds;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getThreadSessionUpdatedAt = m.getThreadSessionUpdatedAt;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertDiscordServer = m.upsertDiscordServer;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const linkDiscordChannel = m.linkDiscordChannel;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getDiscordServerIdByChannel = m.getDiscordServerIdByChannel;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertDiscordServerSession = m.upsertDiscordServerSession;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getDiscordServerSessionUpdatedAt =
  m.getDiscordServerSessionUpdatedAt;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getDiscordServerSessionData = m.getDiscordServerSessionData;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const setDiscordServerSessionData = m.setDiscordServerSessionData;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isDiscordServerAdmin = m.isDiscordServerAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getDiscordServerName = m.getDiscordServerName;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getAllDiscordServerIds = m.getAllDiscordServerIds;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const discordServerExists = m.discordServerExists;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const discordServerSessionExists = m.discordServerSessionExists;

// --- USERS ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertUser = m.upsertUser;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const userExists = m.userExists;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const userSessionExists = m.userSessionExists;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertUserSession = m.upsertUserSession;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getUserName = m.getUserName;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getUserAvatar = m.getUserAvatar;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getUserById = m.getUserById;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getUserByUsername = m.getUserByUsername;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const updateUserAvatar = m.updateUserAvatar;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getUserSessionData = m.getUserSessionData;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const setUserSessionData = m.setUserSessionData;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getAllUserSessionData = m.getAllUserSessionData;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getUserSessionUpdatedAt = m.getUserSessionUpdatedAt;

// --- SERVER REPO ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const botRepo = m.botRepo;

// --- BANNED ---
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const banUser = m.banUser;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const unbanUser = m.unbanUser;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isUserBanned = m.isUserBanned;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getUserBanReason = m.getUserBanReason;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const banThread = m.banThread;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const unbanThread = m.unbanThread;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isThreadBanned = m.isThreadBanned;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getThreadBanReason = m.getThreadBanReason;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const banDiscordServer = m.banDiscordServer;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const unbanDiscordServer = m.unbanDiscordServer;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isDiscordServerBanned = m.isDiscordServerBanned;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getDiscordServerBanReason = m.getDiscordServerBanReason;

// --- MONGODB ---
// mongoClient and getMongoDb are undefined at runtime when DATABASE_TYPE!='mongodb' —
// callers (better-auth.lib.ts) guard with their own isMongo check before using them.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const mongoClient = m.mongoClient;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getMongoDb = m.getMongoDb;

// --- NEONDB POOL ---
// pool is undefined at runtime when DATABASE_TYPE!='neondb' — only used by
// better-auth.lib.ts which guards with its own isNeon check before accessing it.
// initDb is the schema initialiser; call once at boot when DATABASE_TYPE=neondb.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const pool = m.pool;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const initDb = m.initDb;

// --- TURSO CLIENT ---
// tursoClient is undefined at runtime when DATABASE_TYPE!='turso' — only used by
// better-auth.lib.ts which guards with its own isTurso check before accessing it.
// Deliberately a distinct export from `pool` (incompatible type: @libsql/client Client vs pg.Pool).
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const tursoClient = m.tursoClient;

// dbReady resolves when the active adapter's schema DDL has completed (neondb or turso);
// undefined for mongodb, which has no DDL step.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const dbReady = m.dbReady as Promise<void> | undefined;

// --- SYSTEM ADMIN ---
// Global privileged user IDs stored in system_admin — adapter-agnostic interface.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const listSystemAdmins = m.listSystemAdmins;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const addSystemAdmin = m.addSystemAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const removeSystemAdmin = m.removeSystemAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const isSystemAdmin = m.isSystemAdmin;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const listAllUsers = m.listAllUsers;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const deleteUser = m.deleteUser;
// Permanently wipes all database records and system data except the account and
// associated data of the admin userId passed in — adapter-agnostic interface.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const resetAllDatabase = m.resetAllDatabase;

// --- USER AI PROVIDER KEY ---
// Per-user AI provider config (Groq/OpenRouter API keys, AES-256-GCM encrypted
// at rest, plus the active provider + per-provider model). Always scoped to a
// single user's own account — never shared or reused across users.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getUserAiConfig = m.getUserAiConfig;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const saveUserAiKey = m.saveUserAiKey;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const updateUserAiModel = m.updateUserAiModel;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const deleteUserAiKey = m.deleteUserAiKey;

// --- USER TIMEZONE ---
// Per-user dashboard timezone preference (IANA identifier, e.g. "Asia/Manila").
// Scoped to a single user's own account, same ownership model as the Groq key above.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getUserTimezone = m.getUserTimezone;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const upsertUserTimezone = m.upsertUserTimezone;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const deleteUserTimezone = m.deleteUserTimezone;

// --- MAINTENANCE MODE ---
// Global "Maintenance Mode" switch — when enabled, bot usage is restricted to
// System Admins only. Adapter-agnostic interface.
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const getMaintenanceModeEnabled = m.getMaintenanceModeEnabled;
// eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
export const setMaintenanceModeEnabled = m.setMaintenanceModeEnabled;
