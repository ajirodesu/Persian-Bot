/**
 * Shared relational table definitions and Mongo collection mapping used by every
 * migrate-*.ts script. Column identifiers are double-quoted where needed for
 * Postgres/NeonDB case sensitivity (e.g. "emailVerified") — SQLite/libSQL accepts
 * the same double-quoted identifier syntax, so this single definition works
 * unmodified against both the neondb and turso adapters.
 */

export const collectionsMap: Record<string, string> = {
  botSessionCommand: 'botSessionCommands',
  botSessionEvent: 'botSessionEvents',
  botCredentialDiscord: 'botCredentialDiscord',
  botCredentialTelegram: 'botCredentialTelegram',
  botCredentialFluxer: 'botCredentialFluxer',
  botSession: 'botSessions',
  botAdmin: 'botAdmins',
  botPremium: 'botPremiums',
  botUser: 'botUsers',
  systemAdmin: 'systemAdmin',
  botThreadSession: 'botThreadSessions',
  botUserSession: 'botUserSessions',
  botDiscordChannel: 'botDiscordChannels',
  botDiscordServerSession: 'botDiscordServerSessions',
  botUserBanned: 'botUserBanned',
  botThreadBanned: 'botThreadBanned',
  botUserGroqKey: 'botUserGroqKeys',
  botUserTimezone: 'botUserTimezones',
  user: 'user',
  session: 'session',
  account: 'account',
  verification: 'verification',
};

export const tablesDef = [
  {
    jsonKey: 'user',
    table: '"user"',
    cols: {
      id: 'id',
      name: 'name',
      email: 'email',
      emailVerified: '"emailVerified"',
      image: 'image',
      createdAt: '"createdAt"',
      role: 'role',
      banned: 'banned',
      banReason: '"banReason"',
      banExpires: '"banExpires"',
      updatedAt: '"updatedAt"',
    },
  },
  {
    jsonKey: 'session',
    table: '"session"',
    cols: {
      id: 'id',
      expiresAt: '"expiresAt"',
      token: 'token',
      createdAt: '"createdAt"',
      updatedAt: '"updatedAt"',
      ipAddress: '"ipAddress"',
      userAgent: '"userAgent"',
      impersonatedBy: '"impersonatedBy"',
      userId: '"userId"',
    },
  },
  {
    jsonKey: 'account',
    table: '"account"',
    cols: {
      id: 'id',
      accountId: '"accountId"',
      providerId: '"providerId"',
      userId: '"userId"',
      accessToken: '"accessToken"',
      refreshToken: '"refreshToken"',
      idToken: '"idToken"',
      accessTokenExpiresAt: '"accessTokenExpiresAt"',
      refreshTokenExpiresAt: '"refreshTokenExpiresAt"',
      scope: 'scope',
      password: 'password',
      createdAt: '"createdAt"',
      updatedAt: '"updatedAt"',
    },
  },
  {
    jsonKey: 'verification',
    table: '"verification"',
    cols: {
      id: 'id',
      identifier: 'identifier',
      value: 'value',
      expiresAt: '"expiresAt"',
      createdAt: '"createdAt"',
      updatedAt: '"updatedAt"',
    },
  },
  {
    jsonKey: 'systemAdmin',
    table: 'system_admin',
    cols: { id: 'id', adminId: 'admin_id', createdAt: 'created_at' },
  },
  {
    jsonKey: 'botUserGroqKey',
    table: 'bot_user_groq_key',
    cols: {
      userId: 'user_id',
      encryptedKey: 'encrypted_key',
      keyHint: 'key_hint',
      openrouterEncryptedKey: 'openrouter_encrypted_key',
      openrouterKeyHint: 'openrouter_key_hint',
      nvidiaEncryptedKey: 'nvidia_encrypted_key',
      nvidiaKeyHint: 'nvidia_key_hint',
      provider: 'provider',
      groqModel: 'groq_model',
      openrouterModel: 'openrouter_model',
      nvidiaModel: 'nvidia_model',
      agentSettings: 'agent_settings',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  {
    jsonKey: 'botUserTimezone',
    table: 'bot_user_timezone',
    cols: {
      userId: 'user_id',
      timezone: 'timezone',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  {
    jsonKey: 'botUser',
    table: 'bot_users',
    cols: {
      platformId: 'platform_id',
      id: 'id',
      name: 'name',
      firstName: 'first_name',
      username: 'username',
      avatarUrl: 'avatar_url',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  {
    jsonKey: 'botThread',
    table: 'bot_threads',
    cols: {
      platformId: 'platform_id',
      id: 'id',
      name: 'name',
      isGroup: 'is_group',
      type: 'type',
      memberCount: 'member_count',
      avatarUrl: 'avatar_url',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  {
    jsonKey: 'botDiscordServer',
    table: 'bot_discord_server',
    cols: {
      id: 'id',
      name: 'name',
      avatarUrl: 'avatar_url',
      memberCount: 'member_count',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
  },
  {
    jsonKey: 'botDiscordChannel',
    table: 'bot_discord_channel',
    cols: { threadId: 'thread_id', serverId: 'server_id' },
  },
  {
    jsonKey: 'botDiscordServerSession',
    table: 'bot_discord_server_session',
    cols: {
      userId: 'user_id',
      sessionId: 'session_id',
      botServerId: 'bot_server_id',
      lastUpdatedAt: 'last_updated_at',
      data: 'data',
    },
  },
  {
    jsonKey: 'botSession',
    table: 'bot_session',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      nickname: 'nickname',
      prefix: 'prefix',
      isRunning: 'is_running',
      data: 'data',
    },
  },
  {
    jsonKey: 'botAdmin',
    table: 'bot_admin',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      adminId: 'admin_id',
    },
  },
  {
    jsonKey: 'botPremium',
    table: 'bot_premium',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      premiumId: 'premium_id',
    },
  },
  {
    jsonKey: 'botCredentialDiscord',
    table: 'bot_credential_discord',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      discordToken: 'discord_token',
      discordClientId: 'discord_client_id',
      isCommandRegister: 'is_command_register',
      commandHash: 'command_hash',
    },
  },
  {
    jsonKey: 'botCredentialTelegram',
    table: 'bot_credential_telegram',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      telegramToken: 'telegram_token',
      isCommandRegister: 'is_command_register',
      commandHash: 'command_hash',
    },
  },
  {
    jsonKey: 'botCredentialFluxer',
    table: 'bot_credential_fluxer',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      fluxerToken: 'fluxer_token',
    },
  },
  {
    jsonKey: 'botUserSession',
    table: 'bot_users_session',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      botUserId: 'bot_user_id',
      lastUpdatedAt: 'last_updated_at',
      data: 'data',
    },
  },
  {
    jsonKey: 'botThreadSession',
    table: 'bot_threads_session',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      botThreadId: 'bot_thread_id',
      lastUpdatedAt: 'last_updated_at',
      data: 'data',
    },
  },
  {
    jsonKey: 'botSessionCommand',
    table: 'bot_session_commands',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      commandName: 'command_name',
      isEnable: 'is_enable',
    },
  },
  {
    jsonKey: 'botSessionEvent',
    table: 'bot_session_events',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      eventName: 'event_name',
      isEnable: 'is_enable',
    },
  },
  {
    jsonKey: 'botUserBanned',
    table: 'bot_users_session_banned',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      botUserId: 'bot_user_id',
      isBanned: 'is_banned',
      reason: 'reason',
    },
  },
  {
    jsonKey: 'botThreadBanned',
    table: 'bot_threads_session_banned',
    cols: {
      userId: 'user_id',
      platformId: 'platform_id',
      sessionId: 'session_id',
      botThreadId: 'bot_thread_id',
      isBanned: 'is_banned',
      reason: 'reason',
    },
  },
];

/**
 * Columns whose relational (Postgres/libSQL) representation is boolean-like but
 * physically stored as INTEGER 0/1 in the turso/libSQL adapter. Used by the
 * turso migration scripts to coerce values in both write and read directions —
 * neondb's `pg` driver returns/accepts real JS booleans for its native BOOLEAN
 * columns, but libSQL has no boolean type.
 */
export const BOOLEAN_JSON_KEYS = new Set([
  'emailVerified',
  'banned',
  'isGroup',
  'isRunning',
  'isCommandRegister',
  'isEnable',
  'isBanned',
]);

// Safely stringify MongoDB ObjectIDs into standard strings so relational adapters accept them as TEXT PKs.
const isoDateRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function convertDatesFromMongo(obj: any): any {
  if (typeof obj === 'string' && isoDateRegex.test(obj)) return new Date(obj);
  if (Array.isArray(obj)) return obj.map(convertDatesFromMongo);
  if (obj !== null && typeof obj === 'object') {
    if (obj instanceof Date) return obj;
    if (
      obj._bsontype === 'ObjectID' ||
      (obj.toHexString && typeof obj.toHexString === 'function')
    )
      return obj.toString();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) out[k] = convertDatesFromMongo(v);
    return out;
  }
  return obj;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function convertDatesForMongo(obj: any): any {
  return convertDatesFromMongo(obj);
}
