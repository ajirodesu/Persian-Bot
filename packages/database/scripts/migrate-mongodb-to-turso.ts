/**
 * migrate-mongodb-to-turso
 * Direct migration from MongoDB to Turso/libSQL.
 */
import './load-env.js';
import { mongoClient, getMongoDb } from '../adapters/mongodb/src/client.js';
import {
  tursoClient,
  initDb as initTursoDb,
} from '../adapters/turso/src/client.js';
import {
  tablesDef,
  collectionsMap,
  BOOLEAN_JSON_KEYS,
  convertDatesFromMongo,
} from './table-defs.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function deepConvert(obj: any): any {
  return convertDatesFromMongo(obj);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toTursoValue(jsonKey: string, val: any): any {
  if (val === undefined || val === null) return null;
  if (val instanceof Date) return val.toISOString();
  if (BOOLEAN_JSON_KEYS.has(jsonKey) && typeof val === 'boolean')
    return val ? 1 : 0;
  if (
    typeof val === 'object' &&
    val !== null &&
    !Array.isArray(val) &&
    !(val instanceof Date)
  ) {
    return JSON.stringify(val);
  }
  return val;
}

async function main() {
  console.log(`mongodb-to-turso migration`);

  await initTursoDb();

  const mongoDb = getMongoDb();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: Record<string, any[]> = {};

  console.log('Reading from MongoDB...');
  for (const [jsonKey, mongoCol] of Object.entries(collectionsMap)) {
    try {
      const docs = await mongoDb.collection(mongoCol).find({}).toArray();
      db[jsonKey] = docs.map((d) => {
        const converted = deepConvert(d);
        // Map _id to id so better-auth tables have string PKs matching the turso schema.
        if (converted._id && !converted.id) converted.id = converted._id;
        delete converted._id;
        return converted;
      });
    } catch (e: any) {
      console.warn(`[WARN] Skipping ${mongoCol}: ${e.message}`);
      db[jsonKey] = [];
    }
  }

  try {
    const rawThreads = await mongoDb
      .collection('botThreads')
      .find({})
      .toArray();
    db.botThread = rawThreads.map((t) => {
      const converted = deepConvert(t);
      if (converted._id && !converted.id) converted.id = converted._id;
      delete converted._id;
      const { participantIDs, adminIDs, ...rest } = converted;
      return { ...rest, participants: participantIDs || [], admins: adminIDs || [] };
    });
  } catch (e: any) {
    console.warn(`[WARN] Skipping botThreads: ${e.message}`);
    db.botThread = [];
  }

  try {
    const rawServers = await mongoDb
      .collection('botDiscordServers')
      .find({})
      .toArray();
    db.botDiscordServer = rawServers.map((t) => {
      const converted = deepConvert(t);
      if (converted._id && !converted.id) converted.id = converted._id;
      delete converted._id;
      const { participantIDs, adminIDs, ...rest } = converted;
      return { ...rest, participants: participantIDs || [], admins: adminIDs || [] };
    });
  } catch (e: any) {
    console.warn(`[WARN] Skipping botDiscordServers: ${e.message}`);
    db.botDiscordServer = [];
  }

  console.log('Truncating tables in Turso...');
  await tursoClient.execute('PRAGMA foreign_keys = OFF;');
  try {
    for (const def of [...tablesDef].reverse()) {
      await tursoClient
        .execute(`DELETE FROM ${def.table}`)
        .catch((e: any) => console.warn(`[WARN] Truncate failed: ${e.message}`));
    }
    await tursoClient.execute('DELETE FROM bot_thread_participants').catch(() => {});
    await tursoClient.execute('DELETE FROM bot_thread_admins').catch(() => {});
    await tursoClient
      .execute('DELETE FROM bot_discord_server_participants')
      .catch(() => {});
    await tursoClient.execute('DELETE FROM bot_discord_server_admins').catch(() => {});
  } finally {
    await tursoClient.execute('PRAGMA foreign_keys = ON;');
  }

  console.log('Writing to Turso...');
  for (const def of tablesDef) {
    const rows = db[def.jsonKey] || [];
    if (!rows.length) continue;

    const jsonKeys = Object.keys(def.cols);
    const colNames = Object.values(def.cols);

    const statements = rows.map((row) => {
      const args: Record<string, unknown> = {};
      const placeholders = jsonKeys.map((key) => {
        args[key] = toTursoValue(key, row[key] ?? null);
        return `:${key}`;
      });
      return {
        sql: `INSERT INTO ${def.table} (${colNames.join(', ')}) VALUES (${placeholders.join(', ')}) ON CONFLICT DO NOTHING`,
        args,
      };
    });

    try {
      await tursoClient.batch(statements, 'write');
    } catch (e: any) {
      console.warn(`[WARN] Batch insert failed for ${def.table}: ${e.message}`);
    }
    console.log(`  ${def.jsonKey.padEnd(34)} ${rows.length}`);

    if (def.jsonKey === 'botThread') {
      const pStatements: { sql: string; args: Record<string, unknown> }[] = [];
      const aStatements: { sql: string; args: Record<string, unknown> }[] = [];
      for (const t of rows) {
        for (const p of t.participants || [])
          pStatements.push({
            sql: `INSERT INTO bot_thread_participants (thread_id, user_id) VALUES (:threadId, :userId) ON CONFLICT DO NOTHING`,
            args: { threadId: t.id, userId: p },
          });
        for (const a of t.admins || [])
          aStatements.push({
            sql: `INSERT INTO bot_thread_admins (thread_id, user_id) VALUES (:threadId, :userId) ON CONFLICT DO NOTHING`,
            args: { threadId: t.id, userId: a },
          });
      }
      if (pStatements.length)
        await tursoClient.batch(pStatements, 'write').catch((e: any) => console.warn(`[WARN] ${e.message}`));
      if (aStatements.length)
        await tursoClient.batch(aStatements, 'write').catch((e: any) => console.warn(`[WARN] ${e.message}`));
    }

    if (def.jsonKey === 'botDiscordServer') {
      const pStatements: { sql: string; args: Record<string, unknown> }[] = [];
      const aStatements: { sql: string; args: Record<string, unknown> }[] = [];
      for (const t of rows) {
        for (const p of t.participants || [])
          pStatements.push({
            sql: `INSERT INTO bot_discord_server_participants (server_id, user_id) VALUES (:serverId, :userId) ON CONFLICT DO NOTHING`,
            args: { serverId: t.id, userId: p },
          });
        for (const a of t.admins || [])
          aStatements.push({
            sql: `INSERT INTO bot_discord_server_admins (server_id, user_id) VALUES (:serverId, :userId) ON CONFLICT DO NOTHING`,
            args: { serverId: t.id, userId: a },
          });
      }
      if (pStatements.length)
        await tursoClient.batch(pStatements, 'write').catch((e: any) => console.warn(`[WARN] ${e.message}`));
      if (aStatements.length)
        await tursoClient.batch(aStatements, 'write').catch((e: any) => console.warn(`[WARN] ${e.message}`));
    }
  }

  console.log('\nMigration complete.');
  await mongoClient.close();
}

main().catch((err: unknown) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
