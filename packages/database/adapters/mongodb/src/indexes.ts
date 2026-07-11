/**
 * MongoDB Index Bootstrap
 *
 * WHY THIS EXISTS (read before deleting):
 * Every cat-bot hot-path query — resolving a user/thread name, checking if a
 * command/event is enabled, reading a user/thread/bot session data blob, checking
 * bans, resolving credentials — filters on a compound key like
 * { userId, platformId, sessionId, botUserId }. Without an index covering that
 * shape, MongoDB has no choice but to COLLSCAN the entire collection on every
 * single message the bot receives, on every platform. This is invisible on an
 * empty dev database and becomes the dominant source of response latency as
 * soon as a collection holds more than a few thousand documents.
 *
 * The NeonDB adapter never had this problem because every table in
 * neondb/src/client.ts declares a composite PRIMARY KEY matching these exact
 * filter shapes, and Postgres auto-indexes primary keys. This module gives the
 * MongoDB adapter equivalent index coverage — one compound index per hot-path
 * filter shape, mirrored 1:1 against the NeonDB PRIMARY KEY definitions so both
 * adapters have matching query performance characteristics.
 *
 * Indexes are intentionally created as *non-unique*. Enforcing uniqueness here
 * could reject writes on a database that predates this bootstrap and already
 * contains duplicate rows from the old un-indexed upsert path — this module's
 * only job is query speed, never a schema migration. createIndex() is a cheap
 * no-op when an equivalent index already exists, so this safely runs on every
 * boot.
 */

import type { Db } from 'mongodb';

interface IndexSpec {
  collection: string;
  key: Record<string, 1 | -1>;
}

// One entry per hot-path filter shape — mirrors the composite PRIMARY KEY list
// in adapters/neondb/src/client.ts so both adapters are covered equivalently.
const INDEX_SPECS: IndexSpec[] = [
  // Global lookup-by-native-id tables — hit on every event to resolve names/avatars.
  { collection: 'botUsers', key: { id: 1 } },
  { collection: 'botThreads', key: { id: 1 } },
  { collection: 'botDiscordServers', key: { id: 1 } },
  { collection: 'botDiscordChannels', key: { threadId: 1 } },

  // Session-scoped hot path — resolved on every single incoming message.
  {
    collection: 'botSessionCommands',
    key: { userId: 1, platformId: 1, sessionId: 1, commandName: 1 },
  },
  {
    collection: 'botSessionEvents',
    key: { userId: 1, platformId: 1, sessionId: 1, eventName: 1 },
  },
  {
    collection: 'botUserSessions',
    key: { userId: 1, platformId: 1, sessionId: 1, botUserId: 1 },
  },
  {
    collection: 'botThreadSessions',
    key: { userId: 1, platformId: 1, sessionId: 1, botThreadId: 1 },
  },
  {
    collection: 'botUserBanned',
    key: { userId: 1, platformId: 1, sessionId: 1, botUserId: 1 },
  },
  {
    collection: 'botThreadBanned',
    key: { userId: 1, platformId: 1, sessionId: 1, botThreadId: 1 },
  },
  {
    collection: 'botDiscordServerSessions',
    key: { userId: 1, sessionId: 1, botServerId: 1 },
  },

  // Session / credential / admin lookups — hit on boot and on admin-gated commands.
  { collection: 'botSessions', key: { userId: 1, platformId: 1, sessionId: 1 } },
  {
    collection: 'botCredentialDiscord',
    key: { userId: 1, platformId: 1, sessionId: 1 },
  },
  {
    collection: 'botCredentialTelegram',
    key: { userId: 1, platformId: 1, sessionId: 1 },
  },
  {
    collection: 'botAdmins',
    key: { userId: 1, platformId: 1, sessionId: 1, adminId: 1 },
  },
  {
    collection: 'botPremiums',
    key: { userId: 1, platformId: 1, sessionId: 1, premiumId: 1 },
  },
  { collection: 'systemAdmin', key: { adminId: 1 } },
];

/**
 * Creates every hot-path compound index. Takes the Db instance as a parameter
 * (rather than importing client.ts) so this module has no dependency on the
 * client singleton — client.ts calls this once and memoizes the resulting
 * promise as its `dbReady` export.
 */
export async function ensureIndexes(db: Db): Promise<void> {
  await Promise.all(
    INDEX_SPECS.map(async ({ collection, key }) => {
      try {
        await db.collection(collection).createIndex(key);
      } catch (err) {
        // Fail-open — a missing index degrades a query's speed, it must never
        // block bot startup or take the whole process down.
        // eslint-disable-next-line no-console
        console.warn(
          `[MongoDB] Failed to ensure index on "${collection}"`,
          err,
        );
      }
    }),
  );
}
